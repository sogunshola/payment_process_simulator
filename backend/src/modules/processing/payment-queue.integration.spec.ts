import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import pino from 'pino';
import { DataSource } from 'typeorm';
import { loadConfig } from '../../config/env';
import { createDataSource } from '../../database/data-source';
import { GatewayError, PaymentGateway } from '../gateway/gateway.types';
import { PaymentStatus } from '../payments/payment-status';
import { PaymentsRepository } from '../payments/payments.repository';
import { BullPaymentQueue, PaymentJobData, QUEUE_NAME } from './bull-payment-queue';
import { PaymentProcessor, retryDelayMs } from './payment-processor';

// Needs a real Redis: run with REDIS_INTEGRATION=1 (REDIS_URL optional). Skipped otherwise.
const enabled = process.env.REDIS_INTEGRATION === '1';
const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
const config = loadConfig({ API_KEY: 'test-api-key-0123456789', DB_PATH: ':memory:', NODE_ENV: 'test' });
const logger = pino({ level: 'silent' });

(enabled ? describe : describe.skip)('payment queue with real Redis', () => {
  let dataSource: DataSource;
  let repo: PaymentsRepository;
  let queueConnection: IORedis;
  let workerConnection: IORedis;
  let queue: BullPaymentQueue;
  let worker: Worker<PaymentJobData>;

  const startWorker = (gateway: PaymentGateway) => {
    // random=0 makes every retry delay 0 so the test does not wait on backoff.
    const processor = new PaymentProcessor(repo, gateway, { gatewayTimeoutMs: 5000 }, logger, () => 0);
    worker = new Worker<PaymentJobData>(QUEUE_NAME, (job) => processor.handle(job), {
      connection: workerConnection,
      concurrency: 2,
      settings: { backoffStrategy: retryDelayMs },
    });
  };

  const create = () =>
    repo.create({
      reference: `int-${Date.now()}-${Math.random()}`,
      amount: 5000,
      currency: 'NGN',
      description: null,
      customerEmail: null,
      status: PaymentStatus.PENDING,
      attempts: 0,
      history: [],
    });

  async function until(cond: () => Promise<boolean>): Promise<void> {
    for (let i = 0; i < 100; i++) {
      if (await cond()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(await cond()).toBe(true);
  }

  beforeEach(async () => {
    dataSource = createDataSource(config);
    await dataSource.initialize();
    repo = new PaymentsRepository(dataSource);
    queueConnection = new IORedis(url, { maxRetriesPerRequest: null });
    workerConnection = new IORedis(url, { maxRetriesPerRequest: null });
    queue = new BullPaymentQueue(queueConnection, 3);
  });

  afterEach(async () => {
    await worker?.close();
    await queue.close();
    queueConnection.disconnect();
    workerConnection.disconnect();
    await dataSource.destroy();
  });

  it('enqueue -> worker -> SUCCEEDED, and the same id can be queued again afterwards', async () => {
    const charge = jest.fn(() => Promise.resolve({ status: 'approved' as const, transactionId: 'tx-1' }));
    startWorker({ charge });
    const p = await create();

    await queue.enqueue(p.id);
    await queue.enqueue(p.id); // deduplicated by jobId

    await until(async () => (await repo.findById(p.id))?.status === PaymentStatus.SUCCEEDED);
    expect(charge).toHaveBeenCalledTimes(1);
  });

  it('retries a transient failure through BullMQ and then succeeds', async () => {
    const charge = jest
      .fn()
      .mockRejectedValueOnce(new GatewayError('transient', 'down'))
      .mockResolvedValue({ status: 'approved', transactionId: 'tx-2' });
    startWorker({ charge });
    const p = await create();

    await queue.enqueue(p.id);

    await until(async () => (await repo.findById(p.id))?.status === PaymentStatus.SUCCEEDED);
    expect(charge).toHaveBeenCalledTimes(2);
    expect((await repo.findById(p.id))?.attempts).toBe(1);
  });

  it('fails with max_attempts_exceeded after the configured attempts', async () => {
    const charge = jest.fn().mockRejectedValue(new GatewayError('transient', 'down'));
    startWorker({ charge });
    const p = await create();

    await queue.enqueue(p.id);

    await until(async () => (await repo.findById(p.id))?.status === PaymentStatus.FAILED);
    expect(charge).toHaveBeenCalledTimes(3);
    expect((await repo.findById(p.id))?.failureReason).toBe('max_attempts_exceeded');
  });
});
