import { generateReference, REFERENCE_PATTERN } from './payment-reference';

describe('generateReference', () => {
  it('matches the PAY- + 12 Crockford base32 format', () => {
    for (let i = 0; i < 200; i++) expect(generateReference()).toMatch(REFERENCE_PATTERN);
  });

  it('never uses the excluded letters I, L, O, U', () => {
    for (let i = 0; i < 200; i++) expect(generateReference().slice(4)).not.toMatch(/[ILOU]/);
  });

  it('does not repeat across many calls', () => {
    const seen = new Set(Array.from({ length: 5000 }, generateReference));
    expect(seen.size).toBe(5000);
  });
});
