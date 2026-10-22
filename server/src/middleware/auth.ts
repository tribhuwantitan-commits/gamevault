import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import {
  readSessionCookie,
  setSessionCookie,
  signSession,
  verifySession,
} from '../lib/password.js';
import { safeEqual } from '../lib/util.js';

/**
 * Access gate for the control plane.
 *
 * Two ways in, both server-side:
 *  1. `X-GameVault-Token` / `Authorization: Bearer` with GAMEVAULT_AUTH_TOKEN —
 *     unchanged, for curl and scripts.
 *  2. A signed session cookie issued by POST /api/auth/login after the login
 *     password was verified (GAMEVAULT_PASSWORD_HASH).
 *
 * The session slides with activity: each request inside the final few minutes of
 * its 24h window re-issues the cookie, so active users stay logged in while an
 * idle tab locks itself.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // 1. API token (existing behaviour).
  const header = req.get('x-gamevault-token') ?? '';
  const bearer = (req.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const provided = header || bearer;

  if (config.authToken && provided && safeEqual(provided, config.authToken)) {
    next();
    return;
  }

  // 2. Password session.
  const cookie = readSessionCookie(req);
  if (cookie) {
    const payload = verifySession(cookie);
    if (payload) {
      const remaining = payload.exp - Date.now();
      if (remaining < config.session.ttlSeconds * 1000 - config.session.refreshThresholdSeconds * 1000) {
        // Sliding expiry: only re-sign when the window has actually moved on.
        const now = Date.now();
        setSessionCookie(
          res,
          signSession({ v: 1, iat: now, exp: now + config.session.ttlSeconds * 1000 }),
          config.session.ttlSeconds,
        );
      }
      next();
      return;
    }
  }

  // Nothing configured at all: local development stays open (unchanged).
  if (!config.authToken && !config.passwordHash) {
    next();
    return;
  }

  res.status(401).json({
    error: {
      code: 'unauthorized',
      message: config.passwordHash
        ? 'Please log in again.'
        : 'A valid GameVault access token is required.',
    },
  });
}

/** Endpoints reachable before authenticating (needed to render the login screen). */
export const PUBLIC_PATHS = new Set(['/health', '/capabilities']);
