export type JobStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'failed';
export type UrlStatus = 'pending' | 'in_progress' | 'success' | 'error' | 'cancelled';

export interface UrlResult {
  url: string;
  status: UrlStatus;
  httpStatus?: number;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  duration?: number;
}

export interface JobListItem {
  id: string;
  createdAt: string;
  status: JobStatus;
  totalUrls: number;
  successCount: number;
  errorCount: number;
}

export interface JobDetail {
  id: string;
  createdAt: string;
  status: JobStatus;
  urls: UrlResult[];
}

export interface CreateJobResponse {
  jobId: string;
}

export interface JobListResponse {
  items: JobListItem[];
}
