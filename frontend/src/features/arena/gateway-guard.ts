import { api } from '../../lib/api/client';
import type { GatewayConfig } from '../../lib/api/types';

// The gateway config is global, in-memory state on the backend. The Arena changes it,
// so it must put it back however the player leaves. The snapshot is also kept in
// sessionStorage so a crashed tab's leftovers are repaired on the next visit.
const KEY = 'arena:gateway-snapshot';

export function saveSnapshot(cfg: GatewayConfig): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    // memory copy in the hook still works for this page life
  }
}

export function loadSnapshot(): GatewayConfig | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<GatewayConfig>;
    const keys: (keyof GatewayConfig)[] = ['minLatencyMs', 'maxLatencyMs', 'failureRate', 'declineRate', 'timeoutRate'];
    return keys.every((k) => typeof p[k] === 'number') ? (p as GatewayConfig) : null;
  } catch {
    return null;
  }
}

export function clearSnapshot(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // nothing to do
  }
}

/** Restore and, only once the server confirmed it, forget the snapshot. Throws on failure. */
export async function restoreGateway(snapshot: GatewayConfig): Promise<void> {
  await api.updateGatewayConfig(snapshot);
  clearSnapshot();
}

/**
 * Best effort on page unload. keepalive lets the request outlive the page;
 * sendBeacon cannot do PUT or custom headers. The result is ignored because the
 * page is going away; if this is lost, the stale snapshot is restored next visit.
 */
export function restoreOnUnload(snapshot: GatewayConfig): void {
  api.updateGatewayConfig(snapshot, { keepalive: true }).catch(() => undefined);
}
