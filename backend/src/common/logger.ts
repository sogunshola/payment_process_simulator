import pino, { Logger } from 'pino';
import { AppConfig } from '../config/env';

export type { Logger };

export function createLogger(config: AppConfig): Logger {
  return pino({
    level: config.nodeEnv === 'test' ? 'silent' : 'info',
    // Credentials must never reach log storage.
    redact: ['req.headers.authorization', 'req.headers["x-api-key"]'],
  });
}
