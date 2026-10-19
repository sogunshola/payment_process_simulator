import { DataSource } from 'typeorm';
import { loadConfig } from '../../config/env';
import { createDataSource } from '../../database/data-source';
import { PaymentStatus } from './payment-status';
import { DuplicateIdempotencyKeyError, DuplicateReferenceError, PaymentsRepository } from './payments.repository';

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

  describe('create unique violations', () => {
    it('maps a duplicate reference to DuplicateReferenceError', async () => {
      await make('same');
      await expect(make('same')).rejects.toBeInstanceOf(DuplicateReferenceError);
    });

    it('maps a duplicate idempotency key to DuplicateIdempotencyKeyError', async () => {
      const withKey = (reference: string) =>
        repo.create({
          reference,
          amount: 100,
          currency: 'NGN',
          description: null,
          customerEmail: null,
          status: PaymentStatus.PENDING,
          attempts: 0,
          history: [],
          idempotencyKey: 'key-1',
        });
      await withKey('b1');
      await expect(withKey('b2')).rejects.toBeInstanceOf(DuplicateIdempotencyKeyError);
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
