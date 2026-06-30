import { useJobsStore } from '../store/jobs-store';
import type { JobStatus, UrlStatus } from '../types';

const statusLabels: Record<JobStatus, string> = {
  pending: 'Ожидает',
  in_progress: 'Выполняется',
  completed: 'Завершено',
  cancelled: 'Отменено',
  failed: 'Ошибка',
};

const urlStatusLabels: Record<UrlStatus, string> = {
  pending: 'Ожидает',
  in_progress: 'Проверка...',
  success: 'Успех',
  error: 'Ошибка',
  cancelled: 'Отменено',
};

function formatDuration(ms?: number): string {
  if (ms == null) return '\u2014';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Детальная информация по активному заданию.
 *
 * Показывает:
 *   - ID задания и статус (цветной badge)
 *   - Прогресс-бар (X из Y обработано)
 *   - Кнопку «Cancel Job» (только для PENDING / IN_PROGRESS)
 *   - Список URL с их статусами, HTTP-кодами, ошибками и длительностью
 *
 * Обновляется через WebSocket в реальном времени.
 * При переключении задания старое состояние очищается (setActiveJob(null)).
 */
export function JobDetail() {
  const activeJob = useJobsStore((s) => s.activeJob);
  const activeJobId = useJobsStore((s) => s.activeJobId);
  const detailLoading = useJobsStore((s) => s.detailLoading);
  const cancelJob = useJobsStore((s) => s.cancelJob);
  const error = useJobsStore((s) => s.error);

  // Нет выбранного задания
  if (!activeJobId) {
    return (
      <div className="job-detail">
        <h2>Детали задания</h2>
        <p className="empty">Выберите задание, чтобы увидеть детали.</p>
      </div>
    );
  }

  // Первая загрузка
  if (detailLoading && !activeJob) {
    return (
      <div className="job-detail">
        <h2>Детали задания</h2>
        <p>Загрузка...</p>
      </div>
    );
  }

  // Задание не найдено (например, удалено)
  if (!activeJob) {
    return (
      <div className="job-detail">
        <h2>Детали задания</h2>
        <p className="empty">Задание не найдено.</p>
      </div>
    );
  }

  const isActive = activeJob.status === 'pending' || activeJob.status === 'in_progress';
  const processed = activeJob.urls.filter(
    (u) => u.status === 'success' || u.status === 'error' || u.status === 'cancelled',
  ).length;
  const total = activeJob.urls.length;

  return (
    <div className="job-detail">
      <div className="job-detail-header">
        <div>
          <h2>Детали задания</h2>
          <span className="job-id-full">ID: {activeJob.id}</span>
        </div>
        <span className={`badge badge-${activeJob.status}`}>
          {statusLabels[activeJob.status]}
        </span>
      </div>

      <p className="job-detail-date">
        Создано: {new Date(activeJob.createdAt).toLocaleString()}
      </p>

      {/* Прогресс-бар: заполняется пропорционально обработанным URL */}
      <div className="progress-bar">
        <div
          className="progress-fill"
          style={{ width: `${total > 0 ? (processed / total) * 100 : 0}%` }}
        />
      </div>
      <p className="progress-text">
        {processed} из {total} обработано
      </p>

      {/* Кнопка отмены — только для активных заданий */}
      {isActive && (
        <button className="cancel-btn" onClick={() => cancelJob(activeJob.id)}>
          Отменить
        </button>
      )}

      {error && <p className="error">{error}</p>}

      {/* Список URL с результатами проверки */}
      <div className="url-list">
        <h3>URL</h3>
        {activeJob.urls.map((urlEntry, idx) => (
          <div key={idx} className={`url-item url-item-${urlEntry.status}`}>
            <div className="url-item-header">
              <span className="url-status-badge badge badge-${urlEntry.status}">
                {urlStatusLabels[urlEntry.status]}
              </span>
              <span className="url-value">{urlEntry.url}</span>
            </div>
            <div className="url-item-meta">
              {urlEntry.httpStatus != null && (
                <span>HTTP {urlEntry.httpStatus}</span>
              )}
              {urlEntry.error && (
                <span className="error">{urlEntry.error}</span>
              )}
              {urlEntry.duration != null && (
                <span>{formatDuration(urlEntry.duration)}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
