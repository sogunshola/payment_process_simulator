import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Payment } from '../lib/api/types';
import { json, renderApp } from '../test/render';
import { Console } from './Console';

afterEach(() => vi.unstubAllGlobals());

const stats = (total: number) => ({ PENDING: 0, PROCESSING: 0, SUCCEEDED: total, FAILED: 0, CANCELLED: 0, total });
const payment = (over: Partial<Payment> = {}): Payment => ({
  id: '3f2b1c9e-0000-4000-8000-000000000001',
  reference: 'order-1',
  amount: 123456,
  currency: 'USD',
  description: null,
  customerEmail: null,
  status: 'SUCCEEDED',
  failureReason: null,
  attempts: 2,
  nextAttemptAt: null,
  idempotencyKey: null,
  version: 3,
  history: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

function stubApi(opts: { total: number; payments?: Payment[]; statsStatus?: number }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = String(url).replace(/^\/api/, '');
      if (path === '/payments/stats') {
        return opts.statsStatus ? json({ message: 'boom' }, opts.statsStatus) : json(stats(opts.total));
      }
      if (path.startsWith('/payments?')) {
        const data = opts.payments ?? [];
        return json({ data, page: 1, limit: 10, total: data.length });
      }
      return json({}, 404);
    }),
  );
}

describe('Console', () => {
  it('shows the first-run empty state when there are no payments, and its button opens the modal', async () => {
    stubApi({ total: 0 });
    renderApp(<Console />);
    const create = await screen.findByRole('button', { name: 'Create your first payment' });
    expect(screen.getByRole('link', { name: 'Chaos Arena' })).toHaveAttribute('href', '/arena');
    // The header button is replaced by the empty-state action on first run.
    expect(screen.queryByRole('button', { name: 'New payment' })).toBeNull();

    await userEvent.click(create);
    expect(await screen.findByRole('dialog', { name: 'New payment' })).toBeInTheDocument();
  });

  it('shows the header button and the recent list, not the empty state, when payments exist', async () => {
    stubApi({ total: 1, payments: [payment()] });
    renderApp(<Console />);
    expect(await screen.findByRole('button', { name: 'New payment' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create your first payment' })).toBeNull();

    const list = await screen.findByRole('list');
    const row = within(list);
    expect(row.getByText('order-1')).toBeInTheDocument();
    expect(row.getByText('3f2b1c9e')).toBeInTheDocument();
    expect(row.getByText('$1,234.56')).toBeInTheDocument();
    expect(row.getByText('Succeeded')).toBeInTheDocument();
    expect(row.getByText('2 attempts')).toBeInTheDocument();
  });

  it('does not claim "first run" when stats failed to load', async () => {
    stubApi({ total: 0, statsStatus: 500 });
    renderApp(<Console />);
    expect(await screen.findByText(/Could not load stats/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create your first payment' })).toBeNull();
  });
});
