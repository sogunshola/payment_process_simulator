// Orchestration for one Arena session. Plain TypeScript so every timer, request and
// restore path is in one place; the React hook only subscribes to `emit`.
// Per-coin state lives in `coins` (read by the canvas each frame); `emit` fires at
// most once per poll / action, which is what keeps React out of the animation loop.
import { api, ApiError } from '../../lib/api/client';
import type { Currency, GatewayConfig } from '../../lib/api/types';
import { saveBest, loadBest, type BestEntry } from './best-scores';
import { addCoin, reconcile, shortId, type CoinEvent, type CoinMap } from './engine';
import { loadSnapshot, restoreGateway, restoreOnUnload, saveSnapshot } from './gateway-guard';
import { DEMO_ROUND_MS, ROUND_MS, ROUNDS, RoundScheduler, type Round } from './rounds';
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
} from './scoring';

export type Phase = 'idle' | 'running' | 'paused' | 'ended';
export type PowerId = 'slow' | 'failover' | 'cancel';
export type LogKind = 'info' | 'good' | 'bad' | 'warn';

export interface LogEntry {
  id: number;
  text: string;
  kind: LogKind;
}

export interface Report {
  outcome: 'survived' | 'breached';
  round: number;
  score: number;
  stars: number;
  successRate: number | null;
  retries: number;
  failures: number;
  cancelled: number;
  demo: boolean;
  best: BestEntry[];
}

export interface Hud {
  phase: Phase;
  starting: boolean;
  demo: boolean;
  /** 0-based index of the current round, -1 before the first. */
  roundIdx: number;
  roundRemainingMs: number;
  roundMs: number;
  score: number;
  streak: number;
  multiplier: number;
  sla: number | null;
  breachRemainingMs: number | null;
  vault: number;
  failed: number;
  retries: number;
  chaos: boolean;
  cooldowns: Record<PowerId, number>;
  report: Report | null;
}

export interface Snapshot {
  hud: Hud;
  log: LogEntry[];
}

export const POWERS: Record<PowerId, { label: string; hint: string; cooldownMs: number }> = {
  slow: { label: 'Slow intake', hint: 'Doubles the spawn interval for 10 s', cooldownMs: 20_000 },
  failover: { label: 'Failover', hint: 'Healthy gateway for 8 s', cooldownMs: 25_000 },
  cancel: { label: 'Cancel doomed', hint: 'Cancel pending payments with 3+ attempts', cooldownMs: 15_000 },
};

// POST /payments is limited to 30/min per IP; 2.5 s is 24/min, which leaves headroom.
const BASE_SPAWN_MS = 2500;
const SLOW_MS = 10_000;
const THROTTLE_MS = 10_000;
const FAILOVER_MS = 8_000;
const DOOMED_ATTEMPTS = 3;
const MAX_LOG = 100;
const CURRENCIES: Currency[] = ['NGN', 'USD', 'EUR', 'GBP'];
const HEALTHY: GatewayConfig = { minLatencyMs: 50, maxLatencyMs: 150, failureRate: 0, declineRate: 0, timeoutRate: 0 };

interface Run {
  id: string;
  n: number;
  demo: boolean;
  score: ScoreState;
  roundIdx: number;
  retries: number;
  slowUntil: number;
  throttleUntil: number;
  lastSpawnAt: number;
  cooldownUntil: Record<PowerId, number>;
  pausedAt: number | null;
}

const newRun = (demo: boolean): Run => ({
  id: Math.random().toString(16).slice(2, 8),
  n: 0,
  demo,
  score: initialScore(),
  roundIdx: -1,
  retries: 0,
  slowUntil: 0,
  throttleUntil: 0,
  lastSpawnAt: 0,
  cooldownUntil: { slow: 0, failover: 0, cancel: 0 },
  pausedAt: null,
});

const randInt = (min: number, max: number): number => min + Math.floor(Math.random() * (max - min + 1));

function describe(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 429) return 'rate limited by API (429)';
    if (e.status === 401) return 'API key rejected (401)';
    if (e.status === 0) return 'network error, cannot reach the API';
    return e.message;
  }
  return 'unexpected error';
}

export class ArenaGame {
  readonly coins: CoinMap = new Map();
  /** Read by the canvas every frame: 0 (calm) to 1 (meltdown). Not React state. */
  readonly scene = { intensity: 0 };

  private phase: Phase = 'idle';
  private starting = false;
  private run: Run = newRun(false);
  private sched: RoundScheduler | null = null;
  private report: Report | null = null;
  private log: LogEntry[] = [];
  private logId = 0;

  private snapshot: GatewayConfig | null = null;
  // True from the moment we start changing the backend config until a restore succeeds.
  private dirty = false;
  // Gateway writes are serialised so a late "apply" can never land after a "restore".
  private gw: Promise<void> = Promise.resolve();

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private spawnTimer: ReturnType<typeof setTimeout> | null = null;
  private failoverTimer: ReturnType<typeof setTimeout> | null = null;
  private demoTimers: ReturnType<typeof setTimeout>[] = [];
  private spawning = false;
  private polling = false;
  private failoverActive = false;
  private lastPollError: string | null = null;

  constructor(
    private readonly emit: (s: Snapshot) => void,
    private readonly notify: (kind: 'error' | 'info', message: string) => void,
  ) {}

  // ---- lifecycle -----------------------------------------------------------

  /** A previous tab may have died mid-run and left the backend in chaos mode. */
  restoreStale(): void {
    const stale = loadSnapshot();
    if (!stale || this.dirty) return;
    this.snapshot = stale;
    this.dirty = true;
    this.say('Found a gateway config left by an earlier session, restoring it', 'warn');
    void this.restore();
  }

  async start(demo: boolean): Promise<void> {
    if (this.phase === 'running' || this.phase === 'paused' || this.starting) return;
    this.starting = true;
    this.publish();
    try {
      // A failed restore earlier would make GET return chaos, which we must not adopt as "default".
      await this.restore();
      if (this.dirty) {
        this.notify('error', 'Cannot start: the previous gateway config could not be restored');
        return;
      }
      let snap: GatewayConfig;
      try {
        snap = await api.getGatewayConfig();
      } catch (e) {
        this.say(`Cannot start: ${describe(e)}`, 'bad');
        this.notify('error', `Cannot start: ${describe(e)}`);
        return;
      }
      this.snapshot = snap;
      saveSnapshot(snap);
      this.begin(demo);
    } finally {
      this.starting = false;
      this.publish();
    }
  }

  pause(): void {
    if (this.phase !== 'running' || this.run.demo) return;
    this.phase = 'paused';
    this.run.pausedAt = Date.now();
    this.sched?.pause();
    this.stopTimers();
    this.failoverActive = false;
    this.say('Paused, gateway config restored', 'info');
    void this.restore();
    this.publish();
  }

  resume(): void {
    if (this.phase !== 'paused') return;
    // Cooldowns, buffs and the SLA clock should not run down while paused.
    const shift = Date.now() - (this.run.pausedAt ?? Date.now());
    const r = this.run;
    r.pausedAt = null;
    r.slowUntil += shift;
    r.throttleUntil += shift;
    for (const k of Object.keys(r.cooldownUntil) as PowerId[]) r.cooldownUntil[k] += shift;
    if (r.score.belowSince !== null) r.score = { ...r.score, belowSince: r.score.belowSince + shift };
    this.phase = 'running';
    this.sched?.resume();
    this.say('Resumed', 'info');
    this.applyConfig(ROUNDS[r.roundIdx].config);
    this.startTimers();
    this.publish();
  }

  reset(): void {
    this.stopEverything();
    this.phase = 'idle';
    this.report = null;
    this.coins.clear();
    this.log = [];
    this.run = newRun(false);
    this.lastPollError = null;
    void this.restore();
    this.publish();
  }

  closeReport(): void {
    this.report = null;
    this.publish();
  }

  /** Route exit. Safe to call and then reuse (React StrictMode mounts twice in dev). */
  dispose(): void {
    this.stopEverything();
    this.phase = 'idle';
    if (this.dirty) void this.restore();
  }

  // Arrow property so it can be passed straight to addEventListener.
  onPageHide = (): void => {
    if (this.dirty && this.snapshot) restoreOnUnload(this.snapshot);
  };

  // ---- run -----------------------------------------------------------------

  private begin(demo: boolean): void {
    this.coins.clear();
    this.log = [];
    this.report = null;
    this.lastPollError = null;
    this.run = newRun(demo);
    // First coin after ~300 ms, then the normal cadence.
    this.run.lastSpawnAt = Date.now() - this.spawnIntervalMs() + 300;
    this.phase = 'running';
    this.say(demo ? 'Auto-demo started' : 'Run started. You are on call.', 'info');
    this.sched = new RoundScheduler(demo ? DEMO_ROUND_MS : ROUND_MS, {
      onRoundStart: (round, i) => this.onRound(round, i),
      onFinished: () => this.end('survived'),
    });
    this.startTimers();
    this.sched.start();
    this.publish();
  }

  private onRound(round: Round, i: number): void {
    this.run.roundIdx = i;
    this.say(`Round ${i + 1}: ${round.name} (${round.description})`, 'warn');
    // Failover owns the gateway until it ends; its end handler applies the then-current round.
    if (this.failoverActive) this.say('Failover holds the gateway until it ends', 'info');
    else this.applyConfig(round.config);
    if (this.run.demo) this.demoScript(i);
    this.publish();
  }

  // Scripted powers for the auto-demo, going through the same code paths as a player click.
  private demoScript(round: number): void {
    if (round === 1) this.usePower('slow');
    if (round === 2) this.demoTimers.push(setTimeout(() => this.usePower('cancel'), 4000));
    if (round === 3) this.usePower('failover');
  }

  private end(outcome: 'survived' | 'breached'): void {
    if (this.phase !== 'running') return;
    const r = this.run;
    this.stopEverything();
    this.phase = 'ended';
    const rate = overallRate(r.score);
    const completed = outcome === 'survived';
    const starCount = stars(rate, completed);
    // Demo runs are not saved: they are scripted and would pollute the board.
    const best = r.demo ? loadBest() : saveBest({ score: r.score.score, stars: starCount, date: new Date().toISOString() });
    this.report = {
      outcome,
      round: r.roundIdx + 1,
      score: r.score.score,
      stars: starCount,
      successRate: rate,
      retries: r.retries,
      failures: r.score.failures,
      cancelled: r.score.cancelled,
      demo: r.demo,
      best,
    };
    this.say(outcome === 'survived' ? 'Run complete: you survived' : `SLA breached in round ${r.roundIdx + 1}`, outcome === 'survived' ? 'good' : 'bad');
    void this.restore();
    this.publish();
  }

  // ---- timers: spawn + poll -------------------------------------------------

  private startTimers(): void {
    this.pollTimer = setInterval(() => void this.tick(), 1000);
    this.scheduleSpawn();
  }

  private stopTimers(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.spawnTimer) clearTimeout(this.spawnTimer);
    this.pollTimer = null;
    this.spawnTimer = null;
  }

  private stopEverything(): void {
    this.stopTimers();
    this.sched?.stop();
    this.sched = null;
    if (this.failoverTimer) clearTimeout(this.failoverTimer);
    this.failoverTimer = null;
    this.failoverActive = false;
    this.demoTimers.forEach(clearTimeout);
    this.demoTimers = [];
  }

  private spawnIntervalMs(now = Date.now()): number {
    const r = this.run;
    return BASE_SPAWN_MS * (now < r.slowUntil ? 2 : 1) * (now < r.throttleUntil ? 2 : 1);
  }

  private scheduleSpawn(): void {
    if (this.spawnTimer || this.spawning) return;
    const now = Date.now();
    const delay = Math.max(0, this.run.lastSpawnAt + this.spawnIntervalMs(now) - now);
    this.spawnTimer = setTimeout(() => {
      this.spawnTimer = null;
      void this.spawn();
    }, delay);
  }

  private live(runId: string): boolean {
    return this.phase === 'running' && this.run.id === runId;
  }

  private async spawn(): Promise<void> {
    const runId = this.run.id;
    this.spawning = true;
    this.run.lastSpawnAt = Date.now();
    const n = ++this.run.n;
    try {
      const p = await api.createPayment({
        reference: `arena-${runId}-${n}`,
        amount: randInt(500, 50000),
        currency: CURRENCIES[randInt(0, CURRENCIES.length - 1)],
        description: 'Chaos Arena',
      });
      // A reset during the request means this coin belongs to a dead run.
      if (this.run.id === runId) {
        addCoin(this.coins, p);
        this.say(`#${shortId(p.id)} spawned (${p.amount} ${p.currency})`, 'info');
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        // Skip this spawn and slow down; never retry immediately.
        this.run.throttleUntil = Date.now() + THROTTLE_MS;
        this.say('Intake throttled by API (429), spawn interval doubled for 10 s', 'warn');
      } else if (e instanceof ApiError && e.status === 401) {
        this.notify('error', 'API key rejected (401). Set it in Settings.');
        this.reset();
        return;
      } else if (this.run.id === runId) {
        this.say(`Spawn failed: ${describe(e)}`, 'bad');
      }
    } finally {
      this.spawning = false;
      if (this.live(runId)) this.scheduleSpawn();
      this.publish();
    }
  }

  private async tick(): Promise<void> {
    if (this.polling) return;
    const runId = this.run.id;
    if (!this.live(runId)) return;
    this.polling = true;
    try {
      // limit=100 returns the newest 100. A run creates at most ~90 payments at the
      // rate limit, so tracked coins stay inside it; one that falls out keeps its last state.
      const list = await api.listPayments({ limit: 100 });
      if (!this.live(runId)) return;
      this.lastPollError = null;
      this.handle(reconcile(this.coins, list.data));
    } catch (e) {
      // Log a given error once per streak, otherwise a dead API floods the log every second.
      const msg = describe(e);
      if (this.live(runId) && msg !== this.lastPollError) this.say(`Polling failed: ${msg}`, 'bad');
      this.lastPollError = msg;
    } finally {
      this.polling = false;
    }
    if (!this.live(runId)) return;
    const now = Date.now();
    this.run.score = updateBelow(this.run.score, now);
    if (isBreached(this.run.score, now)) {
      this.end('breached');
      return;
    }
    this.publish();
  }

  private handle(events: CoinEvent[]): void {
    const r = this.run;
    for (const ev of events) {
      const id = `#${shortId(ev.id)}`;
      if (ev.type === 'retry') {
        // Every observed attempts increment counts, including on coins that later fail.
        r.retries++;
        this.say(`${id} retry #${ev.attempts}`, 'warn');
        continue;
      }
      if (ev.to === 'PROCESSING') this.say(`${id} entered gateway`, 'info');
      else if (ev.to === 'SUCCEEDED') {
        r.score = applyResult(r.score, 'SUCCEEDED');
        this.say(`${id} succeeded`, 'good');
      } else if (ev.to === 'FAILED') {
        r.score = applyResult(r.score, 'FAILED');
        this.say(`${id} failed${ev.failureReason ? ` (${ev.failureReason})` : ''}`, 'bad');
      } else if (ev.to === 'CANCELLED') {
        r.score = applyResult(r.score, 'CANCELLED');
        this.say(`${id} cancelled`, 'info');
      }
    }
  }

  // ---- gateway --------------------------------------------------------------

  private enqueue(task: () => Promise<void>): Promise<void> {
    this.gw = this.gw.then(task);
    return this.gw;
  }

  private applyConfig(cfg: GatewayConfig): void {
    if (!this.snapshot) return;
    // Mark dirty and persist the snapshot before the PUT: if the tab dies mid-request
    // the next visit still knows what to restore.
    this.dirty = true;
    saveSnapshot(this.snapshot);
    this.scene.intensity = Math.min(1, (cfg.failureRate + cfg.declineRate + cfg.timeoutRate) * 1.5);
    void this.enqueue(async () => {
      try {
        await api.updateGatewayConfig(cfg);
      } catch (e) {
        this.say(`Could not apply gateway config: ${describe(e)}`, 'bad');
      }
    });
  }

  private restore(): Promise<void> {
    return this.enqueue(async () => {
      this.scene.intensity = 0;
      const snap = this.snapshot;
      if (!this.dirty || !snap) return;
      try {
        await restoreGateway(snap);
        this.dirty = false;
        this.say('Gateway config restored to its original values', 'info');
      } catch (e) {
        // The snapshot stays in sessionStorage, so the next visit retries.
        this.say(`Could not restore gateway config: ${describe(e)}`, 'bad');
        this.notify('error', 'Gateway config could not be restored; it will be retried');
      }
      this.publish();
    });
  }

  // ---- powers ---------------------------------------------------------------

  usePower(id: PowerId): void {
    if (this.phase !== 'running') return;
    const r = this.run;
    const now = Date.now();
    if (now < r.cooldownUntil[id]) return;
    if (id === 'slow') {
      r.slowUntil = now + SLOW_MS;
      r.cooldownUntil.slow = now + POWERS.slow.cooldownMs;
      this.say('Slow intake: spawn interval doubled for 10 s', 'info');
    } else if (id === 'failover') {
      r.cooldownUntil.failover = now + POWERS.failover.cooldownMs;
      this.failoverActive = true;
      this.say('Failover: healthy gateway for 8 s', 'good');
      this.applyConfig(HEALTHY);
      this.failoverTimer = setTimeout(() => {
        this.failoverTimer = null;
        this.failoverActive = false;
        if (this.phase !== 'running') return;
        this.say('Failover over, current round config reapplied', 'warn');
        this.applyConfig(ROUNDS[this.run.roundIdx].config);
        this.publish();
      }, FAILOVER_MS);
    } else {
      void this.cancelDoomed();
    }
    this.publish();
  }

  private async cancelDoomed(): Promise<void> {
    const doomed = [...this.coins.values()].filter((c) => c.status === 'PENDING' && c.attempts >= DOOMED_ATTEMPTS);
    if (doomed.length === 0) {
      this.say('No doomed payments', 'info');
      this.publish();
      return;
    }
    this.run.cooldownUntil.cancel = Date.now() + POWERS.cancel.cooldownMs;
    const results = await Promise.allSettled(
      doomed.map((c) =>
        api.updatePaymentStatus(c.id, { status: 'CANCELLED', reason: `Cancelled by on-call: doomed after ${c.attempts} attempts` }),
      ),
    );
    let ok = 0;
    results.forEach((res, i) => {
      const id = `#${shortId(doomed[i].id)}`;
      if (res.status === 'fulfilled') ok++;
      else if (res.reason instanceof ApiError && res.reason.status === 409) this.say(`${id} too late, processor grabbed it`, 'warn');
      else this.say(`${id} cancel failed: ${describe(res.reason)}`, 'bad');
    });
    this.say(`Cancel doomed: ${ok} of ${doomed.length} cancelled`, 'info');
    this.publish();
  }

  // ---- output ---------------------------------------------------------------

  private say(text: string, kind: LogKind): void {
    this.log = [{ id: this.logId++, text, kind }, ...this.log].slice(0, MAX_LOG);
  }

  private publish(): void {
    const r = this.run;
    const now = r.pausedAt ?? Date.now();
    let vault = 0;
    let failed = 0;
    for (const c of this.coins.values()) {
      if (c.status === 'SUCCEEDED') vault++;
      else if (c.status === 'FAILED') failed++;
    }
    const left = (id: PowerId) => Math.max(0, r.cooldownUntil[id] - now);
    this.emit({
      hud: {
        phase: this.phase,
        starting: this.starting,
        demo: r.demo,
        roundIdx: r.roundIdx,
        roundRemainingMs: this.sched?.remainingMs() ?? 0,
        roundMs: this.sched?.durationMs ?? ROUND_MS,
        score: r.score.score,
        streak: r.score.streak,
        multiplier: comboMultiplier(r.score.streak),
        sla: slaRate(r.score),
        breachRemainingMs: breachRemainingMs(r.score, now),
        vault,
        failed,
        retries: r.retries,
        chaos: this.dirty,
        cooldowns: { slow: left('slow'), failover: left('failover'), cancel: left('cancel') },
        report: this.report,
      },
      log: this.log,
    });
  }
}
