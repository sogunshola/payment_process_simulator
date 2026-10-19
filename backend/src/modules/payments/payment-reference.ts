import { randomBytes } from 'node:crypto';

// Crockford base32: no I, L, O, U, so references are easy to read out loud.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LENGTH = 12; // 12 chars * 5 bits = 60 bits

export const REFERENCE_PATTERN = /^PAY-[0-9A-HJKMNP-TV-Z]{12}$/;

/**
 * Randomness alone is NOT relied on for uniqueness: the unique index on
 * payments.reference is the real guarantee, and the service retries on a collision.
 */
export function generateReference(): string {
  const bytes = randomBytes(LENGTH);
  // 256 is a multiple of 32, so `% 32` is unbiased.
  let out = 'PAY-';
  for (const b of bytes) out += ALPHABET[b % 32];
  return out;
}
