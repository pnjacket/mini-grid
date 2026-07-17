/**
 * `SCALE-FILTER-CTX` micro-benchmark (P10) — `buildFilteredIndex` runs the filter
 * predicate over every row (up to 1M). Pre-P10 it allocated a `{rowKey,columnId,
 * field,data}` context object per row per predicate even for built-in predicates
 * that never read it. Models the built-in path (predicate ignores the context).
 */
import { bench, describe } from 'vitest';

const N = 100_000;
const rows = Array.from({ length: N }, (_, i) => ({ key: `k${i}`, data: { v: i } }));
// Compiled predicates live in an array and are called via `preds[p]` (as in the
// real `compiled[p].pred(...)`) — an opaque call site, so V8 cannot inline the
// predicate and elide the escaping context object.
const preds: Array<(v: unknown, ctx?: unknown) => boolean> = [
  (v) => (v as number) > N / 2,
];

describe('SCALE-FILTER-CTX · buildFilteredIndex over N rows (P10)', () => {
  bench('baseline (pre-P10) · allocate context per row', () => {
    const idxs: number[] = [];
    for (let i = 0; i < N; i++) {
      const row = rows[i] as (typeof rows)[number];
      const p = preds[0] as (v: unknown, ctx?: unknown) => boolean;
      if (p(row.data.v, { rowKey: row.key, columnId: 'v', field: 'v', data: row.data })) {
        idxs.push(i);
      }
    }
    void idxs;
  });

  bench('production · no context for built-in predicates', () => {
    const idxs: number[] = [];
    for (let i = 0; i < N; i++) {
      const row = rows[i] as (typeof rows)[number];
      const p = preds[0] as (v: unknown, ctx?: unknown) => boolean;
      if (p(row.data.v)) idxs.push(i);
    }
    void idxs;
  });
});
