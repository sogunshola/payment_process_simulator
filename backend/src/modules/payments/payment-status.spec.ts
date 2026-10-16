import { PaymentStatus as S, canTransition } from './payment-status';

const ALL = Object.values(S);
const ALLOWED: Array<[S, S]> = [
  [S.PENDING, S.PROCESSING],
  [S.PENDING, S.CANCELLED],
  [S.PROCESSING, S.SUCCEEDED],
  [S.PROCESSING, S.FAILED],
  [S.PROCESSING, S.PENDING],
];

describe('canTransition', () => {
  const cases = ALL.flatMap((from) =>
    ALL.map((to) => [from, to, ALLOWED.some(([f, t]) => f === from && t === to)] as const),
  );

  it('covers all 25 pairs', () => {
    expect(cases).toHaveLength(25);
  });

  it.each(cases)('%s -> %s is %s', (from, to, expected) => {
    expect(canTransition(from, to)).toBe(expected);
  });
});
