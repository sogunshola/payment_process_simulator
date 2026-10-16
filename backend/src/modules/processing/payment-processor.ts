import { Logger } from '../../common/logger';
import { GatewayError, PaymentGateway } from '../gateway/gateway.types';
import { Payment, PaymentHistoryEntry } from '../payments/payment.entity';
import { PaymentStatus } from '../payments/payment-status';
import { PaymentChanges, PaymentsRepository } from '../payments/payments.repository';

export interface ProcessorOptions {
  pollIntervalMs: number;
  batchSize: number;
  maxAttempts: number;
  gatewayTimeoutMs: number;
  /** How long stop() waits for in-flight payments before giving up. */
  stopTimeoutMs?: number;
}

const MAX_BACKOFF_MS = 30_000;
const DEFAULT_STOP_TIMEOUT_MS = 10_000;

/**
 * Exponential backoff with full jitter: a random delay in [0, min(30s, 1s * 2^attempts)).
 * Spreading retries randomly means a gateway that is recovering is not hit by every
 * failed payment at the same instant.
 */
export function backoffDelayMs(attempts: number, random: () => number): number {
  return Math.floor(random() * Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempts));
}

export class PaymentProcessor {
  private readonly stopTimeoutMs: number;
  private started = false;
  private stopped = false;
  private timer: NodeJS.Timeout | null = null;
  // Every tick in progress, so stop() can wait for them.
  private readonly active = new Set<Promise<void>>();

  constructor(
    private readonly repository: PaymentsRepository,
    private readonly gateway: PaymentGateway,
    private readonly options: ProcessorOptions,
    private readonly logger: Logger,
    private readonly random: () => number = Math.random,
  ) {
    this.stopTimeoutMs = options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
  }

  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    this.schedule();
    this.logger.info({ pollIntervalMs: this.options.pollIntervalMs }, 'Payment processor started');
  }

  // Self-scheduling setTimeout instead of setInterval: the next tick is only scheduled
  // after the current one finishes, so ticks can never overlap even when a tick is slow.
  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.processDue().then(() => this.schedule());
    }, this.options.pollIntervalMs);
  }

  /** One polling tick. Never rejects: the loop must survive any single failure. */
  processDue(): Promise<void> {
    const tick = this.runTick();
    this.active.add(tick);
    void tick.finally(() => this.active.delete(tick));
    return tick;
  }

  private async runTick(): Promise<void> {
    if (this.stopped) return;
    let due: Payment[];
    try {
      due = await this.repository.findDue(new Date(), this.options.batchSize);
    } catch (err) {
      this.logger.error({ err }, 'Failed to load due payments');
      return;
    }
    await Promise.allSettled(due.map((payment) => this.processOne(payment)));
  }

  private async processOne(payment: Payment): Promise<void> {
    try {
      // Claim with compare-and-set so two processors (or a request that cancels the
      // payment) can never both work on the same row.
      const history: PaymentHistoryEntry[] = [
        ...payment.history,
        {
          status: PaymentStatus.PROCESSING,
          at: new Date().toISOString(),
          note: `Attempt ${payment.attempts + 1} started`,
        },
      ];
      const claimed = await this.repository.updateIfStatus(
        payment.id,
        { status: PaymentStatus.PENDING, version: payment.version },
        { status: PaymentStatus.PROCESSING, history },
      );
      if (!claimed) {
        this.logger.debug({ paymentId: payment.id }, 'Payment already claimed or changed; skipping');
        return;
      }
      // Each successful update bumps the version by one.
      await this.charge(payment, history, payment.version + 1);
    } catch (err) {
      // E.g. a database error. The payment may be left PROCESSING; recoverStuck()
      // returns it to PENDING on the next start. Other payments in the batch go on.
      this.logger.error({ err, paymentId: payment.id }, 'Failed to process payment');
    }
  }

  private async charge(payment: Payment, history: PaymentHistoryEntry[], claimedVersion: number): Promise<void> {
    const at = (): string => new Date().toISOString();

    // Only the gateway call is inside this try: a database error while writing the
    // outcome must not be mistaken for a gateway failure and trigger a retry.
    let outcome:
      | { kind: 'approved'; transactionId: string }
      | { kind: 'declined'; reason: string }
      | { kind: 'transient'; reason: string };
    try {
      const result = await this.chargeWithTimeout(payment);
      outcome = { kind: 'approved', transactionId: result.transactionId };
    } catch (err) {
      if (err instanceof GatewayError && err.type === 'declined') {
        outcome = { kind: 'declined', reason: err.message };
      } else {
        if (!(err instanceof GatewayError)) {
          this.logger.warn({ err, paymentId: payment.id }, 'Unexpected error from gateway; treating as transient');
        }
        outcome = { kind: 'transient', reason: err instanceof Error ? err.message : 'Unknown gateway error' };
      }
    }

    if (outcome.kind === 'approved') {
      await this.finish(payment, claimedVersion, 'approved', {
        status: PaymentStatus.SUCCEEDED,
        history: [
          ...history,
          { status: PaymentStatus.SUCCEEDED, at: at(), note: `Approved, transaction ${outcome.transactionId}` },
        ],
      });
      this.logger.info({ paymentId: payment.id, transactionId: outcome.transactionId }, 'Payment succeeded');
      return;
    }

    if (outcome.kind === 'declined') {
      // A decline is final; retrying would only get the same answer.
      await this.finish(payment, claimedVersion, 'declined', {
        status: PaymentStatus.FAILED,
        failureReason: outcome.reason,
        history: [...history, { status: PaymentStatus.FAILED, at: at(), note: outcome.reason }],
      });
      return;
    }

    const attempts = payment.attempts + 1;
    if (attempts >= this.options.maxAttempts) {
      await this.finish(payment, claimedVersion, 'max_attempts_exceeded', {
        status: PaymentStatus.FAILED,
        attempts,
        failureReason: 'max_attempts_exceeded',
        history: [
          ...history,
          { status: PaymentStatus.FAILED, at: at(), note: `Attempt ${attempts} failed (${outcome.reason}); giving up` },
        ],
      });
      return;
    }

    const delay = backoffDelayMs(attempts, this.random);
    await this.finish(payment, claimedVersion, 'retry', {
      status: PaymentStatus.PENDING,
      attempts,
      nextAttemptAt: new Date(Date.now() + delay),
      history: [
        ...history,
        {
          status: PaymentStatus.PENDING,
          at: at(),
          note: `Attempt ${attempts} failed (${outcome.reason}); retrying in ${delay}ms`,
        },
      ],
    });
  }

  // Every outcome write expects the row to still be the PROCESSING row we claimed.
  // The API can PATCH a PROCESSING payment (to FAILED, SUCCEEDED or PENDING), so the
  // row may have moved while the gateway call was in flight; then our result is
  // discarded rather than overwriting the newer state. The gateway may already have
  // charged; that is accepted and documented.
  private async finish(payment: Payment, claimedVersion: number, outcome: string, changes: PaymentChanges): Promise<void> {
    const ok = await this.repository.updateIfStatus(
      payment.id,
      { status: PaymentStatus.PROCESSING, version: claimedVersion },
      changes,
    );
    if (!ok) {
      this.logger.warn({ paymentId: payment.id, outcome }, 'Payment changed while processing; result discarded');
    }
  }

  private async chargeWithTimeout(payment: Payment) {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new GatewayError('transient', 'Gateway call timed out'));
      }, this.options.gatewayTimeoutMs);
    });
    try {
      // Racing as well as aborting: a gateway that ignores the signal must not be
      // able to hang the whole tick (and with it every payment in the batch).
      const call = (async () => this.gateway.charge(payment.id, payment.amount, payment.currency, controller.signal))();
      return await Promise.race([call, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Returns payments left in PROCESSING by a crash or shutdown to PENDING.
   *
   * SINGLE-INSTANCE ASSUMPTION: this treats every PROCESSING row as abandoned. With
   * two service instances, a restarting one would steal payments the other is working
   * on right now. A multi-instance design needs a lease (e.g. a lockedUntil column
   * that a live worker keeps extending) and would only recover expired leases.
   *
   * Attempts are not incremented: the interrupted attempt's outcome is unknown (the
   * gateway may even have approved it), so it is not counted as a failure. The
   * gateway's idempotency by payment id protects against a double charge.
   */
  async recoverStuck(): Promise<number> {
    const stuck = await this.repository.findByStatus(PaymentStatus.PROCESSING);
    let recovered = 0;
    for (const payment of stuck) {
      try {
        const now = new Date();
        const ok = await this.repository.updateIfStatus(
          payment.id,
          { status: PaymentStatus.PROCESSING, version: payment.version },
          {
            status: PaymentStatus.PENDING,
            nextAttemptAt: now,
            history: [
              ...payment.history,
              { status: PaymentStatus.PENDING, at: now.toISOString(), note: 'Recovered after restart' },
            ],
          },
        );
        if (ok) recovered += 1;
      } catch (err) {
        this.logger.error({ err, paymentId: payment.id }, 'Failed to recover stuck payment');
      }
    }
    this.logger.info({ recovered }, 'Recovered stuck payments');
    return recovered;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    let timeoutTimer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timeoutTimer = setTimeout(() => resolve('timeout'), this.stopTimeoutMs);
      timeoutTimer.unref(); // never keeps the process alive by itself
    });
    const drained = Promise.allSettled([...this.active]).then(() => 'drained' as const);
    const result = await Promise.race([drained, timedOut]);
    clearTimeout(timeoutTimer);

    if (result === 'timeout') {
      this.logger.warn(
        { stopTimeoutMs: this.stopTimeoutMs },
        'Stopped with payments still in flight; they stay PROCESSING and are recovered on next start',
      );
    }
  }
}
