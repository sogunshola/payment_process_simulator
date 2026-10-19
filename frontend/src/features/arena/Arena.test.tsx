import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/ui/Toast';
import { Arena } from '../../pages/Arena';
import type { GatewayConfig } from '../../lib/api/types';

const SNAPSHOT: GatewayConfig = { minLatencyMs: 10, maxLatencyMs: 20, failureRate: 0.01, declineRate: 0, timeoutRate: 0 };
const SNAP_KEY = 'arena:gateway-snapshot';

type Call = { method: string; path: string; body: unknown; keepalive?: boolean };
let calls: Call[];
let failGet = false;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  calls = [];
  failGet = false;
  sessionStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = String(url).replace(/^\/api/, '');
      const method = init.method ?? 'GET';
      calls.push({ method, path, body: init.body ? JSON.parse(String(init.body)) : undefined, keepalive: init.keepalive });
      if (path === '/gateway/config' && method === 'GET') return failGet ? json({ message: 'down' }, 500) : json(SNAPSHOT);
      if (path === '/gateway/config') return json(JSON.parse(String(init.body)));
      if (path.startsWith('/payments?')) return json({ data: [], page: 1, limit: 100, total: 0 });
      if (path === '/payments' && method === 'POST') {
        return json({ id: crypto.randomUUID(), amount: 1000, currency: 'USD', status: 'PENDING', attempts: 0, failureReason: null }, 201);
      }
      return json({}, 404);
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

const puts = () => calls.filter((c) => c.method === 'PUT' && c.path === '/gateway/config');
const renderArena = () =>
  render(
    <ToastProvider>
      <Arena />
    </ToastProvider>,
  );

async function startRun() {
  await userEvent.click(screen.getByRole('button', { name: 'Start' }));
  // GET snapshot, then the round 1 config is PUT.
  await waitFor(() => expect(puts()).toHaveLength(1));
  expect(calls.find((c) => c.method === 'GET')?.path).toBe('/gateway/config');
  expect(puts()[0].body).toMatchObject({ failureRate: 0.05, maxLatencyMs: 2500 });
}

describe('Arena gateway guard', () => {
  it('restores the snapshot when the route is left', async () => {
    const { unmount } = renderArena();
    await startRun();
    unmount();
    await waitFor(() => expect(puts()).toHaveLength(2));
    expect(puts()[1].body).toEqual(SNAPSHOT);
    expect(sessionStorage.getItem(SNAP_KEY)).toBeNull();
  });

  it('sends a keepalive PUT with the snapshot on pagehide', async () => {
    renderArena();
    await startRun();
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    await waitFor(() => expect(puts()).toHaveLength(2));
    expect(puts()[1]).toMatchObject({ keepalive: true, body: SNAPSHOT });
  });

  it('restores a stale snapshot left in sessionStorage on mount', async () => {
    sessionStorage.setItem(SNAP_KEY, JSON.stringify(SNAPSHOT));
    renderArena();
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].body).toEqual(SNAPSHOT);
    await waitFor(() => expect(sessionStorage.getItem(SNAP_KEY)).toBeNull());
    expect(await screen.findByText(/left by an earlier session/)).toBeInTheDocument();
  });

  it('does not start, and changes nothing, when the snapshot GET fails', async () => {
    failGet = true;
    renderArena();
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(screen.getByText(/Cannot start/, { selector: 'li' })).toBeInTheDocument());
    expect(puts()).toHaveLength(0);
    expect(screen.queryByText(/Chaos active/)).not.toBeInTheDocument();
  });

  it('shows the chaos banner while a run is active and restores on reset', async () => {
    renderArena();
    await startRun();
    expect(await screen.findByText(/Chaos active/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(puts()).toHaveLength(2));
    expect(puts()[1].body).toEqual(SNAPSHOT);
    await waitFor(() => expect(screen.queryByText(/Chaos active/)).not.toBeInTheDocument());
  });
});
