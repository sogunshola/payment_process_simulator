export type ChargeResult = { status: 'approved'; transactionId: string };

/**
 * 'transient' errors may succeed if retried (outage, timeout); 'declined' is a
 * final answer from the card issuer and must never be retried.
 */
export class GatewayError extends Error {
  constructor(
    readonly type: 'transient' | 'declined',
    message: string,
  ) {
    super(message);
    this.name = 'GatewayError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// The processor depends on this interface (not on SimulatedGateway) so tests can inject a fake.
export interface PaymentGateway {
  charge(paymentId: string, amount: number, currency: string, signal: AbortSignal): Promise<ChargeResult>;
}

export type GatewayConfig = {
  minLatencyMs: number;
  maxLatencyMs: number;
  failureRate: number;
  declineRate: number;
  timeoutRate: number;
};
