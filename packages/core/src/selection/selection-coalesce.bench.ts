/**
 * `SCALE-SELECT-COALESCE` micro-benchmark (P14) — `getRanges()` coalesces the
 * range-set on every drag cell-crossing. The common case is a single drag range,
 * which can't overlap anything; P14 short-circuits `length <= 1` past the O(n²)
 * pairwise loop. Models the coalesce for one range.
 */
import { bench, describe } from 'vitest';

interface Range {
  top: number;
  left: number;
  bottom: number;
  right: number;
}
const overlap = (a: Range, b: Range): boolean =>
  a.top <= b.bottom && b.top <= a.bottom && a.left <= b.right && b.left <= a.right;
const bbox = (a: Range, b: Range): Range => ({
  top: Math.min(a.top, b.top),
  left: Math.min(a.left, b.left),
  bottom: Math.max(a.bottom, b.bottom),
  right: Math.max(a.right, b.right),
});
function loop(list: Range[]): Range[] {
  const out = list.map((r) => ({ ...r }));
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        if (overlap(out[i] as Range, out[j] as Range)) {
          out[i] = bbox(out[i] as Range, out[j] as Range);
          out.splice(j, 1);
          changed = true;
          break outer;
        }
      }
    }
  }
  return out;
}
const short = (list: Range[]): Range[] => (list.length <= 1 ? list.map((r) => ({ ...r })) : loop(list));

const one: Range[] = [{ top: 0, left: 0, bottom: 20, right: 5 }];

describe('SCALE-SELECT-COALESCE · getRanges on a single drag range (P14)', () => {
  bench('baseline (pre-P14) · full loop entry', () => {
    void loop(one);
  });

  bench('production · length<=1 short-circuit', () => {
    void short(one);
  });
});
