import { DataSource } from 'typeorm';
import request from 'supertest';
import { createApp } from '../src/app';
import { createLogger } from '../src/common/logger';
import { loadConfig } from '../src/config/env';
import { createDataSource } from '../src/database/data-source';
import { createHealthModule } from '../src/modules/health/health.module';
import { PaymentStatus } from '../src/modules/payments/payment-status';
import { createPaymentsModule } from '../src/modules/payments/payments.module';
import { PaymentsRepository } from '../src/modules/payments/payments.repository';

const config = loadConfig({ API_KEY: 'test-api-key-0123456789', DB_PATH: ':memory:', NODE_ENV: 'test' });
const logger = createLogger(config);
const valid = { reference: 'inv-1', amount: 5000, currency: 'NGN' };
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

describe('payments (e2e)', () => {
  let dataSource: DataSource;
  let app: ReturnType<typeof createApp>;
  let repo: PaymentsRepository;

  beforeEach(async () => {
    dataSource = createDataSource(config);
    await dataSource.initialize();
    app = createApp([createHealthModule(dataSource), createPaymentsModule(dataSource)], logger);
    repo = new PaymentsRepository(dataSource);
  });

  afterEach(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
  });

  const post = (body: unknown, key?: string) => {
    const r = request(app).post('/payments');
    if (key !== undefined) r.set('Idempotency-Key', key);
    return r.send(body as object);
  };

  // The API cannot move a payment to PROCESSING, so tests do it through the repository.
  async function createProcessing() {
    const res = await post(valid).expect(202);
    const ok = await repo.updateIfStatus(
      res.body.id,
      { status: PaymentStatus.PENDING, version: res.body.version },
      { status: PaymentStatus.PROCESSING },
    );
    expect(ok).toBe(true);
    return res.body.id as string;
  }

  describe('POST /payments', () => {
    it('creates a PENDING payment', async () => {
      const res = await post({ ...valid, description: 'Order', customerEmail: 'a@b.com' }).expect(202);
      expect(res.headers.location).toBe(`/payments/${res.body.id}`);
      expect(res.body).toMatchObject({ status: 'PENDING', amount: 5000, currency: 'NGN', attempts: 0, version: 1 });
      expect(Number.isInteger(res.body.amount)).toBe(true);
      expect(res.body.history).toHaveLength(1);
      expect(res.body.history[0]).toMatchObject({ status: 'PENDING', note: 'Payment created' });
    });

    const bad: Array<[string, unknown, string]> = [
      ['missing reference', { amount: 5000, currency: 'NGN' }, 'reference'],
      ['float amount', { ...valid, amount: 100.5 }, 'amount'],
      ['negative amount', { ...valid, amount: -5 }, 'amount'],
      ['zero amount', { ...valid, amount: 0 }, 'amount'],
      ['string amount', { ...valid, amount: '100' }, 'amount'],
      ['amount over 1e9', { ...valid, amount: 1_000_000_001 }, 'amount'],
      ['unknown field', { ...valid, extra: 1 }, 'extra'],
      ['unsupported currency', { ...valid, currency: 'JPY' }, 'currency'],
      ['lowercase currency', { ...valid, currency: 'usd' }, 'currency'],
      ['bad email', { ...valid, customerEmail: 'nope' }, 'customerEmail'],
      ['reference too long', { ...valid, reference: 'x'.repeat(65) }, 'reference'],
      ['whitespace reference', { ...valid, reference: '   ' }, 'reference'],
    ];
    it.each(bad)('rejects %s with 400', async (_name, body, field) => {
      const res = await post(body).expect(400);
      expect(res.body.message).toBe('Validation failed');
      const fields = (res.body.details as Array<{ field: string }>).map((d) => d.field);
      expect(fields).toContain(field);
    });

    it.each(['has space', '', 'x'.repeat(256), 'bad/slash'])('rejects Idempotency-Key %j with 400', async (key) => {
      const res = await post(valid, key).expect(400);
      expect(res.body.message).toBe('Invalid Idempotency-Key header');
    });

    it('replays an identical request with the same key', async () => {
      const first = await post(valid, 'key-1').expect(202);
      const second = await post(valid, 'key-1').expect(200);
      expect(second.body.id).toBe(first.body.id);
      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(first.headers['idempotent-replayed']).toBeUndefined();
      const stats = await request(app).get('/payments/stats').expect(200);
      expect(stats.body.total).toBe(1);
    });

    it('returns 409 when the key is reused with a different body', async () => {
      await post(valid, 'key-2').expect(202);
      const res = await post({ ...valid, amount: 6000 }, 'key-2').expect(409);
      expect(res.body.message).toBe('Idempotency-Key has already been used with a different request');
    });

    it('handles two parallel requests with the same key', async () => {
      const [a, b] = await Promise.all([post(valid, 'race-key'), post(valid, 'race-key')]);
      expect([a.status, b.status].sort()).toEqual([200, 202]);
      expect(a.body.id).toBe(b.body.id);
      const stats = await request(app).get('/payments/stats').expect(200);
      expect(stats.body.total).toBe(1);
    });
  });

  describe('GET /payments/:id', () => {
    it('returns a payment', async () => {
      const created = await post(valid).expect(202);
      const res = await request(app).get(`/payments/${created.body.id}`).expect(200);
      expect(res.body.id).toBe(created.body.id);
    });

    it('400 for a non-UUID id', async () => {
      const res = await request(app).get('/payments/not-a-uuid').expect(400);
      expect(res.body.details[0].field).toBe('id');
    });

    it('404 for an unknown id', async () => {
      const res = await request(app).get(`/payments/${UNKNOWN_ID}`).expect(404);
      expect(res.body.message).toBe(`Payment ${UNKNOWN_ID} not found`);
    });
  });

  describe('GET /payments', () => {
    it('paginates newest first with a total', async () => {
      for (let i = 0; i < 5; i++) await post({ ...valid, reference: `r-${i}` }).expect(202);
      const p1 = await request(app).get('/payments?page=1&limit=2').expect(200);
      const p3 = await request(app).get('/payments?page=3&limit=2').expect(200);
      const p2 = await request(app).get('/payments?page=2&limit=2').expect(200);
      expect(p1.body).toMatchObject({ page: 1, limit: 2, total: 5 });
      expect(p1.body.data).toHaveLength(2);
      expect(p2.body.data).toHaveLength(2);
      expect(p3.body.data).toHaveLength(1);
      const ids = [...p1.body.data, ...p2.body.data, ...p3.body.data].map((p: { id: string }) => p.id);
      expect(new Set(ids).size).toBe(5);
    });

    it('defaults to page 1, limit 20', async () => {
      const res = await request(app).get('/payments').expect(200);
      expect(res.body).toMatchObject({ page: 1, limit: 20, total: 0, data: [] });
    });

    it('filters by status', async () => {
      const a = await post(valid).expect(202);
      await post(valid).expect(202);
      await request(app).patch(`/payments/${a.body.id}/status`).send({ status: 'CANCELLED' }).expect(200);
      const res = await request(app).get('/payments?status=CANCELLED').expect(200);
      expect(res.body.total).toBe(1);
      expect(res.body.data[0].id).toBe(a.body.id);
    });

    it.each(['limit=101', 'page=0', 'limit=abc', 'page=1.5', 'status=BOGUS'])('rejects ?%s with 400', async (qs) => {
      await request(app).get(`/payments?${qs}`).expect(400);
    });
  });

  describe('GET /payments/stats', () => {
    it('returns counts per status including zeros, and is not swallowed by :id', async () => {
      await post(valid).expect(202);
      await post(valid).expect(202);
      const res = await request(app).get('/payments/stats').expect(200);
      expect(res.body).toEqual({ PENDING: 2, PROCESSING: 0, SUCCEEDED: 0, FAILED: 0, CANCELLED: 0, total: 2 });
    });
  });

  describe('PATCH /payments/:id/status', () => {
    it('cancels a pending payment, appending history and bumping version', async () => {
      const created = await post(valid).expect(202);
      const res = await request(app)
        .patch(`/payments/${created.body.id}/status`)
        .send({ status: 'CANCELLED', reason: 'changed mind' })
        .expect(200);
      expect(res.body.status).toBe('CANCELLED');
      expect(res.body.version).toBe(2);
      expect(res.body.history).toHaveLength(2);
      expect(res.body.history[1]).toMatchObject({ status: 'CANCELLED', note: 'changed mind' });
      expect(new Date(res.body.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(created.body.updatedAt).getTime());
    });

    it('409 for an illegal transition, naming both statuses', async () => {
      const created = await post(valid).expect(202);
      const url = `/payments/${created.body.id}/status`;
      await request(app).patch(url).send({ status: 'CANCELLED' }).expect(200);
      const res = await request(app).patch(url).send({ status: 'PENDING' }).expect(409);
      expect(res.body.message).toBe('Cannot transition payment from CANCELLED to PENDING');
      expect(res.body.details).toEqual({ currentStatus: 'CANCELLED', requestedStatus: 'PENDING' });
    });

    it('409 for a same-status request', async () => {
      const created = await post(valid).expect(202);
      await request(app).patch(`/payments/${created.body.id}/status`).send({ status: 'PENDING' }).expect(409);
    });

    it('400 when asking for PROCESSING', async () => {
      const created = await post(valid).expect(202);
      const res = await request(app)
        .patch(`/payments/${created.body.id}/status`)
        .send({ status: 'PROCESSING' })
        .expect(400);
      expect(JSON.stringify(res.body.details)).toContain('reserved for the payment processor');
    });

    it('400 for an invalid status value', async () => {
      const created = await post(valid).expect(202);
      await request(app).patch(`/payments/${created.body.id}/status`).send({ status: 'DONE' }).expect(400);
    });

    it('404 for an unknown id', async () => {
      await request(app).patch(`/payments/${UNKNOWN_ID}/status`).send({ status: 'CANCELLED' }).expect(404);
    });

    it('PROCESSING -> SUCCEEDED', async () => {
      const id = await createProcessing();
      const res = await request(app).patch(`/payments/${id}/status`).send({ status: 'SUCCEEDED' }).expect(200);
      expect(res.body.status).toBe('SUCCEEDED');
    });

    it('PROCESSING -> FAILED records failureReason', async () => {
      const id = await createProcessing();
      const res = await request(app)
        .patch(`/payments/${id}/status`)
        .send({ status: 'FAILED', reason: 'card declined' })
        .expect(200);
      expect(res.body).toMatchObject({ status: 'FAILED', failureReason: 'card declined' });
    });

    it('PROCESSING -> PENDING sets nextAttemptAt', async () => {
      const id = await createProcessing();
      const res = await request(app).patch(`/payments/${id}/status`).send({ status: 'PENDING' }).expect(200);
      expect(res.body.status).toBe('PENDING');
      expect(res.body.nextAttemptAt).toEqual(expect.any(String));
    });
  });

  describe('repository compare-and-set (real SQLite)', () => {
    it('refuses a stale version and leaves the row untouched', async () => {
      const created = await post(valid).expect(202);
      const id = created.body.id as string;
      // Simulate the ABA sequence: PENDING -> PROCESSING -> PENDING bumps version to 3.
      await repo.updateIfStatus(id, { status: PaymentStatus.PENDING, version: 1 }, { status: PaymentStatus.PROCESSING });
      await repo.updateIfStatus(id, { status: PaymentStatus.PROCESSING, version: 2 }, { status: PaymentStatus.PENDING });

      const stale = await repo.updateIfStatus(
        id,
        { status: PaymentStatus.PENDING, version: 1 },
        { status: PaymentStatus.CANCELLED, history: [] },
      );
      expect(stale).toBe(false);
      const row = await repo.findById(id);
      expect(row).toMatchObject({ status: 'PENDING', version: 3 });
      expect(row?.history).toHaveLength(1);
    });

    it('applies a matching update and persists history JSON', async () => {
      const created = await post(valid).expect(202);
      const id = created.body.id as string;
      const history = [
        ...(created.body.history as Array<{ status: PaymentStatus; at: string; note?: string }>),
        { status: PaymentStatus.CANCELLED, at: new Date().toISOString(), note: 'x' },
      ];
      const ok = await repo.updateIfStatus(
        id,
        { status: PaymentStatus.PENDING, version: 1 },
        { status: PaymentStatus.CANCELLED, history },
      );
      expect(ok).toBe(true);
      const row = await repo.findById(id);
      expect(row?.history).toEqual(history);
      expect(row?.version).toBe(2);
      // Confirm the column holds JSON text, not "[object Object]".
      const raw = await dataSource.query<Array<{ history: string }>>('SELECT history FROM payments WHERE id = ?', [id]);
      expect(JSON.parse(raw[0].history)).toEqual(history);
    });

    it('returns false for an unknown id', async () => {
      await expect(
        repo.updateIfStatus(UNKNOWN_ID, { status: PaymentStatus.PENDING, version: 1 }, { status: PaymentStatus.CANCELLED }),
      ).resolves.toBe(false);
    });
  });

  it('returns timestamps as UTC ISO strings regardless of the process time zone', async () => {
    process.env.TZ = 'America/New_York';
    const created = await post(valid).expect(202);
    const res = await request(app).get(`/payments/${created.body.id}`).expect(200);
    expect(res.body.createdAt).toMatch(/Z$/);
    expect(Math.abs(new Date(res.body.createdAt).getTime() - Date.now())).toBeLessThan(5000);
    expect(Math.abs(new Date(res.body.updatedAt).getTime() - Date.now())).toBeLessThan(5000);
  });
});
