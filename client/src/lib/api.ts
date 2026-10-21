import type {
  Asset,
  AssetListResponse,
  Capabilities,
  Collection,
  HealthResponse,
  MultipartUploadTicket,
  RescanResult,
  SingleUploadTicket,
  SortKey,
  Stats,
  UploadOptions,
} from './types';

/**
 * The browser only ever talks to our own API. Filebase credentials live in the
 * server process; the client receives short-lived presigned URLs and nothing else.
 */
const TOKEN_KEY = 'gamevault.token';

export function getToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setToken(token: string): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage disabled — token stays in memory only */
  }
}

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const token = getToken();
  if (token) headers.set('X-GameVault-Token', token);

  let response: Response;
  try {
    response = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'network_error', 'Cannot reach the GameVault API. Is the server running?');
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const err = (payload as { error?: { code?: string; message?: string; details?: unknown } })?.error;
    throw new ApiError(
      response.status,
      err?.code ?? 'request_failed',
      err?.message ?? `Request failed with status ${response.status}`,
      err?.details,
    );
  }
  return payload as T;
}

export interface ListParams {
  q?: string;
  collection?: string;
  kind?: string;
  tag?: string;
  sort?: SortKey;
  page?: number;
  pageSize?: number;
}

export const api = {
  capabilities: () => request<Capabilities>('/api/capabilities'),

  health: (deep = false) =>
    request<HealthResponse>(`/api/health${deep ? '?storage=1' : ''}`).catch((err) => {
      // /api/health returns 503 in setup mode — that is still useful JSON.
      if (err instanceof ApiError && err.details === undefined && err.code === 'request_failed') throw err;
      throw err;
    }),

  healthRaw: async (deep = false): Promise<HealthResponse> => {
    const headers = new Headers();
    const token = getToken();
    if (token) headers.set('X-GameVault-Token', token);
    const res = await fetch(`/api/health${deep ? '?storage=1' : ''}`, { headers });
    return (await res.json()) as HealthResponse;
  },

  stats: () => request<Stats>('/api/assets/stats'),

  listAssets: (params: ListParams = {}) => {
    const search = new URLSearchParams();
    if (params.q) search.set('q', params.q);
    if (params.collection && params.collection !== 'All') search.set('collection', params.collection);
    if (params.kind && params.kind !== 'all') search.set('kind', params.kind);
    if (params.tag) search.set('tag', params.tag);
    if (params.sort) search.set('sort', params.sort);
    if (params.page) search.set('page', String(params.page));
    if (params.pageSize) search.set('pageSize', String(params.pageSize));
    const qs = search.toString();
    return request<AssetListResponse>(`/api/assets${qs ? `?${qs}` : ''}`);
  },

  getAsset: (id: string) => request<{ asset: Asset }>(`/api/assets/${id}`),

  patchAsset: (
    id: string,
    patch: Partial<Pick<Asset, 'title' | 'tags' | 'collection' | 'description'>>,
  ) => request<{ asset: Asset }>(`/api/assets/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  deleteAsset: (id: string) => request<{ deleted: boolean; id: string }>(`/api/assets/${id}`, { method: 'DELETE' }),

  downloadInfo: (id: string) =>
    request<{ url: string; filename: string; size: number; expiresIn: number }>(
      `/api/assets/${id}/download`,
    ),

  rescan: () => request<RescanResult>('/api/assets/rescan', { method: 'POST' }),

  listCollections: () => request<{ collections: Collection[] }>('/api/collections'),

  createCollection: (name: string, description = '') =>
    request<{ collection: Collection }>('/api/collections', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }),

  deleteCollection: (id: string) =>
    request<{ deleted: boolean; id: string }>(`/api/collections/${id}`, { method: 'DELETE' }),

  createUpload: (file: File, options: UploadOptions) =>
    request<SingleUploadTicket | MultipartUploadTicket>('/api/assets/upload-url', {
      method: 'POST',
      body: JSON.stringify({
        filename: file.name,
        size: file.size,
        collection: options.collection,
        tags: options.tags,
        description: options.description,
      }),
    }),

  confirmUpload: (assetId: string) =>
    request<{ asset: Asset }>('/api/assets/confirm-upload', {
      method: 'POST',
      body: JSON.stringify({ assetId }),
    }),

  multipartParts: (assetId: string, uploadId: string, partNumbers: number[]) =>
    request<{ partUrls: Array<{ partNumber: number; url: string }>; expiresIn: number }>(
      '/api/assets/multipart/parts',
      { method: 'POST', body: JSON.stringify({ assetId, uploadId, partNumbers }) },
    ),

  multipartComplete: (
    assetId: string,
    uploadId: string,
    parts: Array<{ partNumber: number; etag: string }>,
  ) =>
    request<{ asset: Asset }>('/api/assets/multipart/complete', {
      method: 'POST',
      body: JSON.stringify({ assetId, uploadId, parts }),
    }),

  multipartAbort: (assetId: string, uploadId: string) =>
    request<void>('/api/assets/multipart/abort', {
      method: 'POST',
      body: JSON.stringify({ assetId, uploadId }),
    }),
};
