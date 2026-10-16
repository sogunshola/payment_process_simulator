import pino, { DestinationStream, Logger } from 'pino';
import { AppConfig } from '../config/env';

export type { Logger };

export function createLogger(config: AppConfig, destination?: DestinationStream): Logger {
  return pino(
    {
      level: config.nodeEnv === 'test' ? 'silent' : 'info',
      redact: [
        // Credentials must never reach log storage.
        'req.headers.authorization',
        'req.headers["x-api-key"]',
        // Customer PII. pino-http does not log bodies and no code logs a Payment, so this is
        // defence in depth against a future `logger.info({ payment })` or body log.
        'customerEmail',
        '*.customerEmail',
        '*.*.customerEmail',
        'req.body.customerEmail',
      ],
      serializers: {
        err: (err: Error) => {
          const serialized: Record<string, unknown> = pino.stdSerializers.err(err);
          // TypeORM's QueryFailedError carries the bound SQL parameters, which for an
          // INSERT include customerEmail; the redact paths above cannot see inside them.
          delete serialized.parameters;
          delete serialized.query;
          return serialized;
        },
      },
    },
    destination,
  );
}
