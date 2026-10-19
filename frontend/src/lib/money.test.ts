import { describe, expect, it } from 'vitest';
import { formatMoney, parseAmountToMinor } from './money';

const minor = (s: string) => {
  const r = parseAmountToMinor(s);
  if (!r.ok) throw new Error(`expected ${s} to parse: ${r.error}`);
  return r.minor;
};

describe('parseAmountToMinor', () => {
  it.each([
    ['50', 5000],
    ['50.00', 5000],
    ['50.5', 5050],
    ['0.01', 1],
    ['0.10', 10],
    ['  12.34  ', 1234],
    ['007.07', 707],
    ['10000000', 1_000_000_000],
    ['50.', 5000],
  ])('accepts %j as %i minor units', (input, expected) => {
    expect(minor(input)).toBe(expected);
  });

  it('is exact where float math is not: 1.15, 19.99 and 8.2', () => {
    // 1.15 * 100 === 114.99999999999999 in IEEE 754.
    expect(minor('1.15')).toBe(115);
    expect(minor('19.99')).toBe(1999);
    expect(minor('8.2')).toBe(820);
  });

  it.each(['50.001', '0.005', '1.234'])('rejects more than 2 decimals: %j', (input) => {
    const r = parseAmountToMinor(input);
    expect(r).toEqual({ ok: false, error: expect.stringContaining('2 decimal') });
  });

  it.each(['0', '0.00', '0.0'])('rejects zero: %j', (input) => {
    expect(parseAmountToMinor(input).ok).toBe(false);
  });

  it.each(['-5', '-0.01', '+5'])('rejects a sign: %j', (input) => {
    expect(parseAmountToMinor(input).ok).toBe(false);
  });

  it.each(['', '   ', 'abc', '5a', '1e3', '0x10', '.5', '.', '1.2.3', '5,00', 'NaN', 'Infinity'])(
    'rejects non-numeric input: %j',
    (input) => {
      expect(parseAmountToMinor(input).ok).toBe(false);
    },
  );

  it('rejects thousands separators on purpose, because "1,000.50" is ambiguous across locales', () => {
    expect(parseAmountToMinor('1,000.50').ok).toBe(false);
  });

  it.each(['10000000.01', '99999999999999999999', '9007199254740993'])('rejects values over the backend limit: %j', (input) => {
    const r = parseAmountToMinor(input);
    expect(r).toEqual({ ok: false, error: expect.stringContaining('too large') });
  });
});

describe('formatMoney', () => {
  it('formats minor units with the currency', () => {
    expect(formatMoney(5000, 'USD')).toBe('$50.00');
    expect(formatMoney(1, 'EUR')).toBe('€0.01');
    expect(formatMoney(123456789, 'GBP')).toBe('£1,234,567.89');
  });
});
