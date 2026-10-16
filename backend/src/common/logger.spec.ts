import { Writable } from 'node:stream';
import { QueryFailedError } from 'typeorm';
import { loadConfig } from '../config/env';
import { createLogger } from './logger';

// 'test' env silences the logger, so use development to get real output.
const config = loadConfig({ API_KEY: 'a-very-secret-key-1234', NODE_ENV: 'development' });

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { logger: createLogger(config, stream), output: () => lines.join('') };
}

describe('createLogger redaction', () => {
  it('redacts customerEmail at every depth we guard', () => {
    const { logger, output } = capture();
    logger.info({ customerEmail: 'top@example.com' }, 'top');
    logger.info({ payment: { customerEmail: 'one@example.com' } }, 'one level');
    logger.info({ a: { b: { customerEmail: 'two@example.com' } } }, 'two levels');
    logger.info({ req: { body: { customerEmail: 'body@example.com' } } }, 'req body');
    expect(output()).toContain('[Redacted]');
    expect(output()).not.toMatch(/@example\.com/);
  });

  it('redacts the x-api-key and authorization request headers', () => {
    const { logger, output } = capture();
    logger.info(
      { req: { headers: { 'x-api-key': 'super-secret-key', authorization: 'Bearer abc.def', accept: '*/*' } } },
      'request',
    );
    expect(output()).toContain('[Redacted]');
    expect(output()).not.toContain('super-secret-key');
    expect(output()).not.toContain('Bearer abc.def');
    expect(output()).toContain('*/*');
  });

  it('drops SQL and bound parameters from a logged database error', () => {
    const { logger, output } = capture();
    const err = new QueryFailedError('INSERT INTO payments VALUES (?)', ['leak@example.com'], new Error('boom'));
    logger.error({ err }, 'db failure');
    expect(output()).toContain('db failure');
    expect(output()).not.toContain('leak@example.com');
    expect(output()).not.toContain('INSERT INTO');
  });
});
