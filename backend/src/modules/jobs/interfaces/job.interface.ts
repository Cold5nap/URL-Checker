import { JobStatus, UrlStatus } from '../../../common/enums/status.enum';

export interface UrlResult {
  url: string;
  status: UrlStatus;
  httpStatus?: number;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  duration?: number;
}

export interface Job {
  id: string;
  createdAt: string;
  status: JobStatus;
  urls: UrlResult[];
}

export interface JobListItem {
  id: string;
  createdAt: string;
  status: JobStatus;
  totalUrls: number;
  successCount: number;
  errorCount: number;
}
