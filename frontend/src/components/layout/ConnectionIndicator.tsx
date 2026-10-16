import { ApiError } from '../../lib/api/api-error';
import { useHealth, usePaymentStats } from '../../lib/api/hooks';

type State = 'checking' | 'connected' | 'unauthorized' | 'offline';

const view: Record<State, { label: string; dot: string }> = {
  checking: { label: 'Checking', dot: 'bg-muted' },
  connected: { label: 'Connected', dot: 'bg-accent' },
  unauthorized: { label: 'Unauthorized', dot: 'bg-status-pending' },
  offline: { label: 'Offline', dot: 'bg-status-failed' },
};

export function ConnectionIndicator() {
  const health = useHealth();
  // Stats shares its query with the Console, so this adds no extra requests.
  // /health is public, so only an authenticated call can reveal a bad key.
  const stats = usePaymentStats();

  let state: State = 'checking';
  if (health.isError) state = 'offline';
  else if (stats.error instanceof ApiError && stats.error.status === 401) state = 'unauthorized';
  else if (stats.isError) state = 'offline';
  else if (health.isSuccess && stats.isSuccess) state = 'connected';

  const v = view[state];
  return (
    <div role="status" aria-label={`API connection: ${v.label}`} className="flex items-center gap-2 text-xs text-muted">
      <span aria-hidden="true" className={`size-2 rounded-full ${v.dot}`} />
      <span>{v.label}</span>
    </div>
  );
}
