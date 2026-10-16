import fs from 'node:fs';
import path from 'node:path';
import express, { Express } from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { parse } from 'yaml';
import { Logger } from './common/logger';
import { AppModule } from './common/types';
import { createApiKeyAuth } from './common/middleware/api-key-auth';
import { createCors } from './common/middleware/cors';
import { createRateLimiter } from './common/middleware/rate-limit';
import { requestId } from './common/middleware/request-id';
import { notFound } from './common/middleware/not-found';
import { errorHandler } from './common/middleware/error-handler';

export interface AppOptions {
  apiKey: string;
  corsOrigins: readonly string[];
  rateLimit: { windowMs: number; max: number; createMax: number };
}

// Two levels up from both src/ and dist/ lands on the repo root, so the same path works
// for ts-jest, tsx and the compiled server.
const OPENAPI_PATH = path.resolve(__dirname, '../../docs/openapi.yaml');

export function createApp(modules: AppModule[], logger: Logger, options: AppOptions): Express {
  const app = express();
  const openApiSpec = parse(fs.readFileSync(OPENAPI_PATH, 'utf8')) as swaggerUi.JsonObject;

  // Security headers and CORS first, so even rejected requests (401, 429) carry them and
  // browser preflights are answered before any auth check.
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(createCors(options.corsOrigins));

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      // Reuse the id from requestId so every log line correlates with the response.
      genReqId: (req) => req.id,
      customAttributeKeys: { reqId: 'requestId' },
    }),
  );

  // Before auth, so guessing API keys is rate limited too.
  app.use(createRateLimiter({ windowMs: options.rateLimit.windowMs, limit: options.rateLimit.max }));

  // Small cap: payment bodies are tiny, and a large body is cheap for an attacker to send.
  app.use(express.json({ limit: '10kb' }));

  for (const m of modules) if (m.public) app.use(m.router);
  // The docs carry no data and must be readable without a key.
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));

  // Everything below needs the key. Unknown routes land here too, so they answer 401
  // rather than 404 without a key, which does not reveal which paths exist.
  app.use(createApiKeyAuth(options.apiKey));

  // Stricter limit for creating payments, mounted ahead of the payments router. It only
  // matches POST /payments, so reads stay on the global limit.
  app.post('/payments', createRateLimiter({ windowMs: options.rateLimit.windowMs, limit: options.rateLimit.createMax }));

  for (const m of modules) if (!m.public) app.use(m.router);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
