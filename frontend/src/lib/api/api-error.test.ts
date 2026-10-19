import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, toApiError } from './api-error';
import { api } from './client';
import { saveSettings } from './settings';

const backendError = (over: Record<string, unknown> = {}) => ({
  statusCode: 400,
  error: 'Bad Request',
  message: 'Validation failed',
  details: null,
  path: '/payments',
  requestId: 'req-1',
  timestamp: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('toApiError', () => {
  it('maps field details and keeps requestId', () => {
    const e = toApiError(400, backendError({ details: [{ field: 'amount', message: 'must be an integer' }] }));
    expect(e).toBeInstanceOf(ApiError);
    expect(e.name).toBe('ApiError');
    expect(e.status).toBe(400);
    expect(e.message).toBe('Validation failed');
    expect(e.fieldErrors).toEqual({ amount: 'must be an integer' });
    expect(e.requestId).toBe('req-1');
  });

  it('joins several messages for the same field', () => {
    const e = toApiError(400, backendError({ details: [
      { field: 'description', message: 'too long' },
      { field: 'description', message: 'must not be empty' },
    ] }));
    expect(e.fieldErrors).toEqual({ description: 'too long; must not be empty' });
  });

  it('keeps an object details as-is with no field errors', () => {
    const d = { currentStatus: 'SUCCEEDED', requestedStatus: 'FAILED' };
    const e = toApiError(409, backendError({ message: 'Illegal transition', details: d }));
    expect(e.fieldErrors).toEqual({});
    expect(e.details).toEqual(d);
  });

  it('handles null details', () => {
    const e = toApiError(404, backendError({ message: 'Payment not found' }));
    expect(e.fieldErrors).toEqual({});
    expect(e.details).toBeNull();
  });

  it.each([
    [502, 'The server had a problem. Try again shortly'],
    [401, 'Missing or invalid API key'],
    [429, 'Too many requests, try again shortly'],
    [418, 'Request failed (418)'],
    [0, 'Cannot reach the API'],
  ])('falls back to a generic message for a non-JSON body (status %i)', (status, msg) => {
    expect(toApiError(status, '<html>Bad Gateway</html>').message).toBe(msg);
    expect(toApiError(status, undefined).message).toBe(msg);
    expect(toApiError(status, null).message).toBe(msg);
  });

  it('falls back when message is not a string', () => {
    const e = toApiError(500, { message: { nested: true } });
    expect(e.message).toBe('The server had a problem. Try again shortly');
  });

  it('skips malformed detail entries and ignores a non-string requestId', () => {
    const e = toApiError(400, {
      message: 'x',
      requestId: 42,
      details: [null, 'str', { field: 1, message: 'a' }, { field: 'ok' }, { field: 'good', message: 'fine' }],
    });
    expect(e.fieldErrors).toEqual({ good: 'fine' });
    expect(e.requestId).toBeUndefined();
  });

  it('never throws on arrays or primitives', () => {
    expect(() => toApiError(500, [1, 2])).not.toThrow();
    expect(() => toApiError(500, 7)).not.toThrow();
  });
});

describe('client', () => {
  beforeEach(() => {
    sessionStorage.clear();
    saveSettings({ apiUrl: 'http://api.test/', apiKey: 'secret-key' });
  });
  afterEach(() => vi.unstubAllGlobals());

  const jsonResponse = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('turns a rejected fetch into ApiError status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(api.getStats()).rejects.toMatchObject({ name: 'ApiError', status: 0, message: 'Cannot reach the API' });
  });

  it('throws ApiError for a non-2xx response and sends the API key without double slashes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, backendError({ statusCode: 401, message: 'Invalid API key' })));
    vi.stubGlobal('fetch', fetchMock);
    const err = await api.getStats().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.test/payments/stats');
    expect(init.headers['X-API-Key']).toBe('secret-key');
  });

  it('maps a proxy HTML error page to a generic ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>502</html>', { status: 502 })));
    await expect(api.getStats()).rejects.toMatchObject({ status: 502, message: 'The server had a problem. Try again shortly' });
  });

  it('does not send the API key to /health', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);
    await api.health();
    expect(fetchMock.mock.calls[0][1].headers['X-API-Key']).toBeUndefined();
  });

  it('sends a fresh UUID Idempotency-Key per create', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(202, { id: 'p' })));
    vi.stubGlobal('fetch', fetchMock);
    const input = { amount: 100, currency: 'USD' as const };
    await api.createPayment(input);
    await api.createPayment(input);
    const k1 = fetchMock.mock.calls[0][1].headers['Idempotency-Key'];
    const k2 = fetchMock.mock.calls[1][1].headers['Idempotency-Key'];
    expect(k1).toMatch(/^[0-9a-f-]{36}$/);
    expect(k2).toMatch(/^[0-9a-f-]{36}$/);
    expect(k1).not.toBe(k2);
    expect(fetchMock.mock.calls[0][1].headers['Content-Type']).toBe('application/json');
    expect(fetchMock.mock.calls[0][1].headers['X-API-Key']).toBe('secret-key');
  });
});
