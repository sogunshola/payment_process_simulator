import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PAYMENT_STATUSES, type PaymentStatus } from '../../lib/api/types';
import { StatusBadge } from './StatusBadge';

const labels: Record<PaymentStatus, string> = {
  PENDING: 'Pending',
  PROCESSING: 'Processing',
  SUCCEEDED: 'Succeeded',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

describe('StatusBadge', () => {
  it.each(PAYMENT_STATUSES)('renders the label for %s as accessible text', (status) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(labels[status])).toBeVisible();
  });

  it('marks only PROCESSING as pulsing', () => {
    const { container } = render(
      <>
        {PAYMENT_STATUSES.map((s) => (
          <StatusBadge key={s} status={s} />
        ))}
      </>,
    );
    const pulsing = Array.from(container.querySelectorAll('[data-pulse="true"]'));
    expect(pulsing).toHaveLength(1);
    expect(pulsing[0]).toHaveAttribute('data-status', 'PROCESSING');
  });

  it('hides the decorative dot from assistive tech', () => {
    const { container } = render(<StatusBadge status="FAILED" />);
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
