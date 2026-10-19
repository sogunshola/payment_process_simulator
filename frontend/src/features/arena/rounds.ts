import type { GatewayConfig } from '../../lib/api/types';

export interface Round {
  name: string;
  description: string;
  config: GatewayConfig;
}

export const ROUNDS: readonly Round[] = [
  {
    name: 'Warm-up',
    description: 'Latency spikes',
    config: { minLatencyMs: 300, maxLatencyMs: 2500, failureRate: 0.05, declineRate: 0, timeoutRate: 0 },
  },
  {
    name: 'Flaky gateway',
    description: '30% transient errors',
    config: { minLatencyMs: 100, maxLatencyMs: 800, failureRate: 0.3, declineRate: 0, timeoutRate: 0 },
  },
  {
    name: 'Timeout storm',
    description: '30% of calls time out',
    config: { minLatencyMs: 100, maxLatencyMs: 800, failureRate: 0.1, declineRate: 0, timeoutRate: 0.3 },
  },
  {
    name: 'Meltdown',
    description: 'Errors, declines and timeouts together',
    config: { minLatencyMs: 200, maxLatencyMs: 1500, failureRate: 0.4, declineRate: 0.2, timeoutRate: 0.1 },
  },
];

export const ROUND_MS = 45_000;
export const DEMO_ROUND_MS = 7_000;

interface Callbacks {
  onRoundStart: (round: Round, index: number) => void;
  onFinished: () => void;
}

/** Plain setTimeout scheduler (no React) so pause/resume can be tested with fake timers. */
export class RoundScheduler {
  private index = -1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private endsAt = 0;
  // Set only while paused; holds what was left of the current round.
  private pausedRemaining: number | null = null;

  constructor(
    private readonly roundMs: number,
    private readonly cb: Callbacks,
  ) {}

  get durationMs(): number {
    return this.roundMs;
  }

  start(): void {
    this.stop();
    this.beginRound(0);
  }

  pause(): void {
    if (this.timer === null) return;
    this.pausedRemaining = Math.max(0, this.endsAt - Date.now());
    clearTimeout(this.timer);
    this.timer = null;
  }

  resume(): void {
    if (this.pausedRemaining === null) return;
    const left = this.pausedRemaining;
    this.pausedRemaining = null;
    this.arm(left);
  }

  stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pausedRemaining = null;
    this.index = -1;
  }

  /** Time left in the current round; 0 when idle. */
  remainingMs(): number {
    if (this.pausedRemaining !== null) return this.pausedRemaining;
    return this.timer === null ? 0 : Math.max(0, this.endsAt - Date.now());
  }

  private beginRound(i: number): void {
    this.index = i;
    this.arm(this.roundMs);
    this.cb.onRoundStart(ROUNDS[i], i);
  }

  private arm(ms: number): void {
    this.endsAt = Date.now() + ms;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.index + 1 < ROUNDS.length) {
        this.beginRound(this.index + 1);
      } else {
        this.cb.onFinished();
      }
    }, ms);
  }
}
