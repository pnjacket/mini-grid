/**
 * `PERF-FRAME-STEADY` micro-benchmark (P12) — the `MSG-EXPORT-ROWS` reply. The
 * engine's `exportRows()` already returns `{key, data}` objects; pre-P12 the engine
 * host re-mapped them into an identical shape (a second full-n allocation over up
 * to 1M rows) for nothing. Models the redundant second map.
 */
import { bench, describe } from 'vitest';

const N = 100_000;
const engineRows = Array.from({ length: N }, (_, i) => ({ key: `k${i}`, data: { v: i } }));
// The engine's own projection (always present, kept).
const exportRows = (): Array<{ key: string; data: { v: number } }> =>
  engineRows.map((r) => ({ key: r.key, data: r.data }));

describe('PERF-FRAME-STEADY · MSG-EXPORT-ROWS reply (P12)', () => {
  bench('baseline (pre-P12) · exportRows() + engine-host re-map', () => {
    void exportRows().map((r) => ({ key: r.key, data: r.data }));
  });

  bench('production · exportRows() passed through', () => {
    void exportRows();
  });
});
