/**
 * `PERF-CELL-PATH` micro-benchmark (P4) — a colorScale rule calls `interpolate`
 * per visible cell (the fraction varies per cell so the interpolation itself must
 * run each time), and pre-P4 it re-parsed the SAME static endpoint hex colors every
 * call. P4 memoizes `parseHex`. `production` = the cached path; `baseline` inlines a
 * per-call parse (pre-P4).
 */
import { bench, describe } from 'vitest';

import { interpolate } from './conditional.js';

const N = 100_000;

function parse(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

function inlineInterpolate(a: string, b: string, t: number): string {
  const ca = parse(a);
  const cb = parse(b);
  const h = (x: number): string => Math.round(x).toString(16).padStart(2, '0');
  return `#${h(ca.r + (cb.r - ca.r) * t)}${h(ca.g + (cb.g - ca.g) * t)}${h(ca.b + (cb.b - ca.b) * t)}`;
}

describe('PERF-CELL-PATH · colorScale interpolate (P4)', () => {
  bench('production · interpolate (cached parseHex)', () => {
    for (let i = 0; i < N; i++) interpolate('#ff0000', '#00ff00', (i % 100) / 100);
  });

  bench('baseline (pre-P4) · interpolate w/ per-call parse', () => {
    for (let i = 0; i < N; i++) inlineInterpolate('#ff0000', '#00ff00', (i % 100) / 100);
  });
});
