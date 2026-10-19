import pino from 'pino';
import { DataSource } from 'typeorm';
import { loadConfig } from '../../config/env';
import { createDataSource } from '../../database/data-source';
import { GatewayError, PaymentGateway } from '../gateway/gateway.types';
import { Payment } from '../payments/payment.entity';
import { PaymentStatus } from '../payments/payment-status';
import { PaymentsRepository } from '../payments/payments.repository';
import {
  backoffDelayMs,
  PaymentJob,
  PaymentProcessor,
  RetryableError,
  retryDelayMs,
} from './payment-processor';
import { reconcileQueue } from './processing.module';

const config = loadConfig({ API_KEY: 'test-api-key-0123456789', DB_PATH: ':memory:', NODE_ENV: 'test' });
const logger = pino({ level: 'silent' });

const approve = () => Promise.resolve({ status: 'approved' as const, transactionId: 'tx-1' });
const transient = () => Promise.reject(new GatewayError('transient', 'Gateway temporarily unavailable'));

// The handler only reads these fields, so a plain object stands in for a BullMQ job.
const job = (paymentId: string, attemptsMade = 0, attempts = 3): PaymentJob => ({
  data: { paymentId },
  attemptsMade,
  opts: { attempts },
});

describe('PaymentProcessor.handle', () => {
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

  const fakeGateway = (impl: PaymentGateway['charge'] = approve) => {
    const charge = jest.fn(impl);
    return { gateway: { charge } as PaymentGateway, charge };
  };

  const makeProcessor = (
    gateway: PaymentGateway,
    gatewayTimeoutMs = 5000,
    random: () => number = () => 0.5,
    repository: PaymentsRepository = repo,
  ) => new PaymentProcessor(repository, gateway, { gatewayTimeoutMs }, logger, random);

  let seq = 0;
  const create = (status = PaymentStatus.PENDING) =>
    repo.create({
      reference: `inv-${++seq}`,
      amount: 5000,
      currency: 'NGN',
      description: null,
      customerEmail: null,
      status,
      attempts: 0,
      history: [{ status: PaymentStatus.PENDING, at: new Date().toISOString(), note: 'Payment created' }],
    });

  const get = async (id: string): Promise<Payment> => {
    const p = await repo.findById(id);
    if (!p) throw new Error('missing payment');
    return p;
  };

  // What the API does with PATCH, done through the repository.
  const patch = async (id: string, from: PaymentStatus, to: PaymentStatus) => {
    const p = await get(id);
    expect(p.status).toBe(from);
    await repo.updateIfStatus(id, { status: from, version: p.version }, { status: to });
  };

  it('moves a payment PENDING -> PROCESSING -> SUCCEEDED', async () => {
    const p = await create();
    const { gateway, charge } = fakeGateway();
    await makeProcessor(gateway).handle(job(p.id));

    const done = await get(p.id);
    expect(done.status).toBe(PaymentStatus.SUCCEEDED);
    expect(done.attempts).toBe(0); // only failed attempts are counted
    expect(done.history.map((h) => h.status)).toEqual([
      PaymentStatus.PENDING,
      PaymentStatus.PROCESSING,
      PaymentStatus.SUCCEEDED,
    ]);
    expect(done.history[1].note).toBe('Attempt 1 started');
    expect(done.history[2].note).toContain('tx-1');
    expect(charge).toHaveBeenCalledWith(p.id, 5000, 'NGN', expect.any(AbortSignal));
  });

  it('fails a declined payment as final: the job completes and nothing is retried', async () => {
    const p = await create();
    const { gateway, charge } = fakeGateway(() => Promise.reject(new GatewayError('declined', 'Card declined')));
    await expect(makeProcessor(gateway).handle(job(p.id))).resolves.toBeUndefined();

    const done = await get(p.id);
    expect(done.status).toBe(PaymentStatus.FAILED);
    expect(done.failureReason).toBe('Card declined');
    expect(charge).toHaveBeenCalledTimes(1);
  });

  it('writes PENDING with the backoff delay, then throws RetryableError carrying the same delay', async () => {
    const p = await create();
    const { gateway } = fakeGateway(transient);
    const before = Date.now();

    const err = await makeProcessor(gateway).handle(job(p.id)).then(
      () => undefined,
      (e: unknown) => e,
    );

    // attempts=1, random=0.5: floor(0.5 * min(30000, 1000 * 2^1)) = 1000
    expect(err).toBeInstanceOf(RetryableError);
    expect((err as RetryableError).delayMs).toBe(1000);
    const after = await get(p.id);
    expect(after.status).toBe(PaymentStatus.PENDING);
    expect(after.attempts).toBe(1);
    expect(after.nextAttemptAt?.getTime()).toBeGreaterThanOrEqual(before + 1000);
    expect(after.nextAttemptAt?.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect(after.history[after.history.length - 1].note).toContain('retrying in 1000ms');
  });

  it('succeeds on the second attempt after a transient failure', async () => {
    const p = await create();
    const { gateway, charge } = fakeGateway();
    charge.mockImplementationOnce(transient);
    const processor = makeProcessor(gateway);

    await expect(processor.handle(job(p.id, 0))).rejects.toBeInstanceOf(RetryableError);
    await processor.handle(job(p.id, 1));

    const done = await get(p.id);
    expect(done.status).toBe(PaymentStatus.SUCCEEDED);
    expect(done.attempts).toBe(1);
    expect(done.history.filter((h) => h.note?.startsWith('Attempt')).map((h) => h.note)).toEqual([
      'Attempt 1 started',
      expect.stringContaining('Attempt 1 failed'),
      'Attempt 2 started',
    ]);
  });

  it('fails with max_attempts_exceeded on the last attempt and lets the job complete', async () => {
    const p = await create();
    const { gateway } = fakeGateway(transient);
    // attemptsMade 2 of 3: this is the third and last attempt.
    await expect(makeProcessor(gateway).handle(job(p.id, 2, 3))).resolves.toBeUndefined();

    const done = await get(p.id);
    expect(done.status).toBe(PaymentStatus.FAILED);
    expect(done.failureReason).toBe('max_attempts_exceeded');
    expect(done.attempts).toBe(1);
    expect(done.history[done.history.length - 1].note).toContain('giving up');
  });

  it('treats a single-attempt job as the last attempt', async () => {
    const p = await create();
    const { gateway } = fakeGateway(transient);
    await makeProcessor(gateway).handle(job(p.id, 0, 1));
    expect((await get(p.id)).failureReason).toBe('max_attempts_exceeded');
  });

  it('treats an unexpected (non-gateway) error as transient', async () => {
    const p = await create();
    const { gateway } = fakeGateway(() => Promise.reject(new TypeError('boom')));
    await expect(makeProcessor(gateway).handle(job(p.id))).rejects.toBeInstanceOf(RetryableError);
    const after = await get(p.id);
    expect(after.status).toBe(PaymentStatus.PENDING);
    expect(after.history[after.history.length - 1].note).toContain('boom');
  });

  describe('gateway timeout', () => {
    afterEach(() => jest.useRealTimers());

    it('gives up on a call that ignores the abort signal and schedules a retry', async () => {
      jest.useFakeTimers();
      const p = await create();
      const { gateway } = fakeGateway(() => new Promise(() => undefined)); // never settles
      const result = makeProcessor(gateway, 1000).handle(job(p.id)).catch((e: unknown) => e);
      await jest.advanceTimersByTimeAsync(1000);

      expect(await result).toBeInstanceOf(RetryableError);
      const after = await get(p.id);
      expect(after.status).toBe(PaymentStatus.PENDING);
      expect(after.attempts).toBe(1);
      expect(after.history[after.history.length - 1].note).toContain('timed out');
    });

    it('aborts the signal passed to a gateway that respects it', async () => {
      jest.useFakeTimers();
      const p = await create();
      let seen: AbortSignal | undefined;
      const { gateway } = fakeGateway(
        (_id, _amount, _currency, signal) =>
          new Promise((_resolve, reject) => {
            seen = signal;
            signal.addEventListener('abort', () => reject(new GatewayError('transient', 'Gateway timed out')));
          }),
      );
      const result = makeProcessor(gateway, 1000).handle(job(p.id)).catch((e: unknown) => e);
      await jest.advanceTimersByTimeAsync(1000);
      await result;
      expect(seen?.aborted).toBe(true);
    });
  });

  describe('claiming', () => {
    it('re-runs a payment left PROCESSING by a crashed worker, without counting an attempt', async () => {
      const p = await create();
      await patch(p.id, PaymentStatus.PENDING, PaymentStatus.PROCESSING);
      const { gateway, charge } = fakeGateway();

      await makeProcessor(gateway).handle(job(p.id));

      const done = await get(p.id);
      expect(done.status).toBe(PaymentStatus.SUCCEEDED);
      expect(done.attempts).toBe(0);
      expect(charge).toHaveBeenCalledTimes(1);
    });

    it('skips the payment when the claim is lost to another writer', async () => {
      const p = await create();
      const { gateway, charge } = fakeGateway();
      const spy = jest.spyOn(repo, 'updateIfStatus').mockResolvedValueOnce(false);

      await expect(makeProcessor(gateway).handle(job(p.id))).resolves.toBeUndefined();

      expect(spy).toHaveBeenCalledTimes(1);
      expect(charge).not.toHaveBeenCalled();
      expect((await get(p.id)).status).toBe(PaymentStatus.PENDING);
    });

    it('charges once when two handlers race for the same payment', async () => {
      const p = await create();
      const { gateway, charge } = fakeGateway();
      await Promise.all([makeProcessor(gateway).handle(job(p.id)), makeProcessor(gateway).handle(job(p.id))]);
      expect(charge).toHaveBeenCalledTimes(1);
      expect((await get(p.id)).status).toBe(PaymentStatus.SUCCEEDED);
    });

    it('does nothing for a missing payment', async () => {
      const { gateway, charge } = fakeGateway();
      await expect(
        makeProcessor(gateway).handle(job('00000000-0000-4000-8000-000000000000')),
      ).resolves.toBeUndefined();
      expect(charge).not.toHaveBeenCalled();
    });

    it.each([PaymentStatus.CANCELLED, PaymentStatus.SUCCEEDED, PaymentStatus.FAILED])(
      'does nothing for a %s payment',
      async (status) => {
        const p = await create();
        await patch(p.id, PaymentStatus.PENDING, status);
        const { gateway, charge } = fakeGateway();
        await makeProcessor(gateway).handle(job(p.id));
        expect(charge).not.toHaveBeenCalled();
        expect((await get(p.id)).status).toBe(status);
      },
    );
  });

  describe('payment changed while the gateway call was in flight', () => {
    it('discards its result when the payment was changed by someone else', async () => {
      const p = await create();
      const { gateway } = fakeGateway(async () => {
        // The API marks the payment FAILED while the charge is running.
        await patch(p.id, PaymentStatus.PROCESSING, PaymentStatus.FAILED);
        return approve();
      });

      await expect(makeProcessor(gateway).handle(job(p.id))).resolves.toBeUndefined();

      const after = await get(p.id);
      expect(after.status).toBe(PaymentStatus.FAILED); // the API change wins
      expect(after.history.map((h) => h.status)).not.toContain(PaymentStatus.SUCCEEDED);
    });

    it('runs the job again at once when the API set the payment back to PENDING', async () => {
      const p = await create();
      // The API's enqueue was deduplicated against this running job, so only a retry can pick it up.
      const { gateway } = fakeGateway(async () => {
        await patch(p.id, PaymentStatus.PROCESSING, PaymentStatus.PENDING);
        return approve();
      });

      const err = await makeProcessor(gateway).handle(job(p.id)).then(
        () => undefined,
        (e: unknown) => e,
      );

      expect(err).toBeInstanceOf(RetryableError);
      expect((err as RetryableError).delayMs).toBe(0);
      expect((await get(p.id)).status).toBe(PaymentStatus.PENDING);
    });

    it('leaves the PENDING row for the next reconcile when that happens on the last attempt', async () => {
      const p = await create();
      const { gateway } = fakeGateway(async () => {
        await patch(p.id, PaymentStatus.PROCESSING, PaymentStatus.PENDING);
        return approve();
      });
      await expect(makeProcessor(gateway).handle(job(p.id, 2, 3))).resolves.toBeUndefined();
      expect((await get(p.id)).status).toBe(PaymentStatus.PENDING);
    });
  });

  describe('database errors', () => {
    it('propagates an error loading the payment so BullMQ retries the job', async () => {
      const { gateway, charge } = fakeGateway();
      jest.spyOn(repo, 'findById').mockRejectedValue(new Error('db down'));
      await expect(makeProcessor(gateway).handle(job('x'))).rejects.toThrow('db down');
      expect(charge).not.toHaveBeenCalled();
    });

    it('propagates an error writing the outcome without recording a gateway failure', async () => {
      const p = await create();
      const { gateway, charge } = fakeGateway();
      const original = repo.updateIfStatus.bind(repo);
      jest.spyOn(repo, 'updateIfStatus').mockImplementation((id, expected, changes) =>
        changes.status === PaymentStatus.SUCCEEDED
          ? Promise.reject(new Error('disk I/O error'))
          : original(id, expected, changes),
      );

      const err = await makeProcessor(gateway).handle(job(p.id)).then(
        () => undefined,
        (e: unknown) => e,
      );

      expect(err).toEqual(new Error('disk I/O error'));
      expect(err).not.toBeInstanceOf(RetryableError);
      expect(charge).toHaveBeenCalledTimes(1); // the gateway was not asked to retry by this handler
      const after = await get(p.id);
      expect(after.attempts).toBe(0); // not counted as a gateway attempt
      expect(after.status).toBe(PaymentStatus.PROCESSING); // the re-run reclaims it
    });
  });

  describe('backoffDelayMs', () => {
    it('is full jitter up to 1s * 2^attempts', () => {
      expect(backoffDelayMs(1, () => 0)).toBe(0);
      expect(backoffDelayMs(1, () => 0.5)).toBe(1000);
      expect(backoffDelayMs(3, () => 0.999999)).toBeLessThan(8000);
    });

    it('caps at 30 seconds', () => {
      expect(backoffDelayMs(20, () => 0.999999)).toBeLessThan(30_000);
      expect(backoffDelayMs(20, () => 0.5)).toBe(15_000);
    });
  });

  describe('retryDelayMs (BullMQ backoffStrategy)', () => {
    it('returns the delay the handler chose, so the queue matches nextAttemptAt', () => {
      expect(retryDelayMs(1, 'custom', new RetryableError('x', 1234))).toBe(1234);
      expect(retryDelayMs(1, 'custom', new RetryableError('x', 0))).toBe(0);
    });

    it('falls back to jittered backoff for other errors, e.g. a database error', () => {
      const delay = retryDelayMs(2, 'custom', new Error('db down'));
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThan(4000);
    });
  });

  describe('reconcileQueue (boot reconcile)', () => {
    it('enqueues every PENDING and PROCESSING payment and nothing else', async () => {
      const pending = await create();
      const processing = await create();
      await patch(processing.id, PaymentStatus.PENDING, PaymentStatus.PROCESSING);
      const cancelled = await create();
      await patch(cancelled.id, PaymentStatus.PENDING, PaymentStatus.CANCELLED);
      const queue = { enqueue: jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined) };

      expect(await reconcileQueue(repo, queue, logger)).toBe(2);

      expect(queue.enqueue.mock.calls.map((c) => c[0]).sort()).toEqual([pending.id, processing.id].sort());
    });

    it('rejects when the queue is down, so server.ts can fail the boot', async () => {
      await create();
      const queue = { enqueue: jest.fn().mockRejectedValue(new Error('redis down')) };
      await expect(reconcileQueue(repo, queue, logger)).rejects.toThrow('redis down');
    });
  });
});
