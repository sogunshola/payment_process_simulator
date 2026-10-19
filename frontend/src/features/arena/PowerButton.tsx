import { useId } from 'react';
import { Button } from '../../components/ui/Button';

interface Props {
  label: string;
  hint: string;
  cooldownMs: number;
  remainingMs: number;
  enabled: boolean;
  onUse: () => void;
}

export function PowerButton({ label, hint, cooldownMs, remainingMs, enabled, onUse }: Props) {
  const hintId = useId();
  const cooling = remainingMs > 0;
  const seconds = Math.ceil(remainingMs / 1000);
  const blocked = !enabled || cooling;
  // The cooldown must be in the accessible name: the visible "12s" alone is not a clear state for a screen reader.
  const state = !enabled ? 'available during a run' : cooling ? `cooling down ${seconds} ${seconds === 1 ? 'second' : 'seconds'}` : 'ready';
  return (
    <div className="flex flex-col gap-1">
      {/* aria-disabled, not disabled: a disabled button leaves the tab order, so a keyboard user could never discover its cooldown. */}
      <Button
        variant="secondary"
        aria-disabled={blocked || undefined}
        aria-label={`${label}, ${state}`}
        aria-describedby={hintId}
        onClick={() => {
          if (!blocked) onUse();
        }}
        className="relative w-full justify-between overflow-hidden"
      >
        <span aria-hidden="true" className="relative z-10">{label}</span>
        <span aria-hidden="true" className="relative z-10 font-mono text-xs text-muted">{cooling ? `${seconds}s` : 'ready'}</span>
        {/* Drains left to right as the cooldown runs out; updated once per second with the HUD. */}
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 bg-accent/20 transition-[width] duration-1000 ease-linear"
          style={{ width: `${cooling ? (remainingMs / cooldownMs) * 100 : 0}%` }}
        />
      </Button>
      <span id={hintId} className="px-1 text-xs text-muted">{hint}</span>
    </div>
  );
}
