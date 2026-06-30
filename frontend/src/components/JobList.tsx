import { useEffect } from 'react';
import { useJobsStore } from '../store/jobs-store';
import type { JobStatus } from '../types';

const statusLabels: Record<JobStatus, string> = {
  pending: 'Ожидает',
  in_progress: 'Выполняется',
  completed: 'Завершено',
  cancelled: 'Отменено',
  failed: 'Ошибка',
};

/**
 * Боковая панель со списком заданий.
 *
 * При монтировании фетчит список через GET /api/jobs.
 * Каждый элемент:
 *   - обрезанный ID
 *   - статус (цветной badge)
 *   - дата создания
 *   - статистика (всего / успешно / ошибок)
 *
 * По клику — переключает активное задание через setActiveJob().
 * Активное задание подсвечивается синей рамкой.
 * Список автоматически обновляется при WS-событиях (через стор).
 */
export function JobList() {
  const jobs = useJobsStore((s) => s.jobs);
  const loading = useJobsStore((s) => s.loading);
  const activeJobId = useJobsStore((s) => s.activeJobId);
  const fetchJobs = useJobsStore((s) => s.fetchJobs);
  const setActiveJob = useJobsStore((s) => s.setActiveJob);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  if (loading && jobs.length === 0) {
    return <div className="job-list"><h2>Задания</h2><p>Загрузка...</p></div>;
  }

  return (
    <div className="job-list">
      <h2>Задания</h2>
      {jobs.length === 0 ? (
        <p className="empty">Пока нет заданий. Создайте новое.</p>
      ) : (
        <ul>
          {jobs.map((job) => (
            <li
              key={job.id}
              className={job.id === activeJobId ? 'active' : ''}
              onClick={() => setActiveJob(job.id)}
            >
              <div className="job-list-header">
                <span className="job-id">{job.id.slice(0, 8)}...</span>
                <span className={`badge badge-${job.status}`}>
                  {statusLabels[job.status]}
                </span>
              </div>
              <div className="job-list-meta">
                <span>{new Date(job.createdAt).toLocaleString()}</span>
                <span>{job.totalUrls} URLs</span>
                <span className="success">{job.successCount} ок</span>
                <span className="error-count">{job.errorCount} ош</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
