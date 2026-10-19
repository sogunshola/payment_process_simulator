/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Read from disk (not imported): Vitest does not process CSS, so an import would be empty.
const css = readFileSync(`${process.cwd()}/src/index.css`, 'utf8');
// Tests run from frontend/. Reading the real tokens means the test fails if someone edits a colour into a bad value.

type Rgba = [number, number, number, number];

function token(name: string): Rgba {
  const m = css.match(new RegExp(`--color-${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`token --color-${name} not found`);
  const v = m[1].trim();
  const hex = v.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgb = v.match(/^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\s*\)$/);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), Number(rgb[4])];
  throw new Error(`unsupported colour format for --color-${name}: ${v}`);
}

/** Composites a translucent colour over an opaque backdrop. */
function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat(1) as Rgba;
}

function luminance([r, g, b]: Rgba): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const bg = token('bg');
// Badges and cards sit on a translucent surface over the page, so composite it first.
const badgeBg = over(token('surface'), bg);
const cardStrong = token('surface-strong');
const STATUSES = ['pending', 'processing', 'succeeded', 'failed', 'cancelled'] as const;

describe('colour contrast (WCAG 2.x)', () => {
  it.each(STATUSES)('status-%s label text is at least 4.5:1 on its badge background', (s) => {
    expect(ratio(token(`status-${s}`), badgeBg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(STATUSES)('status-%s text is at least 4.5:1 on the page background', (s) => {
    expect(ratio(token(`status-${s}`), bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(STATUSES)('status-%s dot is at least 3:1 on the badge and the page', (s) => {
    expect(ratio(token(`status-${s}`), badgeBg)).toBeGreaterThanOrEqual(3);
    expect(ratio(token(`status-${s}`), bg)).toBeGreaterThanOrEqual(3);
  });

  it('muted text is at least 4.5:1 on the page, a card and the raised surface', () => {
    const muted = token('muted');
    expect(ratio(muted, bg)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(muted, badgeBg)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(muted, cardStrong)).toBeGreaterThanOrEqual(4.5);
  });

  it('body text is at least 4.5:1 on the page and the raised surface', () => {
    expect(ratio(token('fg'), bg)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(token('fg'), cardStrong)).toBeGreaterThanOrEqual(4.5);
  });

  it('accent (links, focus ring) is at least 4.5:1 as text and 3:1 as an indicator on the page', () => {
    expect(ratio(token('accent'), bg)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(token('accent'), cardStrong)).toBeGreaterThanOrEqual(3);
  });

  it('ink on the accent and on the failed colour (primary and danger buttons) is at least 4.5:1', () => {
    expect(ratio(token('accent-ink'), token('accent'))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(token('accent-ink'), token('status-failed'))).toBeGreaterThanOrEqual(4.5);
  });

  it('form-control border is at least 3:1 on the raised surface and the page', () => {
    expect(ratio(token('control-border'), cardStrong)).toBeGreaterThanOrEqual(3);
    expect(ratio(token('control-border'), bg)).toBeGreaterThanOrEqual(3);
  });

  it('status-failed error text is at least 4.5:1 on the raised surface (form errors in dialogs)', () => {
    expect(ratio(token('status-failed'), cardStrong)).toBeGreaterThanOrEqual(4.5);
  });

  it('the hairline border is deliberately low contrast (decoration, not a control boundary)', () => {
    // Documented rather than asserted as pass: see docs/ACCESSIBILITY.md known gaps.
    expect(ratio(over(token('line'), bg), bg)).toBeLessThan(3);
  });

  it('helper sanity: black on white is 21:1', () => {
    expect(ratio([0, 0, 0, 1], [255, 255, 255, 1])).toBeCloseTo(21, 5);
  });
});
