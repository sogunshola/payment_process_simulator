import { Card } from '../../components/ui/Card';
import { Skeleton } from '../../components/ui/Skeleton';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { usePayments } from '../../lib/api/hooks';
import { formatMoney } from '../../lib/money';

const PARAMS = { limit: 10 };

// One markup for every width: stacked card on a phone, a single grid row from md up.
export function RecentPayments() {
  const payments = usePayments(PARAMS);

  return (
    <section aria-labelledby="recent-payments" className="flex flex-col gap-3">
      <h2 id="recent-payments" className="text-lg font-semibold">
        Recent payments
      </h2>
      {payments.isError ? (
        <p role="alert" className="text-sm text-status-failed">
          Could not load payments: {payments.error.message}
        </p>
      ) : !payments.data ? (
        <div aria-hidden="true" className="flex flex-col gap-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : payments.data.data.length === 0 ? (
        <p className="text-sm text-muted">No payments yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {payments.data.data.map((p) => (
            <li key={p.id}>
              <Card className="grid grid-cols-2 items-center gap-x-4 gap-y-2 p-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_9rem_5rem]">
                <span className="col-span-2 min-w-0 truncate font-medium md:col-span-1" title={p.reference}>
                  {p.reference}
                </span>
                <span className="font-mono text-xs text-muted" title={p.id}>
                  {p.id.slice(0, 8)}
                </span>
                <span className="justify-self-end font-mono text-sm md:justify-self-start">{formatMoney(p.amount, p.currency)}</span>
                <span className="justify-self-start">
                  <StatusBadge status={p.status} />
                </span>
                <span className="justify-self-end text-xs text-muted md:justify-self-start">
                  {p.attempts} {p.attempts === 1 ? 'attempt' : 'attempts'}
                </span>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
