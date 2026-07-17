/**
 * `PERF-CELL-PATH` micro-benchmark (P1) — `formatValue` is called from
 * `decorateCell` once per visible cell per frame. The `production` case is the
 * regression guard; the `baseline` case reconstructs an `Intl` formatter per call
 * (the pre-P1 behavior) so the win is visible in a single `vitest bench` run.
 */
import { bench, describe } from 'vitest';

import { DEFAULT_LOCALE, formatValue } from './format-mask.js';
import type { CellContext } from '../types.js';

const ctx = {
  rowKey: 'r',
  columnId: 'amount',
  field: 'amount',
  data: {},
  rowIndex: 0,
  colIndex: 0,
} as unknown as CellContext;

// ~ a formatted column over a window of cells across a few frames.
const N = 2000;
const nums = Array.from({ length: N }, (_, i) => i * 3.5 + 0.99);
const dates = Array.from({ length: N }, (_, i) => 1_700_000_000_000 + i * 86_400_000);

describe('PERF-CELL-PATH · formatValue over a formatted window (P1)', () => {
  bench('production · currency:USD', () => {
    for (let i = 0; i < N; i++) formatValue(nums[i], 'currency:USD', ctx, DEFAULT_LOCALE);
  });

  bench('production · number:2', () => {
    for (let i = 0; i < N; i++) formatValue(nums[i], 'number:2', ctx, DEFAULT_LOCALE);
  });

  bench('production · date:medium', () => {
    for (let i = 0; i < N; i++) formatValue(dates[i], 'date:medium', ctx, DEFAULT_LOCALE);
  });

  // Reference: what P1 removes — a fresh Intl formatter per call.
  bench('baseline (pre-P1) · new Intl.NumberFormat per call', () => {
    for (let i = 0; i < N; i++) {
      new Intl.NumberFormat(DEFAULT_LOCALE, { style: 'currency', currency: 'USD' }).format(nums[i] as number);
    }
  });
});
