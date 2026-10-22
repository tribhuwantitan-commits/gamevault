import { createHmac, pbkdf2 as pbkdf2Callback, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Request, Response } from 'express';
import { config } from '../config.js';

const pbkdf2 = promisify(pbkdf2Callback) as (
  password: string,
  salt: Buffer,
  iterations: number,
  keylen: number,
  digest: string,
) => Promise<Buffer>;

/**
 * Password hashing and session signing.
 *
 * Uses only Node built-ins (no new dependencies):
 *  - PBKDF2-HMAC-SHA256 for the stored password hash
 *  - HMAC-SHA256 for the signed, stateless session cookie
 *
 * The plaintext password and the hash never leave the server process.
 */

const SCHEME = 'pbkdf2';
const DIGEST = 'sha256';
export const DEFAULT_ITERATIONS = 600_000;
const KEY_LENGTH = 32;
const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200;

export interface ParsedHash {
  iterations: number;
  salt: Buffer;
  hash: Buffer;
}

/** Format: `pbkdf2$sha256$<iterations>$<salt-base64url>$<hash-base64url>` */
export function parsePasswordHash(stored: string): ParsedHash | null {
  const parts = stored.trim().split('$');
  if (parts.length !== 5) return null;
  const [scheme, digest, iterationsRaw, saltRaw, hashRaw] = parts;
  if (scheme !== SCHEME || digest !== DIGEST) return null;

  const iterations = Number(iterationsRaw);
  if (!Number.isInteger(iterations) || iterations < 10_000 || iterations > 5_000_000) return null;

  try {
    const salt = Buffer.from(saltRaw!, 'base64url');
    const hash = Buffer.from(hashRaw!, 'base64url');
    if (salt.length < 16 || hash.length < 16) return null;
    return { iterations, salt, hash };
  } catch {
    return null;
  }
}

export function isSupportedPasswordHash(stored: string): boolean {
  return parsePasswordHash(stored) !== null;
}

/** Constant-time verification. Always performs the KDF, even for unknown formats. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parsePasswordHash(stored);
  const candidate = typeof password === 'string' ? password : '';

  if (!parsed) {
    // Burn a comparable amount of time so a broken config is not a timing oracle.
    await pbkdf2(candidate, Buffer.alloc(16, 1), 100_000, KEY_LENGTH, DIGEST).catch(() => undefined);
    return false;
  }
  if (candidate.length === 0 || candidate.length > MAX_PASSWORD_LENGTH) return false;

  const derived = await pbkdf2(candidate, parsed.salt, parsed.iterations, parsed.hash.length, DIGEST);
  return derived.length === parsed.hash.length && timingSafeEqual(derived, parsed.hash);
}

export function validatePasswordStrength(password: string): string | null {
  if (typeof password !== 'string' || password.length === 0) return 'Password is required.';
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) return 'Password is too long.';
  return null;
}

/** Generate a hash for storage (used by the CLI script and tests). */
export async function hashPassword(
  password: string,
  iterations = DEFAULT_ITERATIONS,
): Promise<string> {
  const salt = randomBytes(16);
  const derived = await pbkdf2(password, salt, iterations, KEY_LENGTH, DIGEST);
  return `${SCHEME}$${DIGEST}$${iterations}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

// ---------------------------------------------------------------- sessions ---

export interface SessionPayload {
  v: 1;
  /** Issued-at, ms since epoch. */
  iat: number;
  /** Expiry, ms since epoch — slides with activity. */
  exp: number;
}

/**
 * Session key is derived from the server-side secrets, so it is stable across
 * restarts and cold starts (Render free sleeps), and rotating either secret
 * invalidates every existing session.
 */
function sessionKey(): Buffer {
  return createHmac('sha256', 'gamevault-session-v1')
    .update(`${config.authToken}\u0000${config.passwordHash}`)
    .digest();
}

function sign(payloadB64: string): string {
  return createHmac('sha256', sessionKey()).update(payloadB64).digest('base64url');
}

export function signSession(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${sign(body)}`;
}

export function verifySession(token: string, now = Date.now()): SessionPayload | null {
  if (typeof token !== 'string' || token.length < 20 || token.length > 4096) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;

  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(body);

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (parsed?.v !== 1 || typeof parsed.iat !== 'number' || typeof parsed.exp !== 'number') return null;
    if (parsed.exp <= now) return null;
    if (parsed.exp - parsed.iat > config.session.ttlSeconds * 1000 + 60_000) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------- cookies ---

export const SESSION_COOKIE = 'gv_session';

export function readSessionCookie(req: Request): string | null {
  const header = req.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== SESSION_COOKIE) continue;
    const raw = part.slice(index + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

function cookieAttributes(maxAgeSeconds: number): string {
  const parts = [
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (config.session.cookieSecure) parts.push('Secure');
  return parts.join('; ');
}

export function setSessionCookie(res: Response, token: string, maxAgeSeconds: number): void {
  res.append('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${cookieAttributes(maxAgeSeconds)}`);
}

export function clearSessionCookie(res: Response): void {
  res.append('Set-Cookie', `${SESSION_COOKIE}=; ${cookieAttributes(0)}`);
}
