export const PAYMENT_STATUSES = ['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export type Currency = 'NGN' | 'USD' | 'EUR' | 'GBP';

export interface HistoryEntry {
  status: PaymentStatus;
  at: string;
  note?: string;
}

export interface Payment {
  id: string;
  reference: string;
  /** Integer minor units (e.g. cents). Never a float. */
  amount: number;
  currency: Currency;
  description: string | null;
  customerEmail: string | null;
  status: PaymentStatus;
  failureReason: string | null;
  attempts: number;
  nextAttemptAt: string | null;
  idempotencyKey: string | null;
  version: number;
  history: HistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface PaymentList {
  data: Payment[];
  page: number;
  limit: number;
  total: number;
}

export interface PaymentListParams {
  status?: PaymentStatus;
  page?: number;
  limit?: number;
}

export type PaymentStats = Record<PaymentStatus, number> & { total: number };

export interface CreatePaymentInput {
  amount: number;
  currency: Currency;
  description?: string;
  customerEmail?: string;
}

export interface UpdateStatusInput {
  status: Exclude<PaymentStatus, 'PROCESSING'>;
  reason?: string;
}

export interface GatewayConfig {
  minLatencyMs: number;
  maxLatencyMs: number;
  failureRate: number;
  declineRate: number;
  timeoutRate: number;
}

export interface Health {
  status: 'ok';
  database: 'up';
  timestamp: string;
}
