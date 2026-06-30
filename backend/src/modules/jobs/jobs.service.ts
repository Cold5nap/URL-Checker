import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { v4 as uuidv4 } from 'uuid';
import { JobStatus, UrlStatus } from '../../common/enums/status.enum';
import { Job, JobListItem } from './interfaces/job.interface';

/**
 * Promise-based семафор для ограничения конкурентности.
 *
 * Позволяет запустить не более `max` асинхронных операций одновременно.
 * Очередь ожидающих (FIFO) гарантирует, что задачи не теряются.
 *
 * Используется для ограничения одновременных HEAD-запросов:
 * не более 5 на одно задание.
 */
class Semaphore {
  private current = 0;
  private queue: (() => void)[] = [];

  constructor(private readonly max: number) {}

  private async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.current++;
        resolve();
      });
    });
  }

  private release(): void {
    this.current--;
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next?.();
    }
  }

  /**
   * Запускает `fn`, дождавшись слота в семафоре.
   * При любом исходе (resolve/reject) слот освобождается.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

/**
 * Задержка на `ms` миллисекунд, прерываемая через AbortSignal.
 *
 * Если сигнал уже прерван — резолвится сразу.
 * Если сигнал прерывается во время ожидания — таймер очищается,
 * промис резолвится (не reject), и код может проверить `isCancelled()`.
 *
 * Это ключевой механизм отмены: cancel() вызывает controller.abort(),
 * delay() прерывается, и управление переходит к проверке статуса.
 */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    }
  });
}

/**
 * Сервис управления заданиями проверки URL.
 *
 * Хранение — in-memory (Map).
 * Обработка — фоновая, fire-and-forget.
 * Уведомления — EventEmitter (на него подписан WebSocket-шлюз).
 *
 * Жизненный цикл задания:
 *   PENDING → IN_PROGRESS → COMPLETED
 *                     ↘ CANCELLED (если вызван cancel)
 */
@Injectable()
export class JobsService {
  // In-memory хранилище: jobId → Job
  private readonly jobs: Map<string, Job> = new Map();

  // AbortController'ы для каждого активного задания.
  // Позволяют прервать in-flight HEAD-запросы и delay() при отмене.
  private readonly abortControllers: Map<string, AbortController> = new Map();

  constructor(
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Создаёт новое задание.
   * Сохраняет в памяти, оповещает через EventEmitter,
   * запускает фоновую обработку и сразу возвращает jobId.
   */
  create(urls: string[]): string {
    const id = uuidv4();
    const now = new Date().toISOString();

    const job: Job = {
      id,
      createdAt: now,
      status: JobStatus.PENDING,
      urls: urls.map((url) => ({
        url,
        status: UrlStatus.PENDING,
      })),
    };

    this.jobs.set(id, job);
    this.eventEmitter.emit('job.created', { jobId: id });
    this.processJob(id);

    return id;
  }

  /**
   * Возвращает список всех заданий, отсортированный по дате создания (новые сверху).
   * Каждый элемент содержит краткую статистику: количество URL, успехи, ошибки.
   */
  findAll(): JobListItem[] {
    const items: JobListItem[] = [];

    for (const job of this.jobs.values()) {
      items.push({
        id: job.id,
        createdAt: job.createdAt,
        status: job.status,
        totalUrls: job.urls.length,
        successCount: job.urls.filter((u) => u.status === UrlStatus.SUCCESS).length,
        errorCount: job.urls.filter((u) => u.status === UrlStatus.ERROR).length,
      });
    }

    // Сортировка от новых к старым
    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return items;
  }

  findOne(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  /**
   * Отменяет задание.
   *
   * 1. Меняет статус задания на CANCELLED (снапшот для processJob).
   * 2. PENDING URL-ы сразу помечаются как CANCELLED.
   * 3. IN_PROGRESS URL-ы — AbortController.abort() прервёт HEAD-запросы и delay().
   *    processJob сам доставит им статус CANCELLED после прерывания.
   * 4. Оповещает клиентов о смене статуса.
   */
  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) {
      return false;
    }

    // Уже завершённые задания отменить нельзя
    if (job.status !== JobStatus.PENDING && job.status !== JobStatus.IN_PROGRESS) {
      return false;
    }

    job.status = JobStatus.CANCELLED;

    // PENDING URL-ы — немедленная отмена (они ещё не начали обработку)
    for (const urlResult of job.urls) {
      if (urlResult.status === UrlStatus.PENDING) {
        urlResult.status = UrlStatus.CANCELLED;
      }
    }

    // Прерываем активные операции (fetch + delay)
    const controller = this.abortControllers.get(id);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(id);
    }

    // Оповещаем через EventEmitter (WebSocket шлюз доставит клиентам)
    this.eventEmitter.emit('job.updated', {
      jobId: id,
      status: job.status,
      successCount: job.urls.filter((u) => u.status === UrlStatus.SUCCESS).length,
      errorCount: job.urls.filter((u) => u.status === UrlStatus.ERROR).length,
    });

    return true;
  }

  /**
   * Фоновая обработка задания.
   *
   * Для каждого PENDING URL:
   *   1. Помечает IN_PROGRESS, оповещает клиентов.
   *   2. Выполняет HEAD-запрос.
   *   3. Искусственная задержка 0–10 секунд (прерываемая при отмене).
   *   4. После задержки проверяет, не отменено ли задание:
   *        - если отменено → CANCELLED
   *        - если ошибка → ERROR
   *        - успех → SUCCESS
   *   5. Оповещает клиентов о результате.
   *
   * Конкурентность — не более 5 одновременных HEAD-запросов (Semaphore(5)).
   * Несколько заданий могут обрабатываться одновременно.
   *
   * Проверка отмены (`isCancelled`) читает статус из Map при каждом вызове,
   * поэтому cancel() с любого потока будет обнаружен. Дополнительно проверяется
   * abortController.signal.aborted — на случай, если прерывание пришло через сигнал.
   */
  private async processJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    const abortController = new AbortController();
    this.abortControllers.set(jobId, abortController);

    job.status = JobStatus.IN_PROGRESS;
    this.eventEmitter.emit('job.updated', { jobId, status: job.status });

    const pendingUrls = job.urls.filter((u) => u.status === UrlStatus.PENDING);
    const semaphore = new Semaphore(5);

    /**
     * Проверка, отменено ли задание.
     *
     * Читает статус из Map (не из замыкания), чтобы гарантированно увидеть
     * изменения, сделанные cancel(). Дополнительно проверяет AbortSignal —
     * если отмена произошла через controller.abort(), это тоже будет обнаружено.
     *
     * Вызывается между каждой асинхронной операцией (fetch, delay),
     * чтобы как можно раньше остановить обработку при отмене.
     */
    const isCancelled = (): boolean => {
      const current = this.jobs.get(jobId);
      return !current || current.status === JobStatus.CANCELLED || abortController.signal.aborted;
    };

    const promises = pendingUrls.map((urlEntry) =>
      semaphore.run(async () => {
        // Проверка перед началом работы — задание могло быть отменено
        // до того, как семафор выделил слот
        if (isCancelled()) {
          urlEntry.status = UrlStatus.CANCELLED;
          urlEntry.finishedAt = new Date().toISOString();
          if (urlEntry.startedAt) {
            urlEntry.duration = new Date(urlEntry.finishedAt).getTime() - new Date(urlEntry.startedAt).getTime();
          }
          this.eventEmitter.emit('job.url.updated', { jobId, ...urlEntry });
          return;
        }

        urlEntry.status = UrlStatus.IN_PROGRESS;
        urlEntry.startedAt = new Date().toISOString();
        this.eventEmitter.emit('job.url.updated', { jobId, ...urlEntry });

        let httpStatus: number | undefined;
        let fetchError: string | undefined;

        try {
          const response = await fetch(urlEntry.url, {
            method: 'HEAD',
            signal: abortController.signal,
          });
          httpStatus = response.status;
        } catch (err) {
          // Если fetch был прерван из-за отмены — помечаем CANCELLED
          if (isCancelled()) {
            urlEntry.status = UrlStatus.CANCELLED;
            urlEntry.finishedAt = new Date().toISOString();
            if (urlEntry.startedAt) {
              urlEntry.duration = new Date(urlEntry.finishedAt).getTime() - new Date(urlEntry.startedAt).getTime();
            }
            this.eventEmitter.emit('job.url.updated', { jobId, ...urlEntry });
            return;
          }
          fetchError = err instanceof Error ? err.message : 'Unknown error';
        }

        // Проверка после fetch — отмена могла прийти между fetch и этой проверкой
        if (isCancelled()) {
          urlEntry.status = UrlStatus.CANCELLED;
          urlEntry.finishedAt = new Date().toISOString();
          if (urlEntry.startedAt) {
            urlEntry.duration = new Date(urlEntry.finishedAt).getTime() - new Date(urlEntry.startedAt).getTime();
          }
          this.eventEmitter.emit('job.url.updated', { jobId, ...urlEntry });
          return;
        }

        // Искусственная задержка (по заданию: 0–10 секунд перед сохранением результата).
        // Задержка прерываемая — при отмене delay() резолвится досрочно.
        await delay(Math.floor(Math.random() * 10001), abortController.signal);

        // После задержки — финальное решение о статусе URL
        if (isCancelled()) {
          urlEntry.status = UrlStatus.CANCELLED;
        } else if (fetchError) {
          urlEntry.status = UrlStatus.ERROR;
          urlEntry.error = fetchError;
        } else {
          urlEntry.httpStatus = httpStatus;
          urlEntry.status = UrlStatus.SUCCESS;
        }

        urlEntry.finishedAt = new Date().toISOString();
        if (urlEntry.startedAt) {
          urlEntry.duration = new Date(urlEntry.finishedAt).getTime() - new Date(urlEntry.startedAt).getTime();
        }

        this.eventEmitter.emit('job.url.updated', { jobId, ...urlEntry });
      }),
    );

    // Ждём завершения обработки всех URL
    await Promise.allSettled(promises);

    // Если задание не было отменено — помечаем как COMPLETED
    if (!isCancelled()) {
      job.status = JobStatus.COMPLETED;
      this.eventEmitter.emit('job.updated', { jobId, status: job.status });
    }

    this.abortControllers.delete(jobId);
  }
}
