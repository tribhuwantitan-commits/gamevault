import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import {
  clearSessionCookie,
  readSessionCookie,
  setSessionCookie,
  signSession,
  validatePasswordStrength,
  verifyPassword,
  verifySession,
} from '../lib/password.js';
import { rateLimit } from '../middleware/rateLimit.js';

export const authRouter = Router();

const loginSchema = z.object({ password: z.string().max(200) });

/** 10 attempts per 15 minutes per IP — a login endpoint should not be brute-forceable. */
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, max: 10, name: 'login' });

function sessionBody(payload: { exp: number }) {
  return {
    authenticated: true,
    passwordLoginEnabled: Boolean(config.passwordHash),
    expiresAt: new Date(payload.exp).toISOString(),
    ttlSeconds: config.session.ttlSeconds,
  };
}

/**
 * GET /api/auth/session — public. Tells the UI which login mode to show.
 * Never returns the password hash or the API token.
 */
authRouter.get('/session', (req, res) => {
  const token = readSessionCookie(req);
  const payload = token ? verifySession(token) : null;

  if (payload) {
    res.setHeader('Cache-Control', 'no-store');
    res.json(sessionBody(payload));
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    authenticated: false,
    passwordLoginEnabled: Boolean(config.passwordHash),
    expiresAt: null,
    ttlSeconds: config.session.ttlSeconds,
  });
});

/** POST /api/auth/login — verify the password, then issue an HttpOnly session cookie. */
authRouter.post('/login', loginLimiter, async (req, res, next) => {
  try {
    if (!config.passwordHash) {
      res.status(400).json({
        error: {
          code: 'password_login_disabled',
          message:
            'Password login is not configured. Set GAMEVAULT_PASSWORD_HASH on the server, or use the API token.',
        },
      });
      return;
    }

    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'validation_failed', message: 'A password is required.' } });
      return;
    }

    const problem = validatePasswordStrength(parsed.data.password);
    // A too-short password cannot match anyway; answer generically.
    const ok = problem === null && (await verifyPassword(parsed.data.password, config.passwordHash));

    if (!ok) {
      // Small fixed delay to blunt scripted guessing further.
      await new Promise((resolve) => setTimeout(resolve, 250));
      res.status(401).json({
        error: { code: 'invalid_password', message: 'That password is not correct.' },
      });
      return;
    }

    const now = Date.now();
    const payload = { v: 1 as const, iat: now, exp: now + config.session.ttlSeconds * 1000 };
    setSessionCookie(res, signSession(payload), config.session.ttlSeconds);
    res.setHeader('Cache-Control', 'no-store');
    res.json(sessionBody(payload));
  } catch (err) {
    next(err);
  }
});

/** POST /api/auth/logout — clears the session cookie. */
authRouter.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.setHeader('Cache-Control', 'no-store');
  res.status(204).end();
});
