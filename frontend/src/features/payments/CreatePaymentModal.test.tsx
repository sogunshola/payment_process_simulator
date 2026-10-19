import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json, renderApp } from '../../test/render';
import { CreatePaymentModal } from './CreatePaymentModal';

type Handler = (body: Record<string, unknown>) => Response | Promise<Response>;
let posts: Record<string, unknown>[];

function stubCreate(handler: Handler) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit = {}) => {
      const body = JSON.parse(String(init.body));
      posts.push(body);
      return handler(body);
    }),
  );
}

beforeEach(() => {
  posts = [];
});
afterEach(() => vi.unstubAllGlobals());

async function fill(amount: string) {
  // user-event refuses an empty string, so only type what there is.
  if (amount) await userEvent.type(screen.getByLabelText('Amount'), amount);
}
const submit = () => userEvent.click(screen.getByRole('button', { name: 'Create payment' }));

describe('CreatePaymentModal', () => {
  it('sends integer minor units, no client reference, and omits an empty description', async () => {
    stubCreate(() => json({ id: 'x', reference: 'inv-1' }, 202));
    const onClose = vi.fn();
    renderApp(<CreatePaymentModal open onClose={onClose} />);
    await fill('19.99');
    await userEvent.selectOptions(screen.getByLabelText('Currency'), 'EUR');
    await submit();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(posts).toEqual([{ amount: 1999, currency: 'EUR' }]);
    expect(await screen.findByText('Payment inv-1 created')).toBeInTheDocument();
  });

  it('validates locally and sends nothing for a bad amount', async () => {
    stubCreate(() => json({}, 202));
    renderApp(<CreatePaymentModal open onClose={() => {}} />);
    await fill('1.234');
    await submit();
    expect(await screen.findByText('At most 2 decimal places')).toBeInTheDocument();
    expect(screen.getByLabelText('Amount')).toHaveAttribute('aria-invalid', 'true');
    expect(posts).toHaveLength(0);
  });

  it('shows backend field errors under the matching inputs and keeps the modal open', async () => {
    stubCreate(() =>
      json(
        {
          message: 'Validation failed',
          details: [
            { field: 'description', message: 'description must be shorter than or equal to 256 characters' },
            { field: 'amount', message: 'amount must be an integer number' },
          ],
        },
        400,
      ),
    );
    const onClose = vi.fn();
    renderApp(<CreatePaymentModal open onClose={onClose} />);
    await fill('5');
    await submit();
    expect(await screen.findByText(/description must be shorter/)).toBeInTheDocument();
    expect(screen.getByLabelText('Description (optional)')).toHaveAccessibleDescription(/must be shorter/);
    expect(screen.getByLabelText('Amount')).toHaveAccessibleDescription(/must be an integer/);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows a general error for a non-field failure (409, 500, network)', async () => {
    stubCreate(() => json({ message: 'The server had a problem' }, 500));
    renderApp(<CreatePaymentModal open onClose={() => {}} />);
    await fill('5');
    await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('The server had a problem');
  });

  it('disables submit while pending so a double click cannot create two payments', async () => {
    let release: (r: Response) => void = () => {};
    stubCreate(() => new Promise<Response>((res) => (release = res)));
    renderApp(<CreatePaymentModal open onClose={() => {}} />);
    await fill('5');
    const button = screen.getByRole('button', { name: 'Create payment' });
    await userEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    await userEvent.click(button);
    await userEvent.type(screen.getByLabelText('Amount'), '{Enter}');
    expect(posts).toHaveLength(1);
    release(json({ id: 'x', reference: 'ref' }, 202));
    await waitFor(() => expect(button).toBeEnabled());
  });
});
