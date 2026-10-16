import request from 'supertest';
import { createApp } from '../src/app';
import { createLogger } from '../src/common/logger';
import { loadConfig } from '../src/config/env';
import { createGatewayModule } from '../src/modules/gateway/gateway.module';

const config = loadConfig({ API_KEY: 'test-api-key-0123456789', DB_PATH: ':memory:', NODE_ENV: 'test' });
const logger = createLogger(config);
const valid = { minLatencyMs: 10, maxLatencyMs: 20, failureRate: 0.3, declineRate: 0.2, timeoutRate: 0.1 };

describe('gateway config (e2e)', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp([createGatewayModule(config.gateway, logger)], logger);
  });

  it('GET returns the current config', async () => {
    const res = await request(app).get('/gateway/config').expect(200);
    expect(res.body).toEqual(config.gateway);
  });

  it('PUT replaces the config and GET reflects it', async () => {
    const put = await request(app).put('/gateway/config').send(valid).expect(200);
    expect(put.body).toEqual(valid);
    const get = await request(app).get('/gateway/config').expect(200);
    expect(get.body).toEqual(valid);
  });

  it.each([
    ['rate above 1', { ...valid, failureRate: 1.5 }, 'failureRate'],
    ['negative rate', { ...valid, declineRate: -0.1 }, 'declineRate'],
    ['latency above 10000', { ...valid, maxLatencyMs: 10001 }, 'maxLatencyMs'],
    ['float latency', { ...valid, minLatencyMs: 1.5 }, 'minLatencyMs'],
    ['string rate', { ...valid, timeoutRate: '0.1' }, 'timeoutRate'],
    ['min greater than max', { ...valid, minLatencyMs: 500, maxLatencyMs: 100 }, 'maxLatencyMs'],
    ['rates summing above 1', { ...valid, failureRate: 0.6, declineRate: 0.3, timeoutRate: 0.2 }, 'timeoutRate'],
  ])('PUT rejects %s with 400 and names the field', async (_name, body, field) => {
    const res = await request(app).put('/gateway/config').send(body).expect(400);
    expect(res.body.message).toBe('Validation failed');
    expect(res.body.details).toEqual(expect.arrayContaining([expect.objectContaining({ field })]));
    expect(res.body).toEqual(
      expect.objectContaining({ statusCode: 400, error: expect.any(String), path: '/gateway/config' }),
    );
    // Nothing was applied.
    const get = await request(app).get('/gateway/config').expect(200);
    expect(get.body).toEqual(config.gateway);
  });

  it('PUT rejects a missing field', async () => {
    const body: Partial<typeof valid> = { ...valid };
    delete body.timeoutRate;
    const res = await request(app).put('/gateway/config').send(body).expect(400);
    expect(res.body.details).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'timeoutRate' })]));
  });

  it('PUT rejects an unknown field', async () => {
    const res = await request(app).put('/gateway/config').send({ ...valid, extra: 1 }).expect(400);
    expect(res.body.details).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'extra' })]));
  });
});
