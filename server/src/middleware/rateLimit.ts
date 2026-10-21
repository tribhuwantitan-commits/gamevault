import type { NextFunction, Request, Response } from 'express';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Minimal fixed-window limiter. Good enough for a single-user library and it
 * keeps the dependency list short. For multi-instance deployments put a real
 * limiter (or a gateway) in front of the API.
 */
export function rateLimit(options: { windowMs: number; max: number; name: string }) {
  const buckets = new Map<string, Bucket>();

  return function limiter(req: Request, res: Response, next: NextFunction): void {
    const key = `${options.name}:${req.ip ?? 'unknown'}`;
    const now = Date.now();
    const current = buckets.get(key);

    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      if (buckets.size > 5000) {
        for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
      }
      next();
      return;
    }

    current.count += 1;
    if (current.count > options.max) {
      const retryAfter = Math.ceil((current.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        error: {
          code: 'rate_limited',
          message: `Too many requests. Try again in ${retryAfter}s.`,
        },
      });
      return;
    }
    next();
  };
}
