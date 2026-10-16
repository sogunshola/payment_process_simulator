import { NextFunction, Request, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { TooManyRequestsError } from '../errors';

export interface RateLimitOptions {
  windowMs: number;
  limit: number;
}

/**
 * Counts live in the default in-memory store, so they are per process. That matches the
 * single-instance assumption of the rest of the service; several instances would need a
 * shared store (e.g. Redis).
 *
 * Clients are keyed by IP. Behind a reverse proxy every request would appear to come from
 * the proxy, so `app.set('trust proxy', ...)` must be configured for the real client IP.
 */
export function createRateLimiter({ windowMs, limit }: RateLimitOptions) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Hand the error to the global handler so a 429 has the same JSON shape as any other
    // error. The library still sets the RateLimit and Retry-After headers before this runs.
    handler: (_req: Request, _res: Response, next: NextFunction) => {
      next(new TooManyRequestsError('Too many requests, please try again later'));
    },
  });
}
