import { useEffect, useRef } from 'react';

/**
 * Shared by Modal and Drawer: moves focus into the dialog on open, closes on
 * Escape, keeps Tab inside, and restores focus to the opener on close.
 */
export function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  // Held in a ref so a new onClose identity each render does not re-run the effect and steal focus.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    (focusable()[0] ?? ref.current)?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      // Focus can end up outside after a click on the backdrop; pull it back in.
      if (!ref.current?.contains(document.activeElement) || document.activeElement === ref.current) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      // The opener can be gone (e.g. the "Create your first payment" button vanishes once a payment exists).
      if (opener?.isConnected) opener.focus();
      else document.getElementById('main-content')?.focus();
    };
  }, [open]);

  return ref;
}
