import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { PaymentQueue } from '../payments/payment-queue';

export const QUEUE_NAME = 'payments';
export interface PaymentJobData {
  paymentId: string;
}

export const JOB_NAME = 'charge';

export class BullPaymentQueue implements PaymentQueue {
  private readonly queue: Queue;

  constructor(
    connection: Redis,
    private readonly maxAttempts: number,
  ) {
    this.queue = new Queue(QUEUE_NAME, { connection });
  }

  async enqueue(paymentId: string): Promise<void> {
    await this.queue.add(
      JOB_NAME,
      { paymentId },
      {
        // BullMQ ignores an add whose jobId already exists, so one payment never has two
        // jobs (queued, delayed or running), however often it is enqueued.
        jobId: paymentId,
        attempts: this.maxAttempts,
        // The handler picks the delay (full jitter); see retryDelayMs.
        backoff: { type: 'custom' },
        // Finished jobs are deleted so a manual retry can add the same jobId again.
        // The payment row is the record of the outcome.
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  close(): Promise<void> {
    return this.queue.close();
  }
}
