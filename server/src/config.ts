import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
/** `server/` whether we run from `src/` (tsx) or `dist/` (compiled). */
export const SERVER_ROOT = path.resolve(here, '..');
export const REPO_ROOT = path.resolve(SERVER_ROOT, '..');

// Load `server/.env` first, then a repo-root `.env` as a fallback.
// dotenv never overrides variables that are already set (so tests / hosting env win).
dotenv.config({
  path: [path.join(SERVER_ROOT, '.env'), path.join(REPO_ROOT, '.env')],
});

function str(name: string, fallback = ''): string {
  const v = process.env[name];
  return v === undefined || v.trim() === '' ? fallback : v.trim();
}

function int(name: string, fallback: number): number {
  const raw = str(name);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function bool(name: string, fallback = false): boolean {
  const raw = str(name).toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

const MiB = 1024 * 1024;

const endpoint = str('FILEBASE_ENDPOINT', 'https://s3.filebase.io').replace(/\/+$/, '');
const bucket = str('FILEBASE_BUCKET', 'gaming-asset');
const accessKeyId = str('FILEBASE_ACCESS_KEY_ID');
const secretAccessKey = str('FILEBASE_SECRET_ACCESS_KEY');

/**
 * Path-style addressing is required by most S3-compatible servers that are not
 * Filebase (e.g. MinIO, the local mock used by the test suite).
 */
const forcePathStyle = process.env.FILEBASE_FORCE_PATH_STYLE === undefined
  ? !/^https:\/\/s3\.filebase\.io$/i.test(endpoint)
  : bool('FILEBASE_FORCE_PATH_STYLE');

const allowedOrigins = str('GAMEVAULT_ALLOWED_ORIGINS')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export const config = {
  nodeEnv: str('NODE_ENV', 'development'),
  isProduction: str('NODE_ENV', 'development') === 'production',
  port: int('PORT', 3001),
  host: str('HOST', '0.0.0.0'),

  storage: {
    endpoint,
    bucket,
    region: str('FILEBASE_REGION', 'us-east-1'),
    accessKeyId,
    secretAccessKey,
    forcePathStyle,
    configured: Boolean(accessKeyId && secretAccessKey && bucket && endpoint),
  },

  limits: {
    /** Hard ceiling for a single uploaded file (configurable). */
    maxUploadBytes: int('MAX_UPLOAD_BYTES', 2048 * MiB), // 2 GiB
    /** Files at or above this size use S3 multipart upload. */
    multipartThresholdBytes: int('MULTIPART_THRESHOLD_BYTES', 32 * MiB),
    /** Multipart part size (S3 minimum is 5 MiB). */
    partSizeBytes: Math.max(5 * MiB, int('MULTIPART_PART_SIZE_BYTES', 8 * MiB)),
    /** How many presigned part URLs are handed out at once. */
    maxPartsPerRequest: 100,
    maxUploadsPerRequest: 20,
    maxTagsPerAsset: 24,
    maxTagLength: 40,
  },

  presign: {
    /** Short-lived presigned PUT / multipart part URLs. */
    uploadExpiresSeconds: int('PRESIGN_UPLOAD_EXPIRES_SECONDS', 15 * 60),
    /** Short-lived presigned GET URLs for previews and downloads. */
    downloadExpiresSeconds: int('PRESIGN_DOWNLOAD_EXPIRES_SECONDS', 10 * 60),
  },

  /**
   * Optional shared secret for API clients (curl, scripts).
   * Unchanged behaviour: when set, requests must present it OR a valid session.
   */
  authToken: str('GAMEVAULT_AUTH_TOKEN'),

  /**
   * Optional PBKDF2 hash of the browser login password. When set, the UI unlocks
   * with a password instead of asking the user to paste the API token.
   * Format: pbkdf2$sha256$<iterations>$<salt>$<hash>  (see tools/password-hash.html)
   */
  passwordHash: str('GAMEVAULT_PASSWORD_HASH'),

  session: {
    /** Inactivity window: the session expires this long after the last request. */
    ttlSeconds: int('GAMEVAULT_SESSION_TTL_HOURS', 24) * 3600,
    /** Re-issue the cookie when fewer than this many seconds remain. */
    refreshThresholdSeconds: 300,
    /**
     * `Secure` cookie flag. Defaults to on in production (Render terminates HTTPS).
     * Override with GAMEVAULT_COOKIE_SECURE=false only for plain-HTTP local dev.
     */
    cookieSecure: bool('GAMEVAULT_COOKIE_SECURE', str('NODE_ENV', 'development') === 'production'),
  },

  allowedOrigins,

  dataDir: str('GAMEVAULT_DATA_DIR', path.join(SERVER_ROOT, 'data')),

  /**
   * Optional: keep the metadata index in the bucket itself so the app survives
   * hosts with an ephemeral filesystem (e.g. free tiers without a disk).
   * Empty = disabled (default) and the index lives only on local disk.
   * Must NOT live under `assets/`, otherwise the rescan would index it.
   */
  indexObject: str('GAMEVAULT_INDEX_OBJECT'),

  /** Key prefix inside the bucket that GameVault owns. Never lists anything else. */
  keyPrefix: 'assets/',
} as const;

export type AppConfig = typeof config;

export function assertValidConfig(): string[] {
  const problems: string[] = [];
  if (!config.storage.configured) {
    problems.push(
      'FILEBASE_ACCESS_KEY_ID and FILEBASE_SECRET_ACCESS_KEY must be set in server/.env',
    );
  }
  if (config.limits.maxUploadBytes < 1) problems.push('MAX_UPLOAD_BYTES must be positive');
  if (config.limits.multipartThresholdBytes > 5 * 1024 * MiB) {
    problems.push('MULTIPART_THRESHOLD_BYTES exceeds the 5 TiB single-file ceiling');
  }
  return problems;
}
