import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, renderApp } from '../../test/render';
import { ConnectionBanner } from './ConnectionBanner';

afterEach(() => vi.unstubAllGlobals());

function stubApi(handler: (path: string) => Response | Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => handler(String(url).replace(/^\/api/, ''))),
  );
}

describe('ConnectionBanner', () => {
  it('shows the unreachable banner, with what to do, on a network error (status 0)', async () => {
    stubApi(() => {
      throw new TypeError('Failed to fetch');
    });
    const onOpen = vi.fn();
    renderApp(<ConnectionBanner onOpenSettings={onOpen} />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Start the backend on port 3000');
    expect(alert).toHaveTextContent('API URL in Settings');
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('shows it on a 502 from the dev proxy (non-JSON body)', async () => {
    stubApi(() => new Response('<html>Bad Gateway</html>', { status: 502 }));
    renderApp(<ConnectionBanner onOpenSettings={() => {}} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach the backend');
  });

  it('shows nothing while the backend is healthy', async () => {
    stubApi((path) => (path === '/health' ? json({ status: 'ok' }) : json({ total: 0 })));
    renderApp(<ConnectionBanner onOpenSettings={() => {}} />);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/Cannot reach|API key was rejected/)).toBeNull();
  });

  it('does not show the unreachable alert for a 401; it shows a quiet key hint instead', async () => {
    stubApi((path) => (path === '/health' ? json({ status: 'ok' }) : json({ message: 'nope' }, 401)));
    renderApp(<ConnectionBanner onOpenSettings={() => {}} />);
    expect(await screen.findByText(/API key was rejected/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.body).not.toHaveTextContent('Start the backend');
  });
});
