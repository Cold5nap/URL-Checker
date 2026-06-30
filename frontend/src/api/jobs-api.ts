import type {
  CreateJobResponse,
  JobDetail,
  JobListResponse,
} from '../types';

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message ?? `Ошибка HTTP ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

export function fetchJobs(): Promise<JobListResponse> {
  return request<JobListResponse>('/jobs');
}

export function createJob(urls: string[]): Promise<CreateJobResponse> {
  return request<CreateJobResponse>('/jobs', {
    method: 'POST',
    body: JSON.stringify({ urls }),
  });
}

export function fetchJobDetail(id: string): Promise<JobDetail> {
  return request<JobDetail>(`/jobs/${id}`);
}

export function cancelJob(id: string): Promise<void> {
  return request<void>(`/jobs/${id}`, { method: 'DELETE' });
}
