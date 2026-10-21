import express, { type Express } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config, REPO_ROOT, SERVER_ROOT } from './config.js';
import { requireAuth, PUBLIC_PATHS } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { rateLimit } from './middleware/rateLimit.js';
import { assetsRouter } from './routes/assets.js';
import { collectionsRouter } from './routes/collections.js';
import { metaRouter } from './routes/meta.js';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // --- Security headers (no extra dependency needed) ---
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    if (config.isProduction) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  // --- CORS: only the origins you explicitly allow (the Vite dev server by default) ---
  app.use((req, res, next) => {
    const origin = req.get('origin');
    const allowed = config.allowedOrigins;
    const originAllowed =
      !!origin &&
      (allowed.includes('*') || allowed.some((o) => o.toLowerCase() === origin.toLowerCase()));

    if (originAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin!);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-GameVault-Token');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') {
      res.status(originAllowed ? 204 : 403).end();
      return;
    }
    next();
  });

  app.use(express.json({ limit: '256kb' }));

  // --- API ---
  const api = express.Router();
  api.use('/health', rateLimit({ windowMs: 60_000, max: 120, name: 'health' }));
  api.use(rateLimit({ windowMs: 60_000, max: 600, name: 'api' }));
  api.use((req, res, next) => {
    // /health and /capabilities stay open so the UI can boot in a setup state.
    if (PUBLIC_PATHS.has(req.path)) return next();
    return requireAuth(req, res, next);
  });

  api.use('/', metaRouter);
  api.use('/assets', assetsRouter);
  api.use('/collections', collectionsRouter);
  app.use('/api', api);

  // --- Production: serve the built SPA (same origin, no CORS needed) ---
  const clientDist = path.join(REPO_ROOT, 'client', 'dist');
  if (fs.existsSync(clientDist)) {
    // `redirect: false` matters: the SPA route `/assets` collides with Vite's
    // `dist/assets/` build folder, and express.static would otherwise answer with a
    // cacheable 301 before the SPA fallback below ever runs.
    app.use(
      express.static(clientDist, { index: false, redirect: false, maxAge: '1h', etag: true }),
    );
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  } else if (config.isProduction) {
    console.warn(
      `[gamevault] No client build found at ${path.relative(REPO_ROOT, clientDist)}. Run "npm run build" at the repo root, or host the client separately.`,
    );
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export { SERVER_ROOT };
