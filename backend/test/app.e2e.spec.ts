import { Column, DataSource, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { Router } from 'express';
import request from 'supertest';
import { createApp } from '../src/app';
import { createLogger } from '../src/common/logger';
import { loadConfig } from '../src/config/env';
import { createDataSource } from '../src/database/data-source';
import { createHealthModule } from '../src/modules/health/health.module';
import { appOptions, authed, TEST_API_KEY } from './support';

// Test-only entity: proves the real better-sqlite3 error code is what the handler matches.
@Entity()
class Widget {
  @PrimaryGeneratedColumn() id!: number;
  @Column({ unique: true }) name!: string;
}

const config = loadConfig({ API_KEY: TEST_API_KEY, DB_PATH: ':memory:', NODE_ENV: 'test' });
const logger = createLogger(config);
const SHAPE = ['details', 'error', 'message', 'path', 'requestId', 'statusCode', 'timestamp'];

describe('app (e2e)', () => {
  let dataSource: DataSource;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    dataSource = createDataSource(config);
    await dataSource.initialize();
    app = createApp([createHealthModule(dataSource)], logger, appOptions);
  });

  afterEach(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
  });

  it('GET /health returns 200 with a request id header', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'up' });
    expect(res.body.timestamp).toEqual(expect.any(String));
    expect(res.headers['x-request-id']).toBeTruthy();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('GET /health returns 503 when the database is gone', async () => {
    await dataSource.destroy();
    const res = await request(app).get('/health').expect(503);
    expect(Object.keys(res.body).sort()).toEqual(SHAPE);
    expect(res.body).toMatchObject({ statusCode: 503, message: 'Database unavailable', details: null });
  });

  it('GET /health reports redis up, and down (still 200) when the ping fails', async () => {
    const up = createApp([createHealthModule(dataSource, () => Promise.resolve())], logger, appOptions);
    expect((await request(up).get('/health').expect(200)).body).toMatchObject({ database: 'up', redis: 'up' });

    const down = createApp([createHealthModule(dataSource, () => Promise.reject(new Error('ECONNREFUSED')))], logger, appOptions);
    const res = await request(down).get('/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'up', redis: 'down' });
    expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED');
  });

  it('returns a standard 404 for unknown routes', async () => {
    const res = await authed(app).get('/nope?x=1').expect(404);
    expect(Object.keys(res.body).sort()).toEqual(SHAPE);
    expect(res.body).toMatchObject({ statusCode: 404, error: 'Not Found', path: '/nope' });
  });

  it('returns 400 for malformed JSON', async () => {
    const res = await authed(app)
      .post('/anything')
      .set('Content-Type', 'application/json')
      .send('{"broken":')
      .expect(400);
    expect(Object.keys(res.body).sort()).toEqual(SHAPE);
    expect(res.body.message).toBe('Malformed JSON in request body');
  });

  it('returns 413 for an oversized body', async () => {
    const res = await authed(app)
      .post('/anything')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ pad: 'x'.repeat(150 * 1024) }))
      .expect(413);
    expect(Object.keys(res.body).sort()).toEqual(SHAPE);
  });

  it('echoes an incoming X-Request-Id in header and error body', async () => {
    const res = await authed(app).get('/nope').set('X-Request-Id', 'trace-42').expect(404);
    expect(res.headers['x-request-id']).toBe('trace-42');
    expect(res.body.requestId).toBe('trace-42');
  });

  it('replaces an unsafe X-Request-Id', async () => {
    const res = await authed(app).get('/nope').set('X-Request-Id', 'bad id with spaces').expect(404);
    expect(res.headers['x-request-id']).not.toBe('bad id with spaces');
  });

  it('maps a real unique-constraint violation to 409', async () => {
    const widgetDs = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Widget],
      synchronize: true,
    });
    await widgetDs.initialize();
    try {
      const router = Router();
      router.post('/widgets', async (_req, res) => {
        const repo = widgetDs.getRepository(Widget);
        await repo.insert({ name: 'dup' });
        await repo.insert({ name: 'dup' });
        res.status(201).end();
      });
      const testApp = createApp([{ router }], logger, appOptions);
      const res = await authed(testApp).post('/widgets').expect(409);
      expect(res.body).toMatchObject({ statusCode: 409, message: 'Resource already exists' });
      expect(JSON.stringify(res.body)).not.toMatch(/INSERT|UNIQUE|SQLITE/i);
    } finally {
      await widgetDs.destroy();
    }
  });
});
