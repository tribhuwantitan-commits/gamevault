import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { safeEqual } from '../lib/util.js';

/**
 * Optional shared-secret gate.
 *
 * The bucket is private either way, but this API is the control plane: without a
 * token anyone who can reach the server can list, download and delete assets.
 * Set GAMEVAULT_AUTH_TOKEN before exposing GameVault to any network.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!config.authToken) {
    next();
    return;
  }
  const header = req.get('x-gamevault-token') ?? '';
  const bearer = (req.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const provided = header || bearer;

  if (!provided || !safeEqual(provided, config.authToken)) {
    res.status(401).json({
      error: {
        code: 'unauthorized',
        message: 'A valid GameVault access token is required.',
      },
    });
    return;
  }
  next();
}

/** Read-only, non-sensitive endpoints usable before unlocking the UI. */
export const PUBLIC_PATHS = new Set(['/health', '/capabilities']);
