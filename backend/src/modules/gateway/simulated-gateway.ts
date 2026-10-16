import { randomUUID } from 'node:crypto';
import { Logger } from '../../common/logger';
import { ChargeResult, GatewayConfig, GatewayError, PaymentGateway } from './gateway.types';

type FinalOutcome = { ok: true; result: ChargeResult } | { ok: false; error: GatewayError };

const timedOut = (): GatewayError => new GatewayError('transient', 'Gateway timed out');

/**
 * Fake payment provider with configurable latency and failure rates.
 *
 * Limitations (acceptable for a simulation): all state is in memory, so it is lost
 * on restart (a payment could then be charged again), and the outcome map is never
 * pruned, so it grows with every payment.
 */
export class SimulatedGateway implements PaymentGateway {
  private config: GatewayConfig;
  // Only final outcomes are stored here.
  private readonly finalOutcomes = new Map<string, FinalOutcome>();
  private readonly inFlight = new Map<string, Promise<ChargeResult>>();
  private readonly charges = new Map<string, number>();

  constructor(
    initialConfig: GatewayConfig,
    private readonly logger: Logger,
    private readonly random: () => number = Math.random,
  ) {
    this.config = { ...initialConfig };
  }

  getConfig(): GatewayConfig {
    return { ...this.config };
  }

  setConfig(config: GatewayConfig): void {
    this.config = { ...config };
  }

  /** Number of real charges (approvals) made for a payment; tests use it to prove no double charge. */
  chargeCount(paymentId: string): number {
    return this.charges.get(paymentId) ?? 0;
  }

  charge(paymentId: string, _amount: number, _currency: string, signal: AbortSignal): Promise<ChargeResult> {
    // Idempotency by paymentId, like a real gateway's idempotency key: a repeated
    // request returns the first final answer instead of charging again.
    const cached = this.finalOutcomes.get(paymentId);
    if (cached) {
      this.logger.info({ paymentId }, 'Duplicate charge request; returning cached result');
      return cached.ok ? Promise.resolve(cached.result) : Promise.reject(cached.error);
    }

    const running = this.inFlight.get(paymentId);
    if (running) {
      this.logger.info({ paymentId }, 'Duplicate charge request; returning cached result');
      return this.withSignal(running, signal);
    }

    if (signal.aborted) return Promise.reject(timedOut());

    // The shared call runs under the first caller's signal; if that caller times out,
    // a joined caller sees the same transient failure and simply retries later.
    const call = this.run(paymentId, signal).finally(() => this.inFlight.delete(paymentId));
    this.inFlight.set(paymentId, call);
    return call;
  }

  private async run(paymentId: string, signal: AbortSignal): Promise<ChargeResult> {
    const { minLatencyMs, maxLatencyMs, timeoutRate, declineRate, failureRate } = this.config;
    await this.sleep(minLatencyMs + this.random() * (maxLatencyMs - minLatencyMs), signal);

    // One roll decides the outcome so the three rates are mutually exclusive slices of [0, 1).
    const r = this.random();
    if (r < timeoutRate) {
      await this.hangUntilAborted(signal);
      throw timedOut();
    }
    if (r < timeoutRate + declineRate) {
      const error = new GatewayError('declined', 'Card declined');
      // A decline is final: retrying the same payment would get the same answer.
      this.finalOutcomes.set(paymentId, { ok: false, error });
      throw error;
    }
    if (r < timeoutRate + declineRate + failureRate) {
      // Transient errors and timeouts are deliberately NOT cached: caching them would
      // make every retry replay the failure. A real gateway's idempotency key behaves
      // the same way (only completed charges are remembered).
      throw new GatewayError('transient', 'Gateway temporarily unavailable');
    }

    const result: ChargeResult = { status: 'approved', transactionId: randomUUID() };
    this.finalOutcomes.set(paymentId, { ok: true, result });
    this.charges.set(paymentId, this.chargeCount(paymentId) + 1);
    return result;
  }

  // Abortable delay; the timer and the listener are always removed so nothing leaks.
  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(timedOut());
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(timedOut());
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  // Simulates a hung connection: never settles on its own, only when the caller gives up.
  private hangUntilAborted(signal: AbortSignal): Promise<never> {
    return new Promise((_resolve, reject) => {
      if (signal.aborted) return reject(timedOut());
      signal.addEventListener('abort', () => reject(timedOut()), { once: true });
    });
  }

  // Lets a joined caller give up on its own deadline without cancelling the shared call.
  private withSignal(promise: Promise<ChargeResult>, signal: AbortSignal): Promise<ChargeResult> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(timedOut());
      const onAbort = (): void => reject(timedOut());
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });
  }
}
