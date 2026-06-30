import type { JobStatus, UrlStatus } from './types';

/** Метки статусов заданий (русские) */
export const jobStatusLabels: Record<JobStatus, string> = {
  pending: 'Ожидает',
  in_progress: 'Выполняется',
  completed: 'Завершено',
  cancelled: 'Отменено',
  failed: 'Ошибка',
};

/** Метки статусов URL (русские) */
export const urlStatusLabels: Record<UrlStatus, string> = {
  pending: 'Ожидает',
  in_progress: 'Проверка...',
  success: 'Успех',
  error: 'Ошибка',
  cancelled: 'Отменено',
};
