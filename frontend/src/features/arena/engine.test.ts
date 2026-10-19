import { describe, expect, it } from 'vitest';
import type { Payment } from '../../lib/api/types';
import { addCoin, reconcile, stepCoins, targetFor, type CoinMap } from './engine';

const pay = (id: string, over: Partial<Payment> = {}): Payment => ({
  id,
  reference: `ref-${id}`,
  amount: 1000,
  currency: 'USD',
  description: null,
  customerEmail: null,
  status: 'PENDING',
  failureReason: null,
  attempts: 0,
  nextAttemptAt: null,
  idempotencyKey: null,
  version: 1,
  history: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
});

function tracked(...ids: string[]): CoinMap {
  const m: CoinMap = new Map();
  ids.forEach((id) => addCoin(m, pay(id)));
  return m;
}

describe('reconcile', () => {
  it('emits a status event when the status changes', () => {
    const coins = tracked('a');
    const ev = reconcile(coins, [pay('a', { status: 'PROCESSING' })]);
    expect(ev).toEqual([{ type: 'status', id: 'a', from: 'PENDING', to: 'PROCESSING', attempts: 0, failureReason: null }]);
    expect(coins.get('a')?.status).toBe('PROCESSING');
  });

  it('emits nothing when nothing changed', () => {
    expect(reconcile(tracked('a'), [pay('a')])).toEqual([]);
  });

  it('emits a retry event when attempts increase, then the status change', () => {
    const coins = tracked('a');
    reconcile(coins, [pay('a', { status: 'PROCESSING' })]);
    const ev = reconcile(coins, [pay('a', { status: 'PENDING', attempts: 1 })]);
    expect(ev.map((e) => e.type)).toEqual(['retry', 'status']);
    expect(ev[0]).toMatchObject({ type: 'retry', attempts: 1 });
  });

  it('reports the failure reason on FAILED', () => {
    const coins = tracked('a');
    const ev = reconcile(coins, [pay('a', { status: 'FAILED', attempts: 5, failureReason: 'max_attempts_exceeded' })]);
    expect(ev.at(-1)).toMatchObject({ to: 'FAILED', failureReason: 'max_attempts_exceeded' });
  });

  it('ignores payments this run did not create', () => {
    const coins = tracked('a');
    expect(reconcile(coins, [pay('other', { status: 'FAILED' })])).toEqual([]);
    expect(coins.has('other')).toBe(false);
  });

  it('keeps the last known state of a tracked id missing from the response', () => {
    const coins = tracked('a', 'b');
    reconcile(coins, [pay('a', { status: 'PROCESSING' }), pay('b', { status: 'PROCESSING' })]);
    const ev = reconcile(coins, [pay('a', { status: 'SUCCEEDED' })]);
    expect(ev).toHaveLength(1);
    expect(coins.get('b')?.status).toBe('PROCESSING');
  });
});

describe('stepCoins', () => {
  it('snaps to the target with reduced motion', () => {
    const coins = tracked('a');
    reconcile(coins, [pay('a', { status: 'SUCCEEDED' })]);
    stepCoins(coins, 16, true);
    const t = targetFor(coins.get('a')!);
    expect(coins.get('a')).toMatchObject({ x: t.x, y: t.y });
  });

  it('eases toward the target otherwise', () => {
    const coins = tracked('a');
    reconcile(coins, [pay('a', { status: 'SUCCEEDED' })]);
    const before = coins.get('a')!.x;
    stepCoins(coins, 16, false);
    const x = coins.get('a')!.x;
    expect(x).toBeGreaterThan(before);
    expect(x).toBeLessThan(targetFor(coins.get('a')!).x);
  });

  it('removes a cancelled coin once it has faded out', () => {
    const coins = tracked('a');
    reconcile(coins, [pay('a', { status: 'CANCELLED' })]);
    stepCoins(coins, 16, true);
    expect(coins.has('a')).toBe(false);
  });
});
