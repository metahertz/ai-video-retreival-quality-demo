import type {
  AllIndexStatusResponse,
  CompareSearchRequest,
  CompareSearchResponse,
  ConnectionTestResult,
  CreateIndexesResult,
  IndexCapacityInfo,
  IndexStatusResponse,
  ProcessJobStatus,
  ProcessRequest,
  SearchRequest,
  SearchResult,
  SettingsRequest,
  SettingsResponse,
  VideoResponse,
  YouTubeSearchResult,
} from './types';

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    let detail = text;
    try {
      detail = JSON.parse(text)?.detail ?? text;
    } catch {}
    throw new Error(detail || `HTTP ${res.status}`);
  }
  return res.json();
}

async function apiDelete(path: string): Promise<void> {
  const res = await fetch(path, { method: 'DELETE' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
}

// ── Settings ──────────────────────────────────────────────────────────────────

export const settingsApi = {
  get: () => apiGet<SettingsResponse>('/api/settings'),
  save: (body: SettingsRequest) => apiPost<SettingsResponse>('/api/settings', body),
  testConnection: (body: SettingsRequest) =>
    apiPost<ConnectionTestResult>('/api/settings/test-connection', body),
  createIndexes: () => apiPost<CreateIndexesResult>('/api/settings/create-indexes'),
  indexStatus: () => apiGet<AllIndexStatusResponse>('/api/settings/index-status'),
  indexCapacity: () => apiGet<IndexCapacityInfo>('/api/settings/index-capacity'),
  backfillDimensions: () =>
    apiPost<{ updated: number; message: string }>('/api/settings/backfill-dimensions'),
  backfillThumbnails: () =>
    apiPost<{ updated: number; skipped: number; message: string }>('/api/settings/backfill-thumbnails'),
};

// ── Videos ────────────────────────────────────────────────────────────────────

export const videosApi = {
  list: () => apiGet<VideoResponse[]>('/api/videos'),
  get: (id: string) => apiGet<VideoResponse>(`/api/videos/${id}`),
  search: (query: string, maxResults = 10) =>
    apiPost<YouTubeSearchResult[]>('/api/videos/search', { query, max_results: maxResults }),
  download: (youtubeId: string) =>
    apiPost<VideoResponse>('/api/videos/download', { youtube_id: youtubeId }),
  delete: (id: string) => apiDelete(`/api/videos/${id}`),
  streamUrl: (videoId: string) => `/api/videos/${videoId}/stream`,
  segmentStreamUrl: (videoId: string, segIndex: number) =>
    `/api/videos/${videoId}/segments/${segIndex}/stream`,
  segmentThumbnailUrl: (videoId: string, segIndex: number) =>
    `/api/videos/${videoId}/segments/${segIndex}/thumbnail`,
};

// ── Process ───────────────────────────────────────────────────────────────────

export const processApi = {
  start: (body: ProcessRequest) => apiPost<ProcessJobStatus>('/api/process', body),
  getStatus: (jobId: string) => apiGet<ProcessJobStatus>(`/api/process/${jobId}`),
  listVideoJobs: (videoId: string) =>
    apiGet<ProcessJobStatus[]>(`/api/process/video/${videoId}/jobs`),
};

// ── Search ────────────────────────────────────────────────────────────────────

export const searchApi = {
  search: (body: SearchRequest) => apiPost<SearchResult[]>('/api/search', body),
  compare: (body: CompareSearchRequest) =>
    apiPost<CompareSearchResponse>('/api/search/compare', body),
};
