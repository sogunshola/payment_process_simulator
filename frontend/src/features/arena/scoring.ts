// Pure scoring rules. No React and no clock: callers pass `now` in, so tests are deterministic.

export const SUCCESS_POINTS = 100;
export const FAILURE_PENALTY = 150;
export const CANCEL_PENALTY = 25;
export const SLA_WINDOW = 20;
export const SLA_MIN_SETTLED = 5;
export const SLA_TARGET = 0.9;
export const SLA_DANGER = 0.6;
export const BREACH_MS = 10_000;

export interface ScoreState {
  /** Never below 0: a bad start cannot bury the player under a debt they cannot climb out of. */
  score: number;
  /** Consecutive successes. A failure resets it; a player cancel does not touch it. */
  streak: number;
  /** true = SUCCEEDED, false = FAILED, newest last. Cancels are never in here. */
  window: boolean[];
  successes: number;
  failures: number;
  cancelled: number;
  /** When the SLA first dropped below the danger line, or null while healthy/warming up. */
  belowSince: number | null;
}

export type Settled = 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

export const initialScore = (): ScoreState => ({
  score: 0,
  streak: 0,
  window: [],
  successes: 0,
  failures: 0,
  cancelled: 0,
  belowSince: null,
});

/**
 * Multiplier for the NEXT success: min(1 + floor(streak / 3), 5).
 * Streak 0-2 -> x1, 3-5 -> x2, ... 12+ -> x5.
 */
export const comboMultiplier = (streak: number): number => Math.min(1 + Math.floor(streak / 3), 5);

export function applyResult(s: ScoreState, result: Settled): ScoreState {
  if (result === 'SUCCEEDED') {
    return {
      ...s,
      score: s.score + SUCCESS_POINTS * comboMultiplier(s.streak),
      streak: s.streak + 1,
      successes: s.successes + 1,
      window: [...s.window, true].slice(-SLA_WINDOW),
    };
  }
  if (result === 'FAILED') {
    return {
      ...s,
      score: Math.max(0, s.score - FAILURE_PENALTY),
      streak: 0,
      failures: s.failures + 1,
      window: [...s.window, false].slice(-SLA_WINDOW),
    };
  }
  // The player chose to drop it: a small cost, but not an SLA miss and not a broken streak.
  return { ...s, score: Math.max(0, s.score - CANCEL_PENALTY), cancelled: s.cancelled + 1 };
}

/** Success rate over the last 20 settled payments, or null while warming up. */
export function slaRate(s: ScoreState): number | null {
  if (s.window.length < SLA_MIN_SETTLED) return null;
  return s.window.filter(Boolean).length / s.window.length;
}

/** Track how long the SLA has been continuously in the danger zone. Any healthy reading resets it. */
export function updateBelow(s: ScoreState, now: number): ScoreState {
  const rate = slaRate(s);
  if (rate === null || rate >= SLA_DANGER) return s.belowSince === null ? s : { ...s, belowSince: null };
  return s.belowSince === null ? { ...s, belowSince: now } : s;
}

export const isBreached = (s: ScoreState, now: number): boolean =>
  s.belowSince !== null && now - s.belowSince >= BREACH_MS;

/** Milliseconds left before a breach, or null when not in the danger zone. */
export const breachRemainingMs = (s: ScoreState, now: number): number | null =>
  s.belowSince === null ? null : Math.max(0, BREACH_MS - (now - s.belowSince));

/** Whole-run success rate (not just the window), or null if nothing settled. */
export function overallRate(s: ScoreState): number | null {
  const total = s.successes + s.failures;
  return total === 0 ? null : s.successes / total;
}

/** Only the top tier needs a finished run; the lower tiers go by success rate alone. */
export function stars(rate: number | null, completed: boolean): 0 | 1 | 2 | 3 {
  if (rate === null) return 0;
  if (completed && rate >= SLA_TARGET) return 3;
  if (rate >= 0.75) return 2;
  if (rate >= SLA_DANGER) return 1;
  return 0;
}
