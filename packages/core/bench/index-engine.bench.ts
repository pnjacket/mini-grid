/**
 * Node micro-benchmark for the worker-side data engine (`COMPONENT-DATA-WORKER`).
 * Measures, on THIS machine, the pure `IndexEngine` timings that dominate at 1M
 * rows (`SEQ-MOUNT` data portion, `SEQ-SORT`, `SEQ-FILTER`) — the calibration
 * inputs for the provisional `PERF-SORT` / `PERF-FILTER` / `PERF-MOUNT` targets.
 *
 * Run (after `pnpm -r build`):
 *   node --experimental-strip-types --max-old-space-size=4096 \
 *     packages/core/bench/index-engine.bench.ts
 */
import { performance } from 'node:perf_hooks';
import { IndexEngine } from '../dist/index.js';

const N = 1_000_000;

function ms(v: number): string {
  return `${v.toFixed(1)} ms`;
}

const genStart = performance.now();
const rows: Array<Record<string, unknown>> = new Array(N);
for (let i = 0; i < N; i++) {
  rows[i] = {
    id: i,
    value: (i * 2654435761) % 1_000_003,
    group: i % 100,
    name: `row-${i}`,
  };
}
const genMs = performance.now() - genStart;

const engine = new IndexEngine();

// SEQ-MOUNT (data portion): load + build the initial ordered/filtered index.
const loadStart = performance.now();
engine.load(rows, {
  keyField: 'id',
  columns: [
    { id: 'value', field: 'value', type: 'number' },
    { id: 'group', field: 'group', type: 'number' },
    { id: 'name', field: 'name', type: 'text' },
  ],
});
const loadMs = performance.now() - loadStart;

// SEQ-SORT: full sort of 1M rows on a numeric column.
const sortStart = performance.now();
engine.setSort({ entries: [{ columnId: 'value', direction: 'asc' }] });
const sortMs = performance.now() - sortStart;

// SEQ-FILTER: filter 1M rows (~half match).
const filterStart = performance.now();
const counts = engine.setFilter({
  perColumn: { value: (v) => typeof v === 'number' && v < 500_000 },
});
const filterMs = performance.now() - filterStart;

console.log('mini-grid IndexEngine micro-benchmark');
console.log('=====================================');
console.log(`rows:              ${N.toLocaleString()}`);
console.log(`row generation:    ${ms(genMs)}`);
console.log(`load + index build:${' '}${ms(loadMs)}   (SEQ-MOUNT data portion)`);
console.log(`sort 1M rows:      ${ms(sortMs)}   (SEQ-SORT engine time)`);
console.log(`filter 1M rows:    ${ms(filterMs)}   (SEQ-FILTER engine time)`);
console.log(`filtered rowCount: ${counts.rowCount.toLocaleString()} / ${counts.totalRowCount.toLocaleString()}`);
