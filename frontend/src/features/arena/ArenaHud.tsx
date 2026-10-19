import { Card } from '../../components/ui/Card';
import type { Hud } from './game';
import { ROUNDS } from './rounds';
import { SLA_DANGER, SLA_TARGET } from './scoring';

function SlaMeter({ sla, breachMs }: { sla: number | null; breachMs: number | null }) {
  const pct = sla === null ? 0 : Math.round(sla * 100);
  const color = sla === null ? 'bg-muted' : sla >= SLA_TARGET ? 'bg-status-succeeded' : sla >= SLA_DANGER ? 'bg-status-pending' : 'bg-status-failed';
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs text-muted">
        <span>SLA (last 20 settled)</span>
        <span className="font-mono text-fg">{sla === null ? 'warming up' : `${pct}%`}</span>
      </div>
      <div
        role="meter"
        aria-label="SLA success rate"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={sla === null ? 'warming up' : `${pct} percent`}
        className="relative mt-1 h-3 overflow-hidden rounded-full border border-line bg-surface"
      >
        {/* Danger zone: below 60% for 10 s ends the run. */}
        <div className="absolute inset-y-0 left-0 bg-status-failed/20" style={{ width: `${SLA_DANGER * 100}%` }} />
        <div className={`absolute inset-y-0 left-0 transition-[width] duration-500 ${color}`} style={{ width: `${pct}%` }} />
        <div className="absolute inset-y-0 w-0.5 bg-fg" style={{ left: `${SLA_TARGET * 100}%` }} title="90% target" />
      </div>
      <p className="mt-1 h-4 text-xs text-status-failed">
        {breachMs !== null && `SLA below 60%: run ends in ${Math.ceil(breachMs / 1000)}s unless it recovers`}
      </p>
    </div>
  );
}

export function ArenaHud({ hud }: { hud: Hud }) {
  const round = hud.roundIdx >= 0 ? ROUNDS[hud.roundIdx] : null;
  const progress = round && hud.roundMs > 0 ? 1 - hud.roundRemainingMs / hud.roundMs : 0;
  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        {ROUNDS.map((r, i) => (
          <span
            key={r.name}
            aria-current={i === hud.roundIdx ? 'step' : undefined}
            className={`rounded-full border px-2.5 py-1 text-xs ${i === hud.roundIdx ? 'border-accent text-accent' : 'border-line text-muted'}`}
          >
            {i + 1}. {r.name}
          </span>
        ))}
        {hud.demo && hud.phase !== 'idle' && (
          <span className="rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-accent-ink">DEMO</span>
        )}
      </div>
      <div>
        <div className="flex justify-between text-xs text-muted">
          <span>{round ? `${round.name}: ${round.description}` : 'Waiting to start'}</span>
          <span className="font-mono">{round ? `${Math.ceil(hud.roundRemainingMs / 1000)}s left` : ''}</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface">
          <div className="h-full bg-accent transition-[width] duration-1000 ease-linear" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Score" value={String(hud.score)} />
        <Stat label="Combo" value={`x${hud.multiplier}`} sub={`streak ${hud.streak}`} />
        <Stat label="Vault" value={String(hud.vault)} />
        <Stat label="Failed" value={String(hud.failed)} />
      </div>
      <SlaMeter sla={hud.sla} breachMs={hud.breachRemainingMs} />
    </Card>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="font-mono text-2xl font-semibold">{value}</div>
      {sub && <div className="font-mono text-xs text-muted">{sub}</div>}
    </div>
  );
}
