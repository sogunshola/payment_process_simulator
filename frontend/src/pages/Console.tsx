import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { StatusBadge } from '../components/ui/StatusBadge';
import { CreatePaymentModal } from '../features/payments/CreatePaymentModal';
import { RecentPayments } from '../features/payments/RecentPayments';
import { usePaymentStats } from '../lib/api/hooks';
import { PAYMENT_STATUSES } from '../lib/api/types';

export function Console() {
  const stats = usePaymentStats();
  const [creating, setCreating] = useState(false);
  // First run means the backend answered and holds no payments; an error or loading state is not "empty".
  const firstRun = stats.data !== undefined && stats.data.total === 0;
  const hasPayments = stats.data !== undefined && stats.data.total > 0;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Console</h1>
          <p className="mt-2 max-w-prose text-muted">Live payment counts by status and the latest payments.</p>
        </div>
        {!firstRun && <Button onClick={() => setCreating(true)}>New payment</Button>}
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

      {firstRun && (
        <EmptyState
          title="No payments yet"
          description="Create a payment and watch it move through the background processor."
          action={
            <div className="flex flex-col items-start gap-3">
              <Button size="lg" onClick={() => setCreating(true)}>
                Create your first payment
              </Button>
              <p className="max-w-prose text-sm text-muted">
                Or open the{' '}
                <Link to="/arena" className="text-accent underline underline-offset-4">
                  Chaos Arena
                </Link>{' '}
                to keep a live payment pipeline alive while the gateway misbehaves.
              </p>
            </div>
          }
        />
      )}
      {hasPayments && <RecentPayments />}

      <CreatePaymentModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
