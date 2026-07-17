/**
 * `PERF-CELL-PATH` micro-benchmark (P2) — `ConditionalFormatEngine.evaluate` runs
 * per visible cell whenever the cascade memo misses (every cell on invalidation,
 * each newly-visible cell on scroll). The pre-P2 version did a `.filter` (alloc) +
 * O(rules) scan + `.sort` **per cell**; P2 iterates a priority-sorted rule array
 * rebuilt only on mutation.
 */
import { bench, describe } from 'vitest';

import { ConditionalFormatEngine } from './conditional.js';
import type { CellContext } from '../types.js';

const eng = new ConditionalFormatEngine(() => Promise.resolve(0));
// 9 overlapping value rules, added OUT of priority order (worst case for a per-cell sort).
for (let p = 8; p >= 0; p--) {
  eng.add({
    kind: 'value',
    config: { op: '>', value: p * 10 },
    style: { fillColor: `#${p}${p}${p}${p}${p}${p}` },
    priority: p,
  });
}

const mkCtx = (v: number, r: number, c: number): CellContext => ({
  rowKey: `r${r}`,
  columnId: 'v',
  field: 'v',
  value: v,
  data: {},
  rowIndex: r,
  colIndex: c,
});

const N = 5000;

describe('PERF-CELL-PATH · conditional evaluate over a cell window (P2)', () => {
  bench('evaluate — 9 rules × N cells', () => {
    for (let i = 0; i < N; i++) eng.evaluate(mkCtx(i % 100, i, i % 20));
  });
});
