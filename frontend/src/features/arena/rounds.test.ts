import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROUNDS, RoundScheduler } from './rounds';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function make(ms = 1000) {
  const started: number[] = [];
  const onFinished = vi.fn();
  const s = new RoundScheduler(ms, { onRoundStart: (_r, i) => started.push(i), onFinished });
  return { s, started, onFinished };
}

describe('RoundScheduler', () => {
  it('starts round 1 at once and the rest in order on time', () => {
    const { s, started, onFinished } = make();
    s.start();
    expect(started).toEqual([0]);
    vi.advanceTimersByTime(999);
    expect(started).toEqual([0]);
    vi.advanceTimersByTime(1);
    expect(started).toEqual([0, 1]);
    vi.advanceTimersByTime(2000);
    expect(started).toEqual([0, 1, 2, 3]);
    expect(onFinished).not.toHaveBeenCalled();
  });

  it('calls onFinished once, after round 4 ends', () => {
    const { s, onFinished } = make();
    s.start();
    vi.advanceTimersByTime(ROUNDS.length * 1000 - 1);
    expect(onFinished).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFinished).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('pause keeps the remaining time and resume continues from it', () => {
    const { s, started } = make();
    s.start();
    vi.advanceTimersByTime(400);
    s.pause();
    expect(s.remainingMs()).toBe(600);
    vi.advanceTimersByTime(60_000);
    expect(started).toEqual([0]);
    s.resume();
    vi.advanceTimersByTime(599);
    expect(started).toEqual([0]);
    vi.advanceTimersByTime(1);
    expect(started).toEqual([0, 1]);
  });

  it('stop prevents any further callbacks', () => {
    const { s, started, onFinished } = make();
    s.start();
    s.stop();
    vi.advanceTimersByTime(60_000);
    expect(started).toEqual([0]);
    expect(onFinished).not.toHaveBeenCalled();
  });

  it('resume without a pause is a no-op', () => {
    const { s, started } = make();
    s.start();
    s.resume();
    vi.advanceTimersByTime(1000);
    expect(started).toEqual([0, 1]);
  });

  it('works with a compressed duration', () => {
    const { s, onFinished } = make(7000);
    s.start();
    vi.advanceTimersByTime(28_000);
    expect(onFinished).toHaveBeenCalledTimes(1);
  });
});
