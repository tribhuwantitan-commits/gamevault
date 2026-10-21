import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../types.js';

export function notFound(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'not_found', message: `No route for ${req.method} ${req.path}` },
  });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details ?? undefined },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'validation_failed',
        message: 'The request payload is invalid.',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }

  const anyErr = err as { type?: string; status?: number; message?: string };
  if (anyErr?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'invalid_json', message: 'Request body is not valid JSON.' } });
    return;
  }
  if (anyErr?.type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'payload_too_large', message: 'Request body is too large.' } });
    return;
  }

  // Unexpected: log server-side only, return a generic message to the client.
  console.error(`[gamevault] unhandled error on ${req.method} ${req.path}:`, anyErr?.message ?? err);
  res.status(500).json({
    error: { code: 'internal_error', message: 'Something went wrong on the server. Please retry.' },
  });
}
