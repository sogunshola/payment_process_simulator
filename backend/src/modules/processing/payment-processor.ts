import { Logger } from '../../common/logger';
import { GatewayError, PaymentGateway } from '../gateway/gateway.types';
import { Payment, PaymentHistoryEntry } from '../payments/payment.entity';
import { PaymentStatus } from '../payments/payment-status';
import { PaymentChanges, PaymentsRepository } from '../payments/payments.repository';

export interface ProcessorOptions {
  gatewayTimeoutMs: number;
}

/** The part of a BullMQ job the handler needs; a real `Job` satisfies it, so tests need no Redis. */
export interface PaymentJob {
  data: { paymentId: string };
  /** Attempts that already failed (BullMQ increments it after each failure, not at start). */
  attemptsMade: number;
  opts: { attempts?: number };
}

const MAX_BACKOFF_MS = 30_000;

/**
 * Exponential backoff with full jitter: a random delay in [0, min(30s, 1s * 2^attempts)).
 * Spreading retries randomly means a gateway that is recovering is not hit by every
 * failed payment at the same instant.
 */
export function backoffDelayMs(attempts: number, random: () => number): number {
  return Math.floor(random() * Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempts));
}

/**
 * Thrown to make BullMQ run the job again. It carries the delay already written to the
 * payment's nextAttemptAt, so the database and the queue agree on when the retry happens.
 */
export class RetryableError extends Error {
  constructor(
    message: string,
    readonly delayMs: number,
  ) {
    super(message);
    this.name = 'RetryableError';
  }
}

/** BullMQ `settings.backoffStrategy`: use the delay the handler chose; random backoff for anything else (e.g. a DB error). */
export function retryDelayMs(attemptsMade: number, _type?: string, err?: Error): number {
  return err instanceof RetryableError ? err.delayMs : backoffDelayMs(attemptsMade, Math.random);
}

/**
 * Handles one charge job. BullMQ owns queuing, retries, concurrency and crash recovery;
 * this class owns the payment state machine. Every write is a compare-and-set on the row.
 */
export class PaymentProcessor {
  constructor(
    private readonly repository: PaymentsRepository,
    private readonly gateway: PaymentGateway,
    private readonly options: ProcessorOptions,
    private readonly logger: Logger,
    private readonly random: () => number = Math.random,
  ) {}

  async handle(job: PaymentJob): Promise<void> {
    const payment = await this.repository.findById(job.data.paymentId);
    // Cancelled, already finished, or deleted since it was queued: nothing to do.
    if (!payment || (payment.status !== PaymentStatus.PENDING && payment.status !== PaymentStatus.PROCESSING)) {
      this.logger.debug({ paymentId: job.data.paymentId }, 'Payment not processable; skipping job');
      return;
    }

    // PROCESSING is a valid start state on purpose. jobId equals the payment id and BullMQ's
    // job lock gives one worker at a time, so a PROCESSING row here can only be this job's own
    // earlier attempt, abandoned by a worker that crashed (BullMQ re-ran the stalled job).
    // Its outcome is unknown (the gateway may have approved), so it is simply run again;
    // the gateway's idempotency by payment id prevents a double charge.
    const history: PaymentHistoryEntry[] = [
      ...payment.history,
      {
        status: PaymentStatus.PROCESSING,
        at: new Date().toISOString(),
        note: `Attempt ${payment.attempts + 1} started`,
      },
    ];
    // Compare-and-set so a request that cancels the payment right now cannot be overwritten.
    const claimed = await this.repository.updateIfStatus(
      payment.id,
      { status: payment.status, version: payment.version },
      { status: PaymentStatus.PROCESSING, history },
    );
    if (!claimed) {
      this.logger.debug({ paymentId: payment.id }, 'Payment changed before claim; skipping');
      return;
    }
    // Each successful update bumps the version by one.
    await this.charge(payment, history, payment.version + 1, job.attemptsMade + 1 >= (job.opts.attempts ?? 1));
  }

  private async charge(
    payment: Payment,
    history: PaymentHistoryEntry[],
    claimedVersion: number,
    isLastAttempt: boolean,
  ): Promise<void> {
    const at = (): string => new Date().toISOString();

    // Only the gateway call is inside this try: a database error while writing the
    // outcome must not be mistaken for a gateway failure (it propagates and BullMQ retries).
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
      const ok = await this.finish(payment, claimedVersion, 'approved', isLastAttempt, {
        status: PaymentStatus.SUCCEEDED,
        history: [
          ...history,
          { status: PaymentStatus.SUCCEEDED, at: at(), note: `Approved, transaction ${outcome.transactionId}` },
        ],
      });
      if (ok) this.logger.info({ paymentId: payment.id, transactionId: outcome.transactionId }, 'Payment succeeded');
      return;
    }

    if (outcome.kind === 'declined') {
      // A decline is final; retrying would only get the same answer.
      await this.finish(payment, claimedVersion, 'declined', isLastAttempt, {
        status: PaymentStatus.FAILED,
        failureReason: outcome.reason,
        history: [...history, { status: PaymentStatus.FAILED, at: at(), note: outcome.reason }],
      });
      return;
    }

    const attempts = payment.attempts + 1;
    if (isLastAttempt) {
      await this.finish(payment, claimedVersion, 'max_attempts_exceeded', isLastAttempt, {
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
    const ok = await this.finish(payment, claimedVersion, 'retry', isLastAttempt, {
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
    if (ok) throw new RetryableError(`Attempt ${attempts} failed: ${outcome.reason}`, delay);
  }

  // Every outcome write expects the row to still be the PROCESSING row we claimed.
  // The API can PATCH a PROCESSING payment (to FAILED, SUCCEEDED or PENDING), so the
  // row may have moved while the gateway call was in flight; then our result is
  // discarded rather than overwriting the newer state. The gateway may already have
  // charged; that is accepted and documented. Returns whether the write applied.
  private async finish(
    payment: Payment,
    claimedVersion: number,
    outcome: string,
    isLastAttempt: boolean,
    changes: PaymentChanges,
  ): Promise<boolean> {
    const ok = await this.repository.updateIfStatus(
      payment.id,
      { status: PaymentStatus.PROCESSING, version: claimedVersion },
      changes,
    );
    if (ok) return true;

    this.logger.warn({ paymentId: payment.id, outcome }, 'Payment changed while processing; result discarded');
    // If the API put the payment back to PENDING while this job was active, its enqueue was
    // deduplicated against this very job (same jobId), so nobody else will pick it up.
    // Run this job again at once. On the last attempt BullMQ would not retry, so the row
    // waits for the next boot reconcile instead.
    const fresh = await this.repository.findById(payment.id);
    if (fresh?.status === PaymentStatus.PENDING && !isLastAttempt) {
      throw new RetryableError('Payment was set back to PENDING while processing', 0);
    }
    return false;
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
      // able to hold this job (and its concurrency slot) forever.
      const call = (async () => this.gateway.charge(payment.id, payment.amount, payment.currency, controller.signal))();
      return await Promise.race([call, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
