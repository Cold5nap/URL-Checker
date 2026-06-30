import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';
import * as api from '../api/jobs-api';
import type { JobListItem, JobDetail, UrlResult, JobStatus } from '../types';

const WS_URL = 'http://localhost:3000';

/**
 * Глобальное состояние приложения (Zustand).
 *
 * Разделено на три логические части:
 * 1. Список заданий (jobs, loading) — для боковой панели
 * 2. Активное задание (activeJobId, activeJob, detailLoading) — для детальной панели
 * 3. WebSocket (socket) — для real-time обновлений
 *
 * Принцип опроса:
 *   Новые данные приходят через WebSocket (мгновенно).
 *   REST используется только для первоначальной загрузки
 *   и после явных действий (create / cancel).
 *   Это исключает race condition между REST-ответами и WS-событиями.
 *
 * При смене активного задания:
 *   1. Отправляем leave:job для старого jobId
 *   2. Отправляем join:job для нового jobId
 *   3. Фетчим детали через REST
 *   Гарантирует, что ответы по старому jobId не меняют состояние интерфейса.
 */
interface JobsState {
  jobs: JobListItem[];
  activeJobId: string | null;
  activeJob: JobDetail | null;
  loading: boolean;
  detailLoading: boolean;
  error: string | null;
  socket: Socket | null;

  fetchJobs: () => Promise<void>;
  createJob: (urls: string[]) => Promise<string | null>;
  fetchJobDetail: (id: string) => Promise<void>;
  cancelJob: (id: string) => Promise<void>;
  setActiveJob: (id: string | null) => void;
  connectSocket: () => void;
  disconnectSocket: () => void;
}

export const useJobsStore = create<JobsState>((set, get) => ({
  jobs: [],
  activeJobId: null,
  activeJob: null,
  loading: false,
  detailLoading: false,
  error: null,
  socket: null,

  /**
   * Подключается к WebSocket и навешивает обработчики событий.
   * Вызывается один раз при монтировании App.
   *
   * Обработчики используют get() для чтения актуального состояния,
   * чтобы избежать stale closure при быстрых последовательных событиях.
   */
  connectSocket: () => {
    const socket = io(WS_URL, {
      transports: ['polling', 'websocket'],
    });

    // Новое задание создано (другим клиентом или этой же вкладкой)
    socket.on('job:created', (data: { jobId: string }) => {
      const { activeJobId } = get();
      // Автовыбор: если ни одно задание не выбрано — выбираем новое
      if (!activeJobId) {
        get().setActiveJob(data.jobId);
      }
      get().fetchJobs();
    });

    // Статус задания изменился (completed / cancelled)
    socket.on('job:update', (data: { jobId: string; status: JobStatus }) => {
      const { activeJobId, activeJob } = get();
      if (activeJobId === data.jobId && activeJob) {
        // Защита от регресса: статус задания не может откатываться назад
        const jobRank: Record<string, number> = {
          pending: 0, in_progress: 1, completed: 2, cancelled: 2, failed: 2,
        };
        if ((jobRank[data.status] ?? 0) >= (jobRank[activeJob.status] ?? 0)) {
          set({ activeJob: { ...activeJob, status: data.status } });
        }
      }
      get().fetchJobs();
    });

    // Результат проверки URL изменился
    socket.on('url:update', ({ jobId, ...urlData }: { jobId: string } & Partial<UrlResult>) => {
      const { activeJobId, activeJob } = get();
      if (activeJobId === jobId && activeJob) {
        const updatedUrls = activeJob.urls.map((u) => {
          if (u.url !== urlData.url) return u;
          // Защита от регресса: статус URL не может откатываться назад.
          // pending(0) → in_progress(1) → success/error/cancelled(2)
          const urlRank: Record<string, number> = {
            pending: 0, in_progress: 1, success: 2, error: 2, cancelled: 2,
          };
          const curRank = urlRank[u.status] ?? 0;
          const newRank = urlData.status != null ? (urlRank[urlData.status] ?? 0) : 0;
          if (newRank > curRank) {
            return { ...u, ...urlData };
          }
          return u;
        });
        set({ activeJob: { ...activeJob, urls: updatedUrls } });
      }
      get().fetchJobs();
    });

    set({ socket });
  },

  disconnectSocket: () => {
    const { socket } = get();
    if (socket) {
      socket.disconnect();
      set({ socket: null });
    }
  },

  fetchJobs: async () => {
    set({ loading: true, error: null });
    try {
      const response = await api.fetchJobs();
      set({ jobs: response.items, loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Не удалось загрузить список заданий', loading: false });
    }
  },

  /**
   * Создаёт новое задание, делает его активным и обновляет список.
   *
   * В отличие от setActiveJob, не вызывает REST-GET (fetchJobDetail),
   * а строит начальное состояние из переданных URL.
   * Это исключает race condition: WS-события (url:update) не будут
   * затёрты устаревшим REST-ответом.
   */
  createJob: async (urls: string[]) => {
    set({ error: null });
    try {
      // Читаем предыдущий activeJobId ДО await, чтобы корректно отписаться от его комнаты
      const { activeJobId: prevId } = get();
      const response = await api.createJob(urls);

      // WS job:created мог уже вызвать setActiveJob — если activeJobId уже стоит,
      // не затираем его (активное состояние уже загружается через fetchJobDetail).
      if (get().activeJobId !== response.jobId) {
        const now = new Date().toISOString();
        set({
          activeJobId: response.jobId,
          activeJob: {
            id: response.jobId,
            status: 'pending' as JobStatus,
            createdAt: now,
            urls: urls.map((url) => ({
              url,
              status: 'pending' as const,
            })),
          },
          detailLoading: false,
        });
      }

      const { socket } = get();
      if (socket) {
        if (prevId) {
          socket.emit('leave:job', prevId);
        }
        socket.emit('join:job', response.jobId);
      }
      await get().fetchJobs();
      return response.jobId;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Не удалось создать задание' });
      return null;
    }
  },

  /**
   * Приоритет статусов для слияния: чем больше число, тем «финальнее» статус.
   * Используется в fetchJobDetail, чтобы не откатывать уже известный результат.
   */
  fetchJobDetail: async (id: string) => {
    set({ detailLoading: true, error: null });
    try {
      const detail = await api.fetchJobDetail(id);
      const { activeJobId, activeJob } = get();
      if (activeJobId === id) {
        if (activeJob && activeJob.urls.length > 0 && detail.urls.length > 0) {
          // Сливаем REST-ответ с уже применёнными WS-обновлениями.
          // Для каждого URL — если локальный статус «продвинутее»
          // серверного (например, success вместо pending), оставляем локальный.
          const rank: Record<string, number> = {
            pending: 0,
            in_progress: 1,
            success: 2,
            error: 2,
            cancelled: 2,
          };
          const mergedUrls = detail.urls.map((serverUrl) => {
            const localUrl = activeJob.urls.find((u) => u.url === serverUrl.url);
            if (localUrl && (rank[localUrl.status] ?? 0) > (rank[serverUrl.status] ?? 0)) {
              return localUrl;
            }
            return serverUrl;
          });
          set({
            activeJob: { ...detail, urls: mergedUrls },
            detailLoading: false,
          });
        } else {
          set({ activeJob: detail, detailLoading: false });
        }
      } else {
        set({ detailLoading: false });
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Не удалось загрузить детали задания', detailLoading: false });
    }
  },

  /**
   * Отменяет задание через REST DELETE.
   *
   * После DELETE сервер пришлёт WS-события:
   *   - job:update — обновит статус активного задания
   *   - url:update — обновит URL, которые успели завершиться до отмены
   *
   * Дополнительного REST-GET не делаем, чтобы избежать race condition:
   * ответ от GET может прийти после того, как пользователь переключился
   * на другое задание, и затереть его состояние.
   */
  cancelJob: async (id: string) => {
    set({ error: null });
    try {
      await api.cancelJob(id);
      await get().fetchJobs();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Не удалось отменить задание' });
    }
  },

  /**
   * Переключает активное задание.
   *
   * 1. leave:job — отписываемся от старого (чтобы его события не обновляли UI)
   * 2. join:job — подписываемся на новое (чтобы получать real-time обновления)
   * 3. Если id === null — очищаем детали
   */
  setActiveJob: (id: string | null) => {
    const { socket, activeJobId } = get();
    if (socket) {
      if (activeJobId) {
        socket.emit('leave:job', activeJobId);
      }
      if (id) {
        socket.emit('join:job', id);
      }
    }
    set({ activeJobId: id });
    if (id) {
      get().fetchJobDetail(id);
    } else {
      set({ activeJob: null });
    }
  },
}));
