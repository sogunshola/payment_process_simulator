import type { PaymentStatus } from '../../lib/api/types';

const styles: Record<PaymentStatus, { label: string; dot: string; text: string }> = {
  PENDING: { label: 'Pending', dot: 'bg-status-pending', text: 'text-status-pending' },
  PROCESSING: { label: 'Processing', dot: 'bg-status-processing', text: 'text-status-processing' },
  SUCCEEDED: { label: 'Succeeded', dot: 'bg-status-succeeded', text: 'text-status-succeeded' },
  FAILED: { label: 'Failed', dot: 'bg-status-failed', text: 'text-status-failed' },
  CANCELLED: { label: 'Cancelled', dot: 'bg-status-cancelled', text: 'text-status-cancelled' },
};

export function StatusBadge({ status }: { status: PaymentStatus }) {
  const s = styles[status];
  const pulsing = status === 'PROCESSING';
  return (
    <span
      data-status={status}
      data-pulse={pulsing ? 'true' : undefined}
      className={`inline-flex items-center gap-2 rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-medium ${s.text}`}
    >
      {/* The dot is decorative: the label carries the meaning, so colour is never the only signal. */}
      <span aria-hidden="true" className={`size-2 rounded-full ${s.dot} ${pulsing ? 'animate-soft-pulse' : ''}`} />
      <span>{s.label}</span>
    </span>
  );
}
