import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Modal } from './Modal';

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      <button>Other page control</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Demo dialog">
        <input aria-label="First" />
        <button>Middle</button>
        <button onClick={() => setOpen(false)}>Last</button>
      </Modal>
    </>
  );
}

describe('Modal keyboard behaviour', () => {
  it('moves focus in, traps Tab and Shift+Tab, closes on Escape and returns focus to the opener', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    await user.keyboard('{Enter}');

    const dialog = await screen.findByRole('dialog', { name: 'Demo dialog' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByLabelText('First')).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Middle' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus();
    // Wraps to the first control instead of escaping to the page behind.
    await user.tab();
    expect(screen.getByLabelText('First')).toHaveFocus();
    // Shift+Tab from the first wraps to the last.
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(opener).toHaveFocus();
  });

  it('pulls focus back in when it was outside the dialog and Tab is pressed', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await screen.findByRole('dialog');
    // Simulates a click on the backdrop, which leaves focus on the page.
    screen.getByRole('button', { name: 'Other page control' }).focus();
    await user.tab();
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
  });

  it('falls back to the main landmark when the opener was removed while open', async () => {
    const user = userEvent.setup();
    function Vanishing() {
      const [open, setOpen] = useState(false);
      const [gone, setGone] = useState(false);
      return (
        <>
          <main id="main-content" tabIndex={-1}>
            {!gone && <button onClick={() => setOpen(true)}>Open</button>}
          </main>
          <Modal open={open} onClose={() => setOpen(false)} title="Vanishing">
            <button
              onClick={() => {
                setGone(true);
                setOpen(false);
              }}
            >
              Done
            </button>
          </Modal>
        </>
      );
    }
    render(<Vanishing />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(await screen.findByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.getElementById('main-content')).toHaveFocus();
  });
});
