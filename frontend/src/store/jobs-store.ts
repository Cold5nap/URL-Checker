import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';
import * as api from '../api/jobs-api';
import type { JobListItem, JobDetail, UrlResult, JobStatus } from '../types';

const WS_URL = import.meta.env.VITE_WS_URL ?? window.location.origin;

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

  connectSocket: () => {
    const socket = io(WS_URL, {
      transports: ['polling', 'websocket'],
    });

    socket.on('job:created', (data: { jobId: string }) => {
      const { activeJobId } = get();
      if (!activeJobId) {
        get().setActiveJob(data.jobId);
      }
      get().fetchJobs();
    });

    socket.on('job:update', (data: { jobId: string; status: JobStatus }) => {
      const { activeJobId, activeJob } = get();
      if (activeJobId === data.jobId) {
        if (activeJob) {
          set({ activeJob: { ...activeJob, status: data.status } });
        } else {
          set({
            activeJob: {
              id: data.jobId,
              status: data.status,
              createdAt: '',
              urls: [],
            },
          });
        }
      }
      get().fetchJobs();
    });

    socket.on('url:update', ({ jobId, ...urlData }: { jobId: string } & Partial<UrlResult>) => {
      const state = get();
      if (state.activeJobId !== jobId) return;

      let { activeJob } = state;

      if (!activeJob) {
        activeJob = {
          id: jobId,
          status: 'in_progress',
          createdAt: '',
          urls: [],
        };
        set({ activeJob });
      }

      const url = urlData.url!;
      const existingIdx = activeJob.urls.findIndex((u) => u.url === url);

      const updatedUrls = existingIdx !== -1
        ? activeJob.urls.map((u) => (u.url !== url ? u : { ...u, ...urlData }))
        : [...activeJob.urls, { url, ...urlData } as UrlResult];

      set({ activeJob: { ...activeJob, urls: updatedUrls } });

      get().fetchJobDetail(jobId);
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

  createJob: async (urls: string[]) => {
    set({ error: null });
    try {
      const { activeJobId: prevId } = get();
      const response = await api.createJob(urls);

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
      await get().fetchJobDetail(response.jobId);

      return response.jobId;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Не удалось создать задание' });
      return null;
    }
  },

  fetchJobDetail: async (id: string) => {
    set({ detailLoading: true, error: null });
    try {
      const detail = await api.fetchJobDetail(id);
      const { activeJobId, jobs } = get();
      if (activeJobId === id) {
        set({ activeJob: detail, detailLoading: false });

        const jobIdx = jobs.findIndex((j) => j.id === id);
        if (jobIdx !== -1) {
          const updatedJobs = [...jobs];
          updatedJobs[jobIdx] = {
            ...updatedJobs[jobIdx],
            status: detail.status,
            successCount: detail.urls.filter((u) => u.status === 'success').length,
            errorCount: detail.urls.filter((u) => u.status === 'error').length,
          };
          set({ jobs: updatedJobs });
        }
      } else {
        set({ detailLoading: false });
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Не удалось загрузить детали задания', detailLoading: false });
    }
  },

  cancelJob: async (id: string) => {
    set({ error: null });
    try {
      await api.cancelJob(id);
      await get().fetchJobs();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Не удалось отменить задание' });
    }
  },

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
    set({ activeJobId: id, activeJob: null });
    if (id) {
      get().fetchJobDetail(id);
    }
  },
}));
