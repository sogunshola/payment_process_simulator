import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

let shouldThrow = true;
function Bomb() {
  if (shouldThrow) throw new Error('secret internal detail at /src/internal.ts:42');
  return <p>Recovered content</p>;
}

let errorSpy: ReturnType<typeof vi.spyOn>;
// jsdom also reports the render error as an uncaught window error; swallow it so the run stays readable.
const swallow = (e: ErrorEvent) => e.preventDefault();
beforeEach(() => {
  shouldThrow = true;
  window.addEventListener('error', swallow);
  // React and the boundary both log the caught error; keep the test output clean.
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
  window.removeEventListener('error', swallow);
});

const setup = () =>
  render(
    <MemoryRouter>
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    </MemoryRouter>,
  );

describe('ErrorBoundary', () => {
  it('shows a plain-language recovery screen and hides the error details', () => {
    setup();
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Console' })).toHaveAttribute('href', '/');
    expect(document.body).not.toHaveTextContent('secret internal detail');
    expect(document.body).not.toHaveTextContent('internal.ts');
  });

  it('logs the error to the console', () => {
    setup();
    const logged = errorSpy.mock.calls.some((args: unknown[]) => args.some((a: unknown) => a instanceof Error && a.message.includes('secret internal detail')));
    expect(logged).toBe(true);
  });

  it('"Try again" renders the children again once the cause is gone', async () => {
    setup();
    shouldThrow = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('Recovered content')).toBeInTheDocument();
  });

  it('"Try again" shows the recovery screen again if the problem persists', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
  });
});
