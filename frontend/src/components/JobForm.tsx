import { useState } from 'react';
import { useJobsStore } from '../store/jobs-store';

/**
 * Форма создания нового задания.
 *
 * Парсит textarea (каждый URL — с новой строки),
 * вызывает createJob из стора, который:
 *   1. POST /api/jobs → получает jobId
 *   2. Делает задание активным (с подпиской на WS)
 *   3. Обновляет список заданий
 *
 * После успешной отправки очищает textarea.
 * Кнопка заблокирована во время отправки и при пустом вводе.
 */
export function JobForm() {
  const [urlsText, setUrlsText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const createJob = useJobsStore((s) => s.createJob);
  const error = useJobsStore((s) => s.error);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const urls = urlsText
      .split('\n')
      .map((u) => u.trim())
      .filter((u) => u.length > 0);

    if (urls.length === 0) return;

    setSubmitting(true);
    await createJob(urls);
    setUrlsText('');
    setSubmitting(false);
  };

  return (
    <form className="job-form" onSubmit={handleSubmit}>
      <h2>Создать задание</h2>
      <label htmlFor="urls-input">
        Введите URL (по одному на строку):
      </label>
      <textarea
        id="urls-input"
        value={urlsText}
        onChange={(e) => setUrlsText(e.target.value)}
        placeholder={'https://example.com\nhttps://google.com'}
        rows={6}
        disabled={submitting}
      />
      <button type="submit" disabled={submitting || urlsText.trim().length === 0}>
        {submitting ? 'Создание...' : 'Проверить'}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
