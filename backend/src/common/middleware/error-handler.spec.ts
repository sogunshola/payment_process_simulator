import { NextFunction, Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { errorHandler } from './error-handler';
import {
  AppError,
  BadRequestError,
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
  UnauthorizedError,
} from '../errors';

const KEYS = ['details', 'error', 'message', 'path', 'requestId', 'statusCode', 'timestamp'];

function setup(overrides: Partial<Request> = {}, headersSent = false) {
  const errorLog = jest.fn();
  const req = {
    originalUrl: '/things/1?token=secret',
    id: 'req-1',
    log: { error: errorLog },
    ...overrides,
  } as unknown as Request;
  const json = jest.fn();
  const res = { headersSent, status: jest.fn().mockReturnThis(), json } as unknown as Response;
  const next = jest.fn() as unknown as NextFunction;
  const body = () => json.mock.calls[0][0] as Record<string, unknown>;
  return { req, res, next, json, errorLog, body };
}

function run(err: unknown) {
  const ctx = setup();
  errorHandler(err, ctx.req, ctx.res, ctx.next);
  return ctx;
}

function expectShape(body: Record<string, unknown>) {
  expect(Object.keys(body).sort()).toEqual(KEYS);
  expect(body.path).toBe('/things/1');
  expect(body.requestId).toBe('req-1');
  expect(new Date(body.timestamp as string).toISOString()).toBe(body.timestamp);
}

describe('errorHandler', () => {
  it('delegates to next when headers were already sent', () => {
    const ctx = setup({}, true);
    const err = new Error('late');
    errorHandler(err, ctx.req, ctx.res, ctx.next);
    expect(ctx.next).toHaveBeenCalledWith(err);
    expect(ctx.json).not.toHaveBeenCalled();
  });

  it.each([
    [new BadRequestError('bad'), 400, 'Bad Request'],
    [new UnauthorizedError('nope'), 401, 'Unauthorized'],
    [new NotFoundError('missing'), 404, 'Not Found'],
    [new ConflictError('dup'), 409, 'Conflict'],
    [new ServiceUnavailableError('down'), 503, 'Service Unavailable'],
  ])('maps %p to %i', (err, status, label) => {
    const { body, res } = run(err);
    expect(res.status).toHaveBeenCalledWith(status);
    expectShape(body());
    expect(body()).toMatchObject({ statusCode: status, error: label, message: err.message, details: null });
  });

  it('passes AppError details through', () => {
    const details = [{ field: 'amount', message: 'must be an integer' }];
    const { body } = run(new BadRequestError('Validation failed', details));
    expect(body().details).toEqual(details);
  });

  it('handles a bare AppError with a custom status', () => {
    const { body, res } = run(new AppError('teapot', 418));
    expect(res.status).toHaveBeenCalledWith(418);
    expectShape(body());
  });

  it('maps malformed JSON to 400', () => {
    const { body, res } = run(Object.assign(new SyntaxError('Unexpected token'), { type: 'entity.parse.failed', status: 400, expose: true }));
    expect(res.status).toHaveBeenCalledWith(400);
    expect(body().message).toBe('Malformed JSON in request body');
    expectShape(body());
  });

  it('maps oversized body to 413', () => {
    const { body, res } = run(Object.assign(new Error('too big'), { type: 'entity.too.large', status: 413, expose: true }));
    expect(res.status).toHaveBeenCalledWith(413);
    expect(body().message).toBe('Request body too large');
    expectShape(body());
  });

  it('maps other exposable 4xx errors to a generic message', () => {
    const { body, res } = run(Object.assign(new Error('unsupported charset "UTF-3"'), { type: 'charset.unsupported', status: 415, expose: true }));
    expect(res.status).toHaveBeenCalledWith(415);
    expect(body().message).toBe('Unsupported Media Type');
    expect(JSON.stringify(body())).not.toContain('UTF-3');
    expectShape(body());
  });

  it('does not expose a 4xx error that is not flagged expose', () => {
    const { res } = run(Object.assign(new Error('internal'), { status: 400, expose: false }));
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it.each(['SQLITE_CONSTRAINT_UNIQUE', 'SQLITE_CONSTRAINT_PRIMARYKEY'])(
    'maps %s to 409 without leaking SQL',
    (code) => {
      const sql = 'INSERT INTO secret_table VALUES (?)';
      const err = new QueryFailedError(sql, ['x'], Object.assign(new Error('UNIQUE constraint failed: secret_table.col'), { code }));
      const { body, res, errorLog } = run(err);
      expect(res.status).toHaveBeenCalledWith(409);
      expect(body().message).toBe('Resource already exists');
      expect(JSON.stringify(body())).not.toMatch(/secret_table|INSERT/);
      expect(errorLog).not.toHaveBeenCalled();
      expectShape(body());
    },
  );

  it('maps other QueryFailedError to 500', () => {
    const err = new QueryFailedError('SELECT 1', [], Object.assign(new Error('boom'), { code: 'SQLITE_BUSY' }));
    const { body, res, errorLog } = run(err);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(body().message).toBe('Internal server error');
    expect(errorLog).toHaveBeenCalled();
  });

  it('maps unknown errors to a generic 500 and logs the error server-side', () => {
    const err = new Error('db password is hunter2');
    const { body, res, errorLog } = run(err);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(body()).toMatchObject({ statusCode: 500, error: 'Internal Server Error', message: 'Internal server error', details: null });
    expect(JSON.stringify(body())).not.toMatch(/hunter2|at .*\.ts/);
    expect(errorLog).toHaveBeenCalledWith({ err }, expect.any(String));
    expectShape(body());
  });

  it('maps a thrown non-Error value to 500', () => {
    const { body, res } = run('just a string');
    expect(res.status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(body())).not.toContain('just a string');
    expectShape(body());
  });

  it('still responds when req.log is absent', () => {
    const ctx = setup({ log: undefined } as Partial<Request>);
    errorHandler(new Error('x'), ctx.req, ctx.res, ctx.next);
    expect(ctx.json).toHaveBeenCalled();
  });
});
