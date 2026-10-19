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
  const cooling = remainingMs > 0;
  return (
    <div className="flex flex-col gap-1">
      <Button variant="secondary" disabled={!enabled || cooling} onClick={onUse} className="relative w-full justify-between overflow-hidden">
        <span className="relative z-10">{label}</span>
        <span className="relative z-10 font-mono text-xs text-muted">{cooling ? `${Math.ceil(remainingMs / 1000)}s` : 'ready'}</span>
        {/* Drains left to right as the cooldown runs out; updated once per second with the HUD. */}
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 bg-accent/20 transition-[width] duration-1000 ease-linear"
          style={{ width: `${cooling ? (remainingMs / cooldownMs) * 100 : 0}%` }}
        />
      </Button>
      <span className="px-1 text-xs text-muted">{hint}</span>
    </div>
  );
}
