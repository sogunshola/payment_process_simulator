import { Request, Response } from 'express';
import { requestId } from './request-id';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function run(header?: string) {
  const req = { header: () => header } as unknown as Request;
  const setHeader = jest.fn();
  const next = jest.fn();
  requestId(req, { setHeader } as unknown as Response, next);
  return { req, setHeader, next };
}

describe('requestId', () => {
  it('echoes a valid incoming id', () => {
    const { req, setHeader, next } = run('abc-123_X.y');
    expect(req.id).toBe('abc-123_X.y');
    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', 'abc-123_X.y');
    expect(next).toHaveBeenCalled();
  });

  it('generates a UUID when missing', () => {
    const { req, setHeader } = run(undefined);
    expect(req.id).toMatch(UUID);
    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', req.id);
  });

  it.each([
    ['too long', 'a'.repeat(129)],
    ['newline', 'abc\nSet-Cookie: x=1'],
    ['spaces', 'has spaces'],
    ['empty', ''],
  ])('replaces an invalid id (%s)', (_label, bad) => {
    const { req } = run(bad);
    expect(req.id).toMatch(UUID);
  });
});
