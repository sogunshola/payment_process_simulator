import express, { Express } from 'express';
import pinoHttp from 'pino-http';
import { Logger } from './common/logger';
import { AppModule } from './common/types';
import { requestId } from './common/middleware/request-id';
import { notFound } from './common/middleware/not-found';
import { errorHandler } from './common/middleware/error-handler';

export function createApp(modules: AppModule[], logger: Logger): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      // Reuse the id from requestId so every log line correlates with the response.
      genReqId: (req) => req.id,
      customAttributeKeys: { reqId: 'requestId' },
    }),
  );
  app.use(express.json({ limit: '100kb' }));

  for (const m of modules) app.use(m.router);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
