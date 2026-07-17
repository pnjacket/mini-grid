/**
 * `PERF-FRAME-STEADY` micro-benchmark (P6) — while any merge exists the window
 * repaints sequentially, resolving the merge covering each cell. Pre-P6 that was an
 * O(merges) full row+column scan PER CELL; P6 filters merges to the row once, then
 * a column-only scan per cell. Models a window of R rows × C cols with M merges.
 */
import { bench, describe } from 'vitest';

interface Range {
  top: number;
  bottom: number;
  left: number;
  right: number;
}
const R = 40;
const C = 20;
const M = 8;
const merges: { range: Range }[] = Array.from({ length: M }, (_, i) => ({
  range: { top: i * 4, bottom: i * 4 + 2, left: (i * 3) % C, right: ((i * 3) % C) + 1 },
}));

describe('PERF-FRAME-STEADY · per-cell merge resolution (P6)', () => {
  bench('baseline (pre-P6) · O(merges) full scan per cell', () => {
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        let hit: { range: Range } | undefined;
        for (const m of merges) {
          if (r >= m.range.top && r <= m.range.bottom && c >= m.range.left && c <= m.range.right) {
            hit = m;
            break;
          }
        }
        void hit;
      }
    }
  });

  bench('production · row-filter once + column scan per cell', () => {
    for (let r = 0; r < R; r++) {
      const rowMerges = merges.filter((m) => r >= m.range.top && r <= m.range.bottom);
      for (let c = 0; c < C; c++) {
        let hit: { range: Range } | undefined;
        for (let mi = 0; mi < rowMerges.length; mi++) {
          const m = rowMerges[mi] as { range: Range };
          if (c >= m.range.left && c <= m.range.right) {
            hit = m;
            break;
          }
        }
        void hit;
      }
    }
  });
});
