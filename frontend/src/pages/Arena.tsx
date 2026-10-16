import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';

export function Arena() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Chaos Arena</h1>
        <p className="mt-2 max-w-prose text-muted">
          Tune the simulated gateway's latency and failure rates, then watch how retries behave.
        </p>
      </div>
      <Card className="flex flex-col gap-4">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </Card>
      <EmptyState title="No experiment running" description="Gateway controls and a payment burst launcher will live here." />
    </div>
  );
}
