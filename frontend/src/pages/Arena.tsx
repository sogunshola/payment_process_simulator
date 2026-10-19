import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { ArenaCanvas } from '../features/arena/ArenaCanvas';
import { ArenaHud } from '../features/arena/ArenaHud';
import { ChaosBanner } from '../features/arena/ChaosBanner';
import { EngineerLog } from '../features/arena/EngineerLog';
import { POWERS, type PowerId } from '../features/arena/game';
import { IncidentReport } from '../features/arena/IncidentReport';
import { PowerButton } from '../features/arena/PowerButton';
import { useArenaGame } from '../features/arena/useArenaGame';

export function Arena() {
  const { game, hud, log } = useArenaGame();
  const running = hud.phase === 'running';
  const active = running || hud.phase === 'paused';

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Chaos Arena</h1>
        <p className="mt-2 max-w-prose text-muted">
          You are the on-call engineer. Real payments flow through the real simulated gateway while its failure rates are
          changed round by round. The gateway config is global to the backend, so it affects every client until it is restored.
        </p>
      </div>

      <ChaosBanner active={hud.chaos} />
      <ArenaHud hud={hud} />

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <ArenaCanvas coins={game.coins} scene={game.scene} />
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-2 p-4">
            <div className="flex flex-wrap gap-2">
              {!active && (
                <Button loading={hud.starting} onClick={() => void game.start(false)}>
                  Start
                </Button>
              )}
              {running && !hud.demo && (
                <Button variant="secondary" onClick={() => game.pause()}>
                  Pause
                </Button>
              )}
              {hud.phase === 'paused' && <Button onClick={() => game.resume()}>Resume</Button>}
              <Button variant="secondary" onClick={() => game.reset()}>
                Reset
              </Button>
              {!active && (
                <Button variant="ghost" disabled={hud.starting} onClick={() => void game.start(true)}>
                  Auto-demo
                </Button>
              )}
            </div>
          </Card>
          <Card className="flex flex-col gap-3 p-4">
            <h2 className="text-sm font-semibold">Powers</h2>
            {(Object.keys(POWERS) as PowerId[]).map((id) => (
              <PowerButton
                key={id}
                label={POWERS[id].label}
                hint={POWERS[id].hint}
                cooldownMs={POWERS[id].cooldownMs}
                remainingMs={hud.cooldowns[id]}
                enabled={running}
                onUse={() => game.usePower(id)}
              />
            ))}
          </Card>
        </div>
      </div>

      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold">Engineer log</h2>
        <EngineerLog entries={log} />
      </Card>

      <IncidentReport
        report={hud.report}
        onClose={() => game.closeReport()}
        onPlayAgain={() => {
          game.closeReport();
          void game.start(false);
        }}
      />
    </div>
  );
}
