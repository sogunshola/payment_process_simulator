import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { DataSource } from 'typeorm';
import { Logger } from '../../common/logger';
import { AppConfig } from '../../config/env';
import { PaymentGateway } from '../gateway/gateway.types';
import { PaymentQueue } from '../payments/payment-queue';
import { PaymentStatus } from '../payments/payment-status';
import { PaymentsRepository } from '../payments/payments.repository';
import { BullPaymentQueue, PaymentJobData, QUEUE_NAME } from './bull-payment-queue';
import { PaymentProcessor, retryDelayMs } from './payment-processor';

/** Fails fast (no reconnect loop, bounded wait) so a missing Redis stops the boot with a clear error. */
export async function assertRedisReachable(url: string, timeoutMs = 5000): Promise<void> {
  const probe = new IORedis(url, { lazyConnect: true, connectTimeout: timeoutMs, retryStrategy: () => null });
  probe.on('error', () => undefined); // the rejection below carries the error
  try {
    await probe.connect();
    await probe.ping();
  } finally {
    probe.disconnect();
  }
}

/**
 * Re-enqueues every unfinished payment (PENDING, and PROCESSING rows whose worker died with
 * no job left to resume them). The queue deduplicates by jobId, so a job that still exists,
 * including one another instance is running, is left alone and this is safe on every boot.
 * It covers payments whose enqueue failed (Redis was down) and a Redis that lost its data;
 * the database row is the source of truth.
 */
export async function reconcileQueue(repository: PaymentsRepository, queue: PaymentQueue, logger: Logger): Promise<number> {
  const unfinished = [
    ...(await repository.findByStatus(PaymentStatus.PENDING)),
    ...(await repository.findByStatus(PaymentStatus.PROCESSING)),
  ];
  for (const payment of unfinished) await queue.enqueue(payment.id);
  logger.info({ count: unfinished.length }, 'Reconciled unfinished payments into the queue');
  return unfinished.length;
}

/** Resolves 'timeout' if the promise has not settled in time; with Redis down, close calls can hang. */
async function within<T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms);
  });
  try {
    return await Promise.race([promise, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/** Closes the worker, waiting for active jobs; after timeoutMs it force-closes (the job is re-run as stalled). */
export async function closeWorker(worker: Worker<PaymentJobData>, timeoutMs: number, logger: Logger): Promise<void> {
  if ((await within(worker.close(), timeoutMs)) === 'timeout') {
    logger.warn({ timeoutMs }, 'Worker still busy; forcing close, interrupted payments are re-run by BullMQ');
    await within(worker.close(true), 3000);
  }
}

export function createProcessingModule(
  dataSource: DataSource,
  gateway: PaymentGateway,
  config: AppConfig,
  logger: Logger,
) {
  const repository = new PaymentsRepository(dataSource);
  const processor = new PaymentProcessor(repository, gateway, config.processor, logger);

  // Producer connection: with the offline queue off, a Redis outage fails an enqueue
  // immediately instead of making the HTTP request wait for the reconnect.
  const queueConnection = new IORedis(config.redisUrl, { enableOfflineQueue: false, maxRetriesPerRequest: 1 });
  // Worker connection: BullMQ requires maxRetriesPerRequest null for its blocking commands.
  const workerConnection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
  for (const connection of [queueConnection, workerConnection]) {
    connection.on('error', (err) => logger.error({ err }, 'Redis connection error'));
  }

  const queue = new BullPaymentQueue(queueConnection, config.processor.maxAttempts);

  // autorun off: server.ts starts it once the HTTP server is listening.
  const worker = new Worker<PaymentJobData>(QUEUE_NAME, (job) => processor.handle(job), {
    connection: workerConnection,
    concurrency: config.processor.concurrency,
    autorun: false,
    settings: { backoffStrategy: retryDelayMs },
  });
  worker.on('error', (err) => logger.error({ err }, 'Payment worker error'));
  worker.on('failed', (job, err) => {
    // RetryableError is the normal retry path, not a fault.
    if (err.name === 'RetryableError') logger.debug({ paymentId: job?.data.paymentId }, 'Payment will be retried');
    else logger.error({ err, paymentId: job?.data.paymentId }, 'Payment job failed');
  });

  return {
    repository,
    queue,
    worker,
    pingRedis: async (): Promise<void> => {
      await queueConnection.ping();
    },
    async close(): Promise<void> {
      await within(queue.close(), 3000);
      queueConnection.disconnect();
      workerConnection.disconnect();
    },
  };
}
