import { api, ApiError } from './api';
import type { Asset, UploadOptions } from './types';

export interface UploadProgress {
  loaded: number;
  total: number;
  partsDone?: number;
  partsTotal?: number;
}

export interface UploadHandlers {
  onPhase: (phase: 'preparing' | 'uploading' | 'verifying') => void;
  onProgress: (progress: UploadProgress) => void;
  signal: AbortSignal;
}

interface PartUploadResult {
  partNumber: number;
  etag: string;
}

const CONCURRENCY = 3;

function putBlob(
  url: string,
  blob: Blob,
  contentType: string | undefined,
  onProgress: (loaded: number) => void,
  signal: AbortSignal,
): Promise<{ etag: string | null }> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Upload canceled', 'AbortError'));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    if (contentType) xhr.setRequestHeader('Content-Type', contentType);

    const onAbort = () => {
      xhr.abort();
      reject(new DOMException('Upload canceled', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded);
    };
    xhr.onerror = () => {
      signal.removeEventListener('abort', onAbort);
      reject(
        new ApiError(
          0,
          'upload_failed',
          'The upload to Filebase failed. Check your network connection and the bucket CORS settings.',
        ),
      );
    };
    xhr.onload = () => {
      signal.removeEventListener('abort', onAbort);
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(blob.size);
        resolve({ etag: xhr.getResponseHeader('ETag') });
        return;
      }
      let message = `Upload failed with status ${xhr.status}.`;
      if (xhr.status === 403) {
        message =
          'Filebase rejected the upload (403). The presigned URL may have expired or the bucket policy forbids the write.';
      } else if (xhr.status === 0) {
        message =
          'The upload was blocked (CORS). Add a CORS rule to the bucket that allows PUT from this origin.';
      }
      reject(new ApiError(xhr.status, 'upload_failed', message));
    };

    xhr.send(blob);
  });
}

async function uploadMultipart(
  file: File,
  ticket: Extract<Awaited<ReturnType<typeof api.createUpload>>, { mode: 'multipart' }>,
  handlers: UploadHandlers,
): Promise<Asset> {
  const { partSize, totalParts } = ticket;
  const partLoaded = new Map<number, number>();
  let lastLoaded = 0;

  const report = (partNumber: number, loaded: number) => {
    const capped = Math.min(loaded, Math.min(partSize, file.size - (partNumber - 1) * partSize));
    partLoaded.set(partNumber, capped);
    let sum = 0;
    for (const value of partLoaded.values()) sum += value;
    if (sum !== lastLoaded) {
      lastLoaded = sum;
      handlers.onProgress({ loaded: sum, total: file.size, partsDone: partLoaded.size, partsTotal: totalParts });
    }
  };

  const existing = new Map<number, string>();
  for (const { partNumber, url } of ticket.partUrls) existing.set(partNumber, url);

  const partNumbers = Array.from({ length: totalParts }, (_, i) => i + 1);
  const missing = partNumbers.filter((n) => !existing.has(n));
  for (let i = 0; i < missing.length; i += 100) {
    const batch = missing.slice(i, i + 100);
    const { partUrls } = await api.multipartParts(ticket.assetId, ticket.uploadId, batch);
    for (const { partNumber, url } of partUrls) existing.set(partNumber, url);
  }

  const results: PartUploadResult[] = [];
  const queue = [...partNumbers];

  const worker = async (): Promise<void> => {
    for (;;) {
      const partNumber = queue.shift();
      if (partNumber === undefined) return;
      if (handlers.signal.aborted) throw new DOMException('Upload canceled', 'AbortError');

      const start = (partNumber - 1) * partSize;
      const end = Math.min(start + partSize, file.size);
      const blob = file.slice(start, end);
      const url = existing.get(partNumber);
      if (!url) throw new ApiError(500, 'missing_part_url', `No upload URL for part ${partNumber}.`);

      let etag: string | null = null;
      let attempt = 0;
      for (;;) {
        try {
          const res = await putBlob(url, blob, undefined, (loaded) => report(partNumber, loaded), handlers.signal);
          etag = res.etag;
          break;
        } catch (err) {
          attempt += 1;
          if (handlers.signal.aborted || attempt >= 3) throw err;
          await new Promise((r) => setTimeout(r, 600 * attempt));
        }
      }

      if (!etag) {
        throw new ApiError(
          0,
          'etag_unavailable',
          'The bucket did not expose the part ETag, so the multipart upload cannot be completed. Add a CORS rule exposing the ETag header, or raise MULTIPART_THRESHOLD_BYTES above the file size.',
        );
      }
      results.push({ partNumber, etag: etag.replace(/"/g, '') });
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, totalParts) }, () => worker()));
    results.sort((a, b) => a.partNumber - b.partNumber);
    handlers.onPhase('verifying');
    const { asset } = await api.multipartComplete(ticket.assetId, ticket.uploadId, results);
    return asset;
  } catch (err) {
    // Roll back the incomplete multipart upload so no orphaned parts are billed.
    await api.multipartAbort(ticket.assetId, ticket.uploadId).catch(() => undefined);
    throw err;
  }
}

/** Upload one file end-to-end and return the verified asset record. */
export async function uploadFile(file: File, options: UploadOptions, handlers: UploadHandlers): Promise<Asset> {
  handlers.onPhase('preparing');
  const ticket = await api.createUpload(file, options);

  if (ticket.mode === 'single') {
    handlers.onPhase('uploading');
    await putBlob(
      ticket.uploadUrl,
      file,
      ticket.headers['Content-Type'] ?? ticket.contentType,
      (loaded) => handlers.onProgress({ loaded, total: file.size }),
      handlers.signal,
    );
    handlers.onPhase('verifying');
    const { asset } = await api.confirmUpload(ticket.assetId);
    return asset;
  }

  return uploadMultipart(file, ticket, handlers);
}

export function describeUploadError(err: unknown): string {
  if (err instanceof DOMException && err.name === 'AbortError') return 'Canceled';
  if (err instanceof ApiError) {
    if (err.code === 'storage_not_configured') {
      return 'Filebase credentials are not configured on the server. See Settings → Connection.';
    }
    if (err.code === 'unauthorized') return 'Access token required or invalid. Enter it in Settings.';
    if (err.code === 'file_too_large') return err.message;
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Upload failed for an unknown reason.';
}
