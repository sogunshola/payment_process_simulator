import cors from 'cors';

export function createCors(allowedOrigins: readonly string[]) {
  return cors({
    origin: (origin, callback) => {
      // No Origin header means curl or another server, not a browser: CORS does not apply.
      if (origin === undefined || allowedOrigins.includes(origin)) return callback(null, true);
      // Not an error: omitting Access-Control-Allow-Origin is what makes the browser block
      // the response. Failing the request would only add noise for non-browser callers.
      callback(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-API-Key', 'Idempotency-Key', 'X-Request-Id'],
    // Headers the browser may not read from a cross-origin response unless listed here.
    exposedHeaders: ['X-Request-Id', 'Location', 'Idempotent-Replayed', 'RateLimit', 'RateLimit-Policy', 'Retry-After'],
  });
}
