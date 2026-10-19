/**
 * Hands a PENDING payment to the background worker. Kept as a tiny interface so the
 * payments module does not depend on BullMQ and tests can pass a fake.
 */
export interface PaymentQueue {
  /** Idempotent per payment id: enqueueing an id that is already queued or running is a no-op. */
  enqueue(paymentId: string): Promise<void>;
}
