import { ApiError } from '../../lib/api/api-error';
import { useHealth, usePaymentStats } from '../../lib/api/hooks';
import { Button } from '../ui/Button';

/**
 * Explains what to do when the API is unreachable (network error or 5xx from the
 * backend or the dev proxy). The element mounts only while the problem exists, so
 * role="alert" is announced once on appearance, not on every 5 s health poll.
 * A rejected key (401) gets a quieter hint: /health is public, so only the stats
 * query can reveal it.
 */
export function ConnectionBanner({ onOpenSettings }: { onOpenSettings: () => void }) {
  const health = useHealth();
  const stats = usePaymentStats();

  const unreachable = health.error instanceof ApiError && (health.error.status === 0 || health.error.status >= 500);
  const badKey = !unreachable && stats.error instanceof ApiError && stats.error.status === 401;
  if (!unreachable && !badKey) return null;

  return (
    <div
      role={unreachable ? 'alert' : 'status'}
      className={`border-b px-4 py-3 text-sm sm:px-gutter ${
        unreachable ? 'border-status-failed/40 bg-status-failed/10' : 'border-status-pending/40 bg-status-pending/10'
      }`}
    >
      <div className="mx-auto flex max-w-page flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 basis-64">
          {unreachable ? (
            <>
              <strong className="font-semibold">Cannot reach the backend.</strong> Start the backend on port 3000 or check the
              API URL in Settings.
            </>
          ) : (
            <>
              <strong className="font-semibold">The API key was rejected.</strong> Open Settings and paste the backend API key.
            </>
          )}
        </p>
        <Button variant="secondary" size="sm" onClick={onOpenSettings}>
          Settings
        </Button>
      </div>
    </div>
  );
}
