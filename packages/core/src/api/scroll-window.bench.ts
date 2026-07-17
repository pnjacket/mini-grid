/**
 * `PERF-FRAME-STEADY` micro-benchmark (P9) — pre-P9 a scroll computed the visible
 * row+col window in `onScroll` (for the sync `EVT-SCROLL` payload) and then AGAIN
 * inside `refresh`. P9 threads the first result into `refresh`. Uses the real
 * `Viewport`/`HeightIndex`; `baseline` computes both windows twice per scroll.
 */
import { bench, describe } from 'vitest';

import { Viewport } from '../viewport/viewport.js';
import { HeightIndex } from '../viewport/height-index.js';

const ROWS = 1_000_000;
const hi = new HeightIndex(28);
hi.setCount(ROWS);
const vp = new Viewport(hi, Array.from({ length: 30 }, () => 100));
const STEPS = 1000;

describe('PERF-FRAME-STEADY · scroll window computation (P9)', () => {
  bench('baseline (pre-P9) · row+col window computed TWICE per scroll', () => {
    for (let s = 0; s < STEPS; s++) {
      const top = s * 20;
      vp.computeRowWindow(top, 600, 4, ROWS);
      vp.computeColWindow(s * 10, 800, 4);
      // refresh recomputed the identical window:
      vp.computeRowWindow(top, 600, 4, ROWS);
      vp.computeColWindow(s * 10, 800, 4);
    }
  });

  bench('production · computed ONCE (threaded into refresh)', () => {
    for (let s = 0; s < STEPS; s++) {
      const top = s * 20;
      vp.computeRowWindow(top, 600, 4, ROWS);
      vp.computeColWindow(s * 10, 800, 4);
    }
  });
});
