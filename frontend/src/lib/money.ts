import type { Currency } from './api/types';

/** Backend limit for `amount` (minor units), see CreatePaymentDto. */
export const MAX_MINOR = 1_000_000_000;

export type AmountResult = { ok: true; minor: number } | { ok: false; error: string };

/**
 * Converts what a person types ("50", "50.5", "50.00") into integer minor units
 * by working on the string, never by multiplying a float: 1.15 * 100 is
 * 114.99999999999999, and rounding hides that only for the inputs you happen to
 * test. Every supported currency has 2 decimals, so the scale is a constant 100.
 *
 * Thousands separators ("1,000.50") are rejected on purpose: "1,50" means one
 * euro fifty in some locales and fifteen hundred in others, so guessing could
 * charge the wrong amount. Showing an error is cheaper than a wrong payment.
 */
export function parseAmountToMinor(input: string): AmountResult {
  const text = input.trim();
  if (text === '') return { ok: false, error: 'Enter an amount' };
  if (!/^\d+(\.\d*)?$/.test(text)) {
    return { ok: false, error: 'Use digits and one decimal point only, for example 50.00' };
  }
  const [whole, frac = ''] = text.split('.');
  if (frac.length > 2) return { ok: false, error: 'At most 2 decimal places' };
  // A long digit string loses precision as a Number, but it is far above the
  // limit anyway, so the range check below rejects it either way.
  const minor = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(minor) || minor > MAX_MINOR) {
    return { ok: false, error: `Amount is too large (maximum ${MAX_MINOR / 100})` };
  }
  if (minor < 1) return { ok: false, error: 'Amount must be greater than 0' };
  return { ok: true, minor };
}

export function formatMoney(minor: number, currency: Currency): string {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).format(minor / 100);
}
