import { ApiError, toApiError } from './api-error';
import { getSettings } from './settings';
import type {
  CreatePaymentInput,
  GatewayConfig,
  Health,
  Payment,
  PaymentList,
  PaymentListParams,
  PaymentStats,
  UpdateStatusInput,
} from './types';

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

async function request<T>(
  method: string,
  path: string,
  opts: { body?: unknown; headers?: Record<string, string>; auth?: boolean; keepalive?: boolean } = {},
): Promise<T> {
  const { apiUrl, apiKey } = getSettings();
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (apiKey && opts.auth !== false) headers['X-API-Key'] = apiKey;

  let res: Response;
  try {
    res = await fetch(joinUrl(apiUrl, path), {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      keepalive: opts.keepalive,
    });
  } catch {
    throw toApiError(0, null);
  }

  // Read as text first: a proxy error page is not JSON and res.json() would throw.
  const text = await res.text().catch(() => '');
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (!res.ok) throw toApiError(res.status, parsed);
  return parsed as T;
}

function query(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export const api = {
  health: () => request<Health>('GET', '/health', { auth: false }),
  listPayments: (p: PaymentListParams = {}) =>
    request<PaymentList>('GET', `/payments${query({ status: p.status, page: p.page, limit: p.limit })}`),
  getPayment: (id: string) => request<Payment>('GET', `/payments/${encodeURIComponent(id)}`),
  getStats: () => request<PaymentStats>('GET', '/payments/stats'),
  // A fresh key per call: one call is one user intent. Mutation retries are
  // disabled in the QueryClient, so a key is never reused for a different intent
  // and a double click on a new submit creates a new payment, not a replay.
  createPayment: (input: CreatePaymentInput) =>
    request<Payment>('POST', '/payments', {
      body: input,
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    }),
  updatePaymentStatus: (id: string, input: UpdateStatusInput) =>
    request<Payment>('PATCH', `/payments/${encodeURIComponent(id)}/status`, { body: input }),
  getGatewayConfig: () => request<GatewayConfig>('GET', '/gateway/config'),
  // keepalive lets the request outlive the page (used by the Arena on pagehide).
  // It works with the default same-origin `/api` proxy because no CORS preflight is needed.
  updateGatewayConfig: (input: GatewayConfig, opts: { keepalive?: boolean } = {}) =>
    request<GatewayConfig>('PUT', '/gateway/config', { body: input, keepalive: opts.keepalive }),
};

export { ApiError };
