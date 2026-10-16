import { DataSource } from 'typeorm';
import { loadConfig } from '../../config/env';
import { createDataSource } from '../../database/data-source';
import { PaymentStatus } from './payment-status';
import { PaymentsRepository } from './payments.repository';

const config = loadConfig({ API_KEY: 'test-api-key-0123456789', DB_PATH: ':memory:', NODE_ENV: 'test' });

describe('PaymentsRepository (real SQLite)', () => {
  let dataSource: DataSource;
  let repo: PaymentsRepository;

  beforeEach(async () => {
    dataSource = createDataSource(config);
    await dataSource.initialize();
    repo = new PaymentsRepository(dataSource);
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  const make = (reference: string) =>
    repo.create({
      reference,
      amount: 100,
      currency: 'NGN',
      description: null,
      customerEmail: null,
      status: PaymentStatus.PENDING,
      attempts: 0,
      history: [],
    });

  const schedule = (id: string, version: number, nextAttemptAt: Date | null) =>
    repo.updateIfStatus(id, { status: PaymentStatus.PENDING, version }, { nextAttemptAt });

  describe('findDue', () => {
    it('returns unscheduled and past-due payments, not future ones', async () => {
      const now = new Date();
      const fresh = await make('fresh');
      const past = await make('past');
      const future = await make('future');
      await schedule(past.id, past.version, new Date(now.getTime() - 60_000));
      await schedule(future.id, future.version, new Date(now.getTime() + 60_000));

      const due = await repo.findDue(now, 10);
      expect(due.map((p) => p.reference).sort()).toEqual(['fresh', 'past']);
      expect(due.find((p) => p.id === fresh.id)?.nextAttemptAt).toBeNull();
    });

    it('treats nextAttemptAt exactly equal to now as due, and 1ms later as not due', async () => {
      const now = new Date();
      const p = await make('edge');
      await schedule(p.id, p.version, now);
      expect(await repo.findDue(now, 10)).toHaveLength(1);
      expect(await repo.findDue(new Date(now.getTime() - 1), 10)).toHaveLength(0);
    });

    it('ignores payments that are not PENDING', async () => {
      const p = await make('busy');
      await repo.updateIfStatus(p.id, { status: PaymentStatus.PENDING, version: p.version }, {
        status: PaymentStatus.PROCESSING,
      });
      expect(await repo.findDue(new Date(), 10)).toHaveLength(0);
    });

    it('puts never-scheduled payments first, then orders by due time, and honours the limit', async () => {
      const now = new Date();
      const retryOld = await make('retry-old');
      const retryNew = await make('retry-new');
      const fresh = await make('fresh');
      await schedule(retryNew.id, retryNew.version, new Date(now.getTime() - 1_000));
      await schedule(retryOld.id, retryOld.version, new Date(now.getTime() - 5_000));

      const all = await repo.findDue(now, 10);
      expect(all.map((p) => p.id)).toEqual([fresh.id, retryOld.id, retryNew.id]);
      expect(await repo.findDue(now, 2)).toHaveLength(2);
    });
  });

  it('findByStatus returns only payments in that status', async () => {
    const a = await make('a');
    await make('b');
    await repo.updateIfStatus(a.id, { status: PaymentStatus.PENDING, version: a.version }, {
      status: PaymentStatus.PROCESSING,
    });
    const processing = await repo.findByStatus(PaymentStatus.PROCESSING);
    expect(processing.map((p) => p.id)).toEqual([a.id]);
  });
});
