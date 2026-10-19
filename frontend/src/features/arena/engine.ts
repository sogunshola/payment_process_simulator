// Coin state and polling reconciliation. No React: the canvas reads this map every frame
// from a ref, so nothing here may trigger a re-render.
import type { Payment, PaymentStatus } from '../../lib/api/types';

/** x and y are normalised (0..1 of the canvas) so a resize needs no recomputation. */
export interface Coin {
  id: string;
  status: PaymentStatus;
  attempts: number;
  failureReason: string | null;
  x: number;
  y: number;
  alpha: number;
  /** Stable per-coin offsets in [-1, 1] so coins in the same lane do not stack. */
  jx: number;
  jy: number;
}

export type CoinEvent =
  | { type: 'status'; id: string; from: PaymentStatus; to: PaymentStatus; attempts: number; failureReason: string | null }
  | { type: 'retry'; id: string; attempts: number };

export type CoinMap = Map<string, Coin>;

export const shortId = (id: string): string => id.slice(0, 8);

function hash01(id: string, salt: number): number {
  let h = salt;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 2000) / 1000 - 1;
}

export function addCoin(coins: CoinMap, p: Payment): void {
  coins.set(p.id, {
    id: p.id,
    status: p.status,
    attempts: p.attempts,
    failureReason: p.failureReason,
    x: 0.04,
    y: 0.5,
    alpha: 1,
    jx: hash01(p.id, 7),
    jy: hash01(p.id, 13),
  });
}

/**
 * Compare a poll response with the coins this run created. Only tracked ids are
 * looked at: other payments in the list are ignored, and a tracked id missing from
 * the response (pushed out of the newest 100) simply keeps its last known state.
 */
export function reconcile(coins: CoinMap, payments: Payment[]): CoinEvent[] {
  const events: CoinEvent[] = [];
  for (const p of payments) {
    const c = coins.get(p.id);
    if (!c) continue;
    const prevStatus = c.status;
    const attemptsUp = p.attempts > c.attempts;
    c.attempts = p.attempts;
    c.failureReason = p.failureReason;
    c.status = p.status;
    if (attemptsUp) events.push({ type: 'retry', id: p.id, attempts: p.attempts });
    if (p.status !== prevStatus) {
      events.push({ type: 'status', id: p.id, from: prevStatus, to: p.status, attempts: p.attempts, failureReason: p.failureReason });
    }
  }
  return events;
}

/** Where a coin wants to be, in normalised canvas coordinates. */
export function targetFor(c: Coin): { x: number; y: number; alpha: number } {
  switch (c.status) {
    case 'PENDING':
      // A retry bounces back out of the gateway, further left than the first-time queue.
      return c.attempts > 0
        ? { x: 0.3 + c.jx * 0.04, y: 0.5 + c.jy * 0.26, alpha: 1 }
        : { x: 0.2 + c.jx * 0.04, y: 0.5 + c.jy * 0.18, alpha: 1 };
    case 'PROCESSING':
      return { x: 0.5 + c.jx * 0.05, y: 0.5 + c.jy * 0.12, alpha: 1 };
    case 'SUCCEEDED':
      return { x: 0.86 + c.jx * 0.05, y: 0.25 + c.jy * 0.1, alpha: 1 };
    case 'FAILED':
      return { x: 0.86 + c.jx * 0.06, y: 0.8 + c.jy * 0.07, alpha: 1 };
    case 'CANCELLED':
      return { x: c.x, y: c.y, alpha: 0 };
  }
}

/** Ease every coin toward its target; with reduced motion, snap instead of tweening. */
export function stepCoins(coins: CoinMap, dtMs: number, reduced: boolean): void {
  // Frame-rate independent smoothing: the same speed at 30 and 144 fps.
  const k = reduced ? 1 : 1 - Math.exp(-dtMs / 120);
  for (const [id, c] of coins) {
    const t = targetFor(c);
    c.x += (t.x - c.x) * k;
    c.y += (t.y - c.y) * k;
    c.alpha += (t.alpha - c.alpha) * (reduced ? 1 : 1 - Math.exp(-dtMs / 400));
    if (c.status === 'CANCELLED' && c.alpha < 0.02) coins.delete(id);
  }
}
