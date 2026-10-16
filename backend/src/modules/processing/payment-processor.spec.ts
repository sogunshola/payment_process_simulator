import pino from 'pino';
import { DataSource } from 'typeorm';
import { loadConfig } from '../../config/env';
import { createDataSource } from '../../database/data-source';
import { GatewayError, PaymentGateway } from '../gateway/gateway.types';
import { Payment } from '../payments/payment.entity';
import { PaymentStatus } from '../payments/payment-status';
import { PaymentsRepository } from '../payments/payments.repository';
import { backoffDelayMs, PaymentProcessor, ProcessorOptions } from './payment-processor';

const config = loadConfig({ API_KEY: 'test-api-key-0123456789', DB_PATH: ':memory:', NODE_ENV: 'test' });
const logger = pino({ level: 'silent' });
const options: ProcessorOptions = {
  pollIntervalMs: 1000,
  batchSize: 10,
  maxAttempts: 3,
  gatewayTimeoutMs: 5000,
  stopTimeoutMs: 10_000,
};

const approve = () => Promise.resolve({ status: 'approved' as const, transactionId: 'tx-1' });
const transient = () => Promise.reject(new GatewayError('transient', 'Gateway temporarily unavailable'));

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('PaymentProcessor', () => {
  let dataSource: DataSource;
  let repo: PaymentsRepository;

  beforeEach(async () => {
    dataSource = createDataSource(config);
    await dataSource.initialize();
    repo = new PaymentsRepository(dataSource);
  });

  afterEach(async () => {
    jest.useRealTimers();
    await dataSource.destroy();
  });

  const fakeGateway = (impl: PaymentGateway['charge'] = approve) => {
    const charge = jest.fn(impl);
    return { gateway: { charge } as PaymentGateway, charge };
  };

  const makeProcessor = (
    gateway: PaymentGateway,
    overrides: Partial<ProcessorOptions> = {},
    random: () => number = () => 0.5,
    repository: PaymentsRepository = repo,
  ) => new PaymentProcessor(repository, gateway, { ...options, ...overrides }, logger, random);

  const create = (reference = 'inv') =>
    repo.create({
      reference,
      amount: 5000,
      currency: 'NGN',
      description: null,
      customerEmail: null,
      status: PaymentStatus.PENDING,
      attempts: 0,
      history: [{ status: PaymentStatus.PENDING, at: new Date().toISOString(), note: 'Payment created' }],
    });

  const get = async (id: string): Promise<Payment> => {
    const p = await repo.findById(id);
    if (!p) throw new Error('missing payment');
    return p;
  };

  // Lets the event loop run until a condition holds (real timers only).
  async function until(cond: () => boolean): Promise<void> {
    for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setImmediate(r));
    expect(cond()).toBe(true);
  }

  // Makes a retrying payment due now, instead of waiting out the backoff.
  async function makeDue(id: string) {
    const p = await get(id);
    await repo.updateIfStatus(id, { status: PaymentStatus.PENDING, version: p.version }, {
      nextAttemptAt: new Date(Date.now() - 1000),
    });
  }

  it('moves a payment PENDING -> PROCESSING -> SUCCEEDED', async () => {
    const p = await create();
    const { gateway, charge } = fakeGateway();
    await makeProcessor(gateway).processDue();

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

  it('fails a declined payment without retrying', async () => {
    const p = await create();
    const { gateway, charge } = fakeGateway(() => Promise.reject(new GatewayError('declined', 'Card declined')));
    const processor = makeProcessor(gateway);
    await processor.processDue();

    const done = await get(p.id);
    expect(done.status).toBe(PaymentStatus.FAILED);
    expect(done.failureReason).toBe('Card declined');
    await processor.processDue();
    expect(charge).toHaveBeenCalledTimes(1);
  });

  it('schedules a retry after a transient failure and succeeds once due', async () => {
    const p = await create();
    let calls = 0;
    const { gateway, charge } = fakeGateway(() => (++calls === 1 ? transient() : approve()));
    const processor = makeProcessor(gateway, {}, () => 0.999);

    const before = Date.now();
    await processor.processDue();
    const retry = await get(p.id);
    expect(retry.status).toBe(PaymentStatus.PENDING);
    expect(retry.attempts).toBe(1);
    expect(retry.nextAttemptAt).not.toBeNull();
    const at = retry.nextAttemptAt!.getTime();
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now() + 2000);
    expect(retry.history[retry.history.length - 1].note).toContain('Attempt 1 failed');

    await processor.processDue(); // not due yet
    expect(charge).toHaveBeenCalledTimes(1);

    await makeDue(p.id);
    await processor.processDue();
    const done = await get(p.id);
    expect(done.status).toBe(PaymentStatus.SUCCEEDED);
    expect(charge).toHaveBeenCalledTimes(2);
  });

  it('fails with max_attempts_exceeded after the last allowed attempt', async () => {
    const p = await create();
    const { gateway, charge } = fakeGateway(transient);
    const processor = makeProcessor(gateway, { maxAttempts: 3 }, () => 0);

    for (let i = 0; i < 5; i++) {
      await processor.processDue();
      await makeDue(p.id).catch(() => undefined); // no-op once FAILED (CAS misses)
    }

    const done = await get(p.id);
    expect(done.status).toBe(PaymentStatus.FAILED);
    expect(done.failureReason).toBe('max_attempts_exceeded');
    expect(done.attempts).toBe(3);
    expect(charge).toHaveBeenCalledTimes(3);
  });

  it('treats an unexpected (non-gateway) error as transient', async () => {
    const p = await create();
    const { gateway } = fakeGateway(() => Promise.reject(new Error('socket hang up')));
    await makeProcessor(gateway).processDue();
    const after = await get(p.id);
    expect(after.status).toBe(PaymentStatus.PENDING);
    expect(after.attempts).toBe(1);
    expect(after.history[after.history.length - 1].note).toContain('socket hang up');
  });

  describe('backoffDelayMs', () => {
    it('is full jitter up to 1s * 2^attempts', () => {
      expect(backoffDelayMs(1, () => 0)).toBe(0);
      expect(backoffDelayMs(1, () => 0.999)).toBe(1998);
      expect(backoffDelayMs(3, () => 0.999)).toBe(7992);
    });

    it('caps at 30 seconds', () => {
      expect(backoffDelayMs(5, () => 0.999999)).toBeLessThan(30_000);
      expect(backoffDelayMs(5, () => 0.999999)).toBeGreaterThan(29_000);
      expect(backoffDelayMs(20, () => 0.999999)).toBeLessThan(30_000);
      expect(backoffDelayMs(20, () => 0.999999)).toBeGreaterThan(29_000);
    });
  });

  describe('gateway timeout', () => {
    // setImmediate/nextTick stay real so the database driver keeps working.
    const fake = () => jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });

    it('gives up on a call that ignores the abort signal and schedules a retry', async () => {
      fake();
      const p = await create();
      const { gateway } = fakeGateway(() => new Promise(() => undefined));
      const tick = makeProcessor(gateway, { gatewayTimeoutMs: 1000 }).processDue();
      await jest.advanceTimersByTimeAsync(1000);
      await tick;

      const after = await get(p.id);
      expect(after.status).toBe(PaymentStatus.PENDING);
      expect(after.attempts).toBe(1);
      expect(after.history[after.history.length - 1].note).toContain('timed out');
    });

    it('aborts the signal passed to a gateway that respects it', async () => {
      fake();
      await create();
      let seen: AbortSignal | undefined;
      const { gateway } = fakeGateway(
        (_id, _amount, _currency, signal) =>
          new Promise((_resolve, reject) => {
            seen = signal;
            signal.addEventListener('abort', () => reject(new GatewayError('transient', 'Gateway timed out')));
          }),
      );
      const tick = makeProcessor(gateway, { gatewayTimeoutMs: 1000 }).processDue();
      await jest.advanceTimersByTimeAsync(1000);
      await tick;
      expect(seen?.aborted).toBe(true);
    });
  });

  it('charges each payment once when two processors race over the same database', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await create(`inv-${i}`)).id);
    const { gateway, charge } = fakeGateway();
    const a = makeProcessor(gateway);
    const b = makeProcessor(gateway);

    await Promise.all([a.processDue(), b.processDue()]);

    expect(charge).toHaveBeenCalledTimes(5);
    expect(new Set(charge.mock.calls.map((c) => c[0])).size).toBe(5);
    for (const id of ids) expect((await get(id)).status).toBe(PaymentStatus.SUCCEEDED);
  });

  it('processes at most batchSize payments per tick', async () => {
    for (let i = 0; i < 3; i++) await create(`inv-${i}`);
    const { gateway, charge } = fakeGateway();
    await makeProcessor(gateway, { batchSize: 2 }).processDue();
    expect(charge).toHaveBeenCalledTimes(2);
  });

  describe('recoverStuck', () => {
    it('returns PROCESSING payments to PENDING without counting an attempt, then completes them', async () => {
      const p = await create();
      await repo.updateIfStatus(p.id, { status: PaymentStatus.PENDING, version: p.version }, {
        status: PaymentStatus.PROCESSING,
      });
      const { gateway } = fakeGateway();
      const processor = makeProcessor(gateway);

      expect(await processor.recoverStuck()).toBe(1);
      const recovered = await get(p.id);
      expect(recovered.status).toBe(PaymentStatus.PENDING);
      expect(recovered.attempts).toBe(0);
      expect(recovered.history[recovered.history.length - 1].note).toBe('Recovered after restart');

      await processor.processDue();
      expect((await get(p.id)).status).toBe(PaymentStatus.SUCCEEDED);
    });

    it('returns 0 when nothing is stuck', async () => {
      await create();
      expect(await makeProcessor(fakeGateway().gateway).recoverStuck()).toBe(0);
    });
  });

  describe('stop', () => {
    it('waits for in-flight work before resolving', async () => {
      const p = await create();
      const gate = deferred();
      const { gateway, charge } = fakeGateway(async () => {
        await gate.promise;
        return { status: 'approved' as const, transactionId: 'tx-1' };
      });
      const processor = makeProcessor(gateway);

      const tick = processor.processDue();
      await until(() => charge.mock.calls.length === 1);
      let stopped = false;
      const stopping = processor.stop().then(() => {
        stopped = true;
      });
      for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
      expect(stopped).toBe(false);

      gate.resolve();
      await stopping;
      await tick;
      expect((await get(p.id)).status).toBe(PaymentStatus.SUCCEEDED);
    });

    it('gives up after stopTimeoutMs and leaves the payment PROCESSING', async () => {
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
      const p = await create();
      const { gateway, charge } = fakeGateway(() => new Promise(() => undefined));
      const processor = makeProcessor(gateway, { stopTimeoutMs: 50, gatewayTimeoutMs: 60_000 });

      void processor.processDue();
      for (let i = 0; i < 200 && charge.mock.calls.length === 0; i++) await jest.advanceTimersByTimeAsync(0);
      expect(charge).toHaveBeenCalledTimes(1);

      const stopping = processor.stop();
      await jest.advanceTimersByTimeAsync(50);
      await stopping;
      expect((await get(p.id)).status).toBe(PaymentStatus.PROCESSING);
    });

    it('is idempotent and prevents later ticks', async () => {
      await create();
      const { gateway, charge } = fakeGateway();
      const processor = makeProcessor(gateway);
      await processor.stop();
      await processor.stop();
      await processor.processDue();
      expect(charge).not.toHaveBeenCalled();
    });
  });

  it('logs a repository failure mid-payment without rejecting, and finishes the other payments', async () => {
    const a = await create('a');
    const b = await create('b');
    const failing = new PaymentsRepository(dataSource);
    const original = failing.updateIfStatus.bind(failing);
    jest.spyOn(failing, 'updateIfStatus').mockImplementation((id, expected, changes) =>
      id === a.id && changes.status === PaymentStatus.SUCCEEDED
        ? Promise.reject(new Error('disk I/O error'))
        : original(id, expected, changes),
    );
    const { gateway } = fakeGateway();
    const errorLog = jest.spyOn(logger, 'error');

    await expect(makeProcessor(gateway, {}, () => 0.5, failing).processDue()).resolves.toBeUndefined();

    expect(errorLog).toHaveBeenCalledWith(expect.objectContaining({ paymentId: a.id }), 'Failed to process payment');
    expect((await get(b.id)).status).toBe(PaymentStatus.SUCCEEDED);
    expect((await get(a.id)).status).toBe(PaymentStatus.PROCESSING); // left for recoverStuck
    errorLog.mockRestore();
  });

  it('does not reject when loading due payments fails', async () => {
    const broken = new PaymentsRepository(dataSource);
    jest.spyOn(broken, 'findDue').mockRejectedValue(new Error('db down'));
    const { gateway } = fakeGateway();
    await expect(makeProcessor(gateway, {}, () => 0.5, broken).processDue()).resolves.toBeUndefined();
  });

  it('discards its result when the payment was changed by someone else mid-flight', async () => {
    const p = await create();
    const gate = deferred();
    const { gateway, charge } = fakeGateway(async () => {
      await gate.promise;
      return { status: 'approved' as const, transactionId: 'tx-1' };
    });
    const warn = jest.spyOn(logger, 'warn');
    const tick = makeProcessor(gateway).processDue();
    await until(() => charge.mock.calls.length === 1);

    // What PATCH /payments/:id/status does to a PROCESSING payment.
    const processing = await get(p.id);
    expect(
      await repo.updateIfStatus(p.id, { status: PaymentStatus.PROCESSING, version: processing.version }, {
        status: PaymentStatus.FAILED,
        failureReason: 'manual',
      }),
    ).toBe(true);

    gate.resolve();
    await expect(tick).resolves.toBeUndefined();
    const after = await get(p.id);
    expect(after.status).toBe(PaymentStatus.FAILED);
    expect(after.failureReason).toBe('manual');
    expect(warn).toHaveBeenCalledWith(
      { paymentId: p.id, outcome: 'approved' },
      'Payment changed while processing; result discarded',
    );
    warn.mockRestore();
  });

  describe('start loop', () => {
    it('ticks every poll interval, never overlaps, and stops scheduling after stop()', async () => {
      jest.useFakeTimers();
      const processor = makeProcessor(fakeGateway().gateway, { pollIntervalMs: 1000 });
      const slow = deferred();
      const spy = jest.spyOn(processor, 'processDue').mockImplementation(() => slow.promise);

      processor.start();
      processor.start(); // idempotent
      await jest.advanceTimersByTimeAsync(999);
      expect(spy).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      expect(spy).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(10_000); // the slow tick is still running
      expect(spy).toHaveBeenCalledTimes(1);

      slow.resolve();
      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(1000);
      expect(spy).toHaveBeenCalledTimes(2);

      await processor.stop();
      await jest.advanceTimersByTimeAsync(10_000);
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });
});
