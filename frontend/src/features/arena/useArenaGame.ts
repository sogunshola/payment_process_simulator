import { useEffect, useState } from 'react';
import { useToast } from '../../components/ui/Toast';
import { ArenaGame, type Snapshot } from './game';
import { ROUND_MS } from './rounds';

const INITIAL: Snapshot = {
  hud: {
    phase: 'idle',
    starting: false,
    demo: false,
    roundIdx: -1,
    roundRemainingMs: 0,
    roundMs: ROUND_MS,
    score: 0,
    streak: 0,
    multiplier: 1,
    sla: null,
    breachRemainingMs: null,
    vault: 0,
    failed: 0,
    retries: 0,
    chaos: false,
    cooldowns: { slow: 0, failover: 0, cancel: 0 },
    report: null,
  },
  log: [],
};

export function useArenaGame() {
  const toast = useToast();
  const [snap, setSnap] = useState<Snapshot>(INITIAL);
  // Constructed once; the constructor has no side effects, so StrictMode's double init is harmless.
  const [game] = useState(() => new ArenaGame(setSnap, (kind, msg) => toast.show(kind, msg)));

  useEffect(() => {
    game.restoreStale();
    window.addEventListener('pagehide', game.onPageHide);
    return () => {
      window.removeEventListener('pagehide', game.onPageHide);
      // Leaving the route must put the backend gateway back.
      game.dispose();
    };
  }, [game]);

  return { game, hud: snap.hud, log: snap.log };
}
