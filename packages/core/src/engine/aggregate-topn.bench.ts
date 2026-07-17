/**
 * `SCALE-AGG-TOPN` micro-benchmark (P11) — a top-N conditional aggregate keeps only
 * `count` (~10) extreme values, but pre-P11 it did a full O(n log n) sort of all n
 * values plus a full-size `.slice()` clone. P11 uses a bounded O(n·count) selection.
 */
import { bench, describe } from 'vitest';

const N = 200_000;
const values = Array.from({ length: N }, (_, i) => (i * 7919) % 100_000);
const count = 10;

describe('SCALE-AGG-TOPN · top-N over N values (P11)', () => {
  bench('baseline (pre-P11) · full sort + slice', () => {
    const sorted = values.slice().sort((a, b) => b - a);
    void sorted.slice(0, count);
  });

  bench('production · bounded O(n·count) selection', () => {
    const top: number[] = [];
    for (let i = 0; i < values.length; i++) {
      const v = values[i] as number;
      const least = top[top.length - 1] as number;
      if (top.length < count || v > least) {
        let j = top.length;
        top.push(v);
        while (j > 0) {
          const prev = top[j - 1] as number;
          if (v > prev) {
            top[j] = prev;
            j--;
          } else break;
        }
        top[j] = v;
        if (top.length > count) top.pop();
      }
    }
    void top;
  });
});
