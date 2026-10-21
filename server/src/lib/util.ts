import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

export function newId(): string {
  return randomUUID();
}

/** Constant-time string comparison that tolerates different lengths. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function parseETag(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/^"+|"+$/g, '');
  if (!/^[A-Za-z0-9-]{8,128}$/.test(cleaned)) return null;
  return cleaned;
}

/** Escape a value for safe use in Content-Disposition. */
export function contentDisposition(type: 'attachment' | 'inline', filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
