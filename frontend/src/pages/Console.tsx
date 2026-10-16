import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { StatusBadge } from '../components/ui/StatusBadge';
import { usePaymentStats } from '../lib/api/hooks';
import { PAYMENT_STATUSES } from '../lib/api/types';

export function Console() {
  const stats = usePaymentStats();
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Console</h1>
        <p className="mt-2 max-w-prose text-muted">Live payment counts by status. Payment list and creation arrive next.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {PAYMENT_STATUSES.map((s) => (
          <Card key={s} className="flex flex-col gap-3 p-4">
            <StatusBadge status={s} />
            {stats.data ? (
              <p className="font-mono text-2xl">{stats.data[s]}</p>
            ) : stats.isError ? (
              <p className="font-mono text-2xl text-muted">-</p>
            ) : (
              <Skeleton className="h-8 w-16" />
            )}
          </Card>
        ))}
      </div>

      {stats.isError && (
        <p role="alert" className="text-sm text-status-failed">
          Could not load stats: {stats.error.message}
        </p>
      )}

      <EmptyState title="No payments to show yet" description="Created payments will appear here with live status updates." />
    </div>
  );
}
