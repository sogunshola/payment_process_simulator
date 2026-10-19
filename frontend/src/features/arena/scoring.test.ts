import { describe, expect, it } from 'vitest';
import {
  applyResult,
  breachRemainingMs,
  comboMultiplier,
  initialScore,
  isBreached,
  overallRate,
  slaRate,
  stars,
  updateBelow,
  type ScoreState,
  type Settled,
} from './scoring';

const run = (results: Settled[], s: ScoreState = initialScore()) => results.reduce(applyResult, s);
const many = (n: number, r: Settled): Settled[] => Array.from({ length: n }, () => r);

describe('combo', () => {
  it('multiplier steps up every 3 successes and caps at 5', () => {
    expect([0, 2, 3, 5, 6, 11, 12, 100].map(comboMultiplier)).toEqual([1, 1, 2, 2, 3, 4, 5, 5]);
  });

  it('awards 100 x multiplier per success', () => {
    // streak 0,1,2 -> x1 (300), then streak 3 -> x2 (200)
    expect(run(many(4, 'SUCCEEDED')).score).toBe(500);
  });

  it('a failure resets the streak and subtracts 150', () => {
    const s = run([...many(4, 'SUCCEEDED'), 'FAILED']);
    expect(s.streak).toBe(0);
    expect(s.score).toBe(500 - 150);
  });

  it('clamps the score at 0', () => {
    expect(run(['FAILED', 'FAILED']).score).toBe(0);
  });

  it('a cancel costs 25 but keeps the combo', () => {
    const s = run([...many(3, 'SUCCEEDED'), 'CANCELLED']);
    expect(s.streak).toBe(3);
    expect(s.score).toBe(300 - 25);
    expect(s.cancelled).toBe(1);
  });
});

describe('SLA', () => {
  it('is null (warming up) under 5 settled, even if all failed', () => {
    expect(slaRate(run(many(4, 'FAILED')))).toBeNull();
    expect(slaRate(run(many(5, 'FAILED')))).toBe(0);
  });

  it('ignores cancelled payments', () => {
    const s = run([...many(4, 'SUCCEEDED'), ...many(10, 'CANCELLED')]);
    expect(slaRate(s)).toBeNull();
    expect(slaRate(run(['SUCCEEDED'], s))).toBe(1);
  });

  it('only looks at the last 20 settled', () => {
    // 10 old failures are pushed out by 20 successes
    expect(slaRate(run([...many(10, 'FAILED'), ...many(20, 'SUCCEEDED')]))).toBe(1);
    // 20 successes then 10 failures -> 10 of last 20 succeeded
    expect(slaRate(run([...many(20, 'SUCCEEDED'), ...many(10, 'FAILED')]))).toBe(0.5);
  });

  it('breaches only after 10 continuous seconds below 60%', () => {
    let s = run(many(5, 'FAILED'));
    s = updateBelow(s, 1000);
    expect(s.belowSince).toBe(1000);
    expect(isBreached(s, 10_999)).toBe(false);
    expect(breachRemainingMs(s, 6000)).toBe(5000);
    expect(isBreached(s, 11_000)).toBe(true);
    // a later reading does not restart the clock
    expect(updateBelow(s, 5000).belowSince).toBe(1000);
  });

  it('resets the timer as soon as the rate recovers to 60%', () => {
    let s = updateBelow(run(many(5, 'FAILED')), 0);
    s = run(many(8, 'SUCCEEDED'), s); // 8 of 13 = 61.5%
    s = updateBelow(s, 9000);
    expect(s.belowSince).toBeNull();
    expect(isBreached(s, 20_000)).toBe(false);
    expect(breachRemainingMs(s, 20_000)).toBeNull();
  });

  it('cannot breach while warming up', () => {
    expect(updateBelow(run(many(4, 'FAILED')), 0).belowSince).toBeNull();
  });
});

describe('stars', () => {
  it('3 needs a completed run at 90%+', () => {
    expect(stars(0.9, true)).toBe(3);
    expect(stars(0.95, false)).toBe(2); // not completed: capped at 2
  });
  it('2 at 75%+, 1 at 60%+, else 0', () => {
    expect(stars(0.75, true)).toBe(2);
    expect(stars(0.6, false)).toBe(1);
    expect(stars(0.59, true)).toBe(0);
  });
  it('0 when nothing settled', () => {
    expect(stars(overallRate(initialScore()), true)).toBe(0);
  });
});
