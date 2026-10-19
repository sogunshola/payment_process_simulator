import http from 'node:http';
import { AddressInfo } from 'node:net';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppOptions, createApp } from '../src/app';
import { createLogger } from '../src/common/logger';
import { loadConfig } from '../src/config/env';
import { createDataSource } from '../src/database/data-source';
import { createGatewayModule } from '../src/modules/gateway/gateway.module';
import { createHealthModule } from '../src/modules/health/health.module';
import { createPaymentsModule } from '../src/modules/payments/payments.module';
import { appOptions, authed, createFakeQueue, TEST_API_KEY } from './support';

const config = loadConfig({ API_KEY: TEST_API_KEY, DB_PATH: ':memory:', NODE_ENV: 'test' });
const logger = createLogger(config);
const SHAPE = ['details', 'error', 'message', 'path', 'requestId', 'statusCode', 'timestamp'];
const ALLOWED_ORIGIN = 'http://localhost:5173';
const valid = { amount: 5000, currency: 'NGN' };

describe('security (e2e)', () => {
  let dataSource: DataSource;

  beforeEach(async () => {
    dataSource = createDataSource(config);
    await dataSource.initialize();
  });

  afterEach(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
  });

  const queue = createFakeQueue();
  const build = (options: AppOptions = appOptions) =>
    createApp(
      [createHealthModule(dataSource), createPaymentsModule(dataSource, queue, logger), createGatewayModule(config.gateway, logger)],
      logger,
      options,
    );

  describe('API key', () => {
    it('401 without a key, in the shared error shape', async () => {
      const res = await request(build()).get('/payments').expect(401);
      expect(Object.keys(res.body).sort()).toEqual(SHAPE);
      expect(res.body).toMatchObject({ statusCode: 401, error: 'Unauthorized', message: 'Missing API key' });
    });

    it('401 with a wrong key of the same length', async () => {
      const wrong = 'x'.repeat(TEST_API_KEY.length);
      const res = await request(build()).get('/payments').set('X-API-Key', wrong).expect(401);
      expect(Object.keys(res.body).sort()).toEqual(SHAPE);
      expect(res.body.message).toBe('Invalid API key');
    });

    it.each(['short', `${TEST_API_KEY}-and-more`, ''])('401 with a key of a different length %j', async (key) => {
      // An empty header value is sent as "" and must be rejected like any other wrong key.
      const res = await request(build()).get('/payments').set('X-API-Key', key).expect(401);
      expect(res.body.message).toBe('Invalid API key');
    });

    it('401 when the header is sent twice, even if both copies are correct', async () => {
      // superagent collapses repeated .set() calls, so send the raw request with node:http.
      const server = build().listen(0);
      try {
        const { port } = server.address() as AddressInfo;
        const status = await new Promise<number>((resolve, reject) => {
          const req = http.request(
            { port, path: '/payments', headers: { 'x-api-key': [TEST_API_KEY, TEST_API_KEY] } },
            (res) => {
              res.resume();
              resolve(res.statusCode ?? 0);
            },
          );
          req.on('error', reject);
          req.end();
        });
        expect(status).toBe(401);
      } finally {
        server.close();
      }
    });

    it('200 with the correct key', async () => {
      await authed(build()).get('/payments').expect(200);
    });

    it('does not echo the key in the 401 body', async () => {
      const res = await request(build()).get('/payments').set('X-API-Key', 'secret-guess-123').expect(401);
      expect(JSON.stringify(res.body)).not.toContain('secret-guess-123');
    });

    it('/health is reachable without a key', async () => {
      await request(build()).get('/health').expect(200);
    });

    it('/docs is reachable without a key and serves Swagger UI', async () => {
      // /docs redirects to /docs/; follow it like a browser would.
      const redirect = await request(build()).get('/docs').expect(301);
      expect(redirect.headers.location).toBe('/docs/');
      const res = await request(build()).get('/docs/').expect(200);
      expect(res.headers['content-type']).toMatch(/html/);
      expect(res.text.toLowerCase()).toContain('swagger');
    });

    it('answers 401 for an unknown route without a key, 404 with one', async () => {
      const app = build();
      const noKey = await request(app).get('/nope').expect(401);
      expect(noKey.body.message).toBe('Missing API key');
      const withKey = await authed(app).get('/nope').expect(404);
      expect(Object.keys(withKey.body).sort()).toEqual(SHAPE);
    });
  });

  describe('rate limiting', () => {
    const tiny = (max: number, createMax: number): AppOptions => ({
      ...appOptions,
      rateLimit: { windowMs: 60_000, max, createMax },
    });

    it('global limiter: the request over the limit gets 429 in the shared shape with RateLimit headers', async () => {
      const app = build(tiny(2, 100));
      await authed(app).get('/payments/stats').expect(200);
      await authed(app).get('/payments/stats').expect(200);
      const res = await authed(app).get('/payments/stats').expect(429);
      expect(Object.keys(res.body).sort()).toEqual(SHAPE);
      expect(res.body).toMatchObject({ statusCode: 429, message: 'Too many requests, please try again later' });
      expect(res.headers['ratelimit']).toBeTruthy();
      expect(res.headers['ratelimit-policy']).toBeTruthy();
      expect(res.headers['retry-after']).toBeTruthy();
      expect(res.headers['x-ratelimit-limit']).toBeUndefined();
    });

    it('global limiter runs before auth, so wrong keys are limited too', async () => {
      const app = build(tiny(2, 100));
      await request(app).get('/payments').set('X-API-Key', 'guess-1').expect(401);
      await request(app).get('/payments').set('X-API-Key', 'guess-2').expect(401);
      await request(app).get('/payments').set('X-API-Key', 'guess-3').expect(429);
    });

    it('create limiter: POST /payments hits 429 while GET /payments still works', async () => {
      const app = build(tiny(100, 2));
      await authed(app).post('/payments').send(valid).expect(202);
      await authed(app).post('/payments').send(valid).expect(202);
      const res = await authed(app).post('/payments').send(valid).expect(429);
      expect(Object.keys(res.body).sort()).toEqual(SHAPE);
      await authed(app).get('/payments').expect(200);
    });
  });

  describe('CORS', () => {
    it('echoes an allowed origin and exposes headers', async () => {
      const res = await authed(build()).get('/payments').set('Origin', ALLOWED_ORIGIN).expect(200);
      expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
      expect(res.headers['access-control-expose-headers']).toContain('Idempotent-Replayed');
    });

    it('sends no Access-Control-Allow-Origin for an unknown origin (and does not fail the request)', async () => {
      const res = await authed(build()).get('/payments').set('Origin', 'https://evil.example.com').expect(200);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('answers a preflight from an allowed origin, before auth', async () => {
      const res = await request(build())
        .options('/payments')
        .set('Origin', ALLOWED_ORIGIN)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'x-api-key,idempotency-key,content-type')
        .expect(204);
      expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
      const allowed = res.headers['access-control-allow-headers'].toLowerCase();
      expect(allowed).toContain('x-api-key');
      expect(allowed).toContain('idempotency-key');
      expect(res.headers['access-control-allow-methods']).toContain('PATCH');
    });

    it('gives a preflight from an unknown origin no allow headers', async () => {
      const res = await request(build())
        .options('/payments')
        .set('Origin', 'https://evil.example.com')
        .set('Access-Control-Request-Method', 'POST');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('security headers', () => {
    it('sets helmet headers and hides X-Powered-By, even on a 401', async () => {
      const res = await request(build()).get('/payments').expect(401);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toContain("frame-ancestors 'self'");
      expect(res.headers['strict-transport-security']).toBeTruthy();
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('body size limit', () => {
    it('413 for a body over 10kb, in the shared shape', async () => {
      const res = await authed(build())
        .post('/payments')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ ...valid, pad: 'x'.repeat(11 * 1024) }))
        .expect(413);
      expect(Object.keys(res.body).sort()).toEqual(SHAPE);
      expect(res.body.message).toBe('Request body too large');
    });

    it('does not 413 a body just under 10kb (it reaches validation instead)', async () => {
      const res = await authed(build())
        .post('/payments')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ ...valid, pad: 'x'.repeat(10 * 1024 - 200) }))
        .expect(400);
      expect(res.body.message).toBe('Validation failed');
    });
  });
});
