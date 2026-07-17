/**
 * `PERF-CELL-PATH` micro-benchmark (P3) — the cascade's `columnDefaultStyle`
 * resolver runs behind the per-cell style memo; on invalidation it fires per
 * visible cell. Pre-P3 it did `columns.find(c => c.id === id)` (O(columns)); P3
 * routes it through the store's O(1) `columnById` map. This models the exact
 * lookup pattern at a realistic column count: `baseline` = the pre-P3 linear scan,
 * `production` = the O(1) map.
 */
import { bench, describe } from 'vitest';

import type { ColumnDef } from './options.js';
import type { CellStyle, ColumnId } from '../types.js';

const M = 30; // columns
const columns: ColumnDef[] = Array.from({ length: M }, (_, i) => ({
  id: `col${i}`,
  field: `f${i}`,
  defaultStyle: { fillColor: `#${i}` } as CellStyle,
}));
const byId = new Map<ColumnId, ColumnDef>(columns.map((c) => [c.id, c]));

// Distinct id lookups (worst case for a linear scan — hits every position).
const ids: ColumnId[] = Array.from({ length: 50_000 }, (_, i) => `col${i % M}`);

describe('PERF-CELL-PATH · column defaultStyle lookup (P3)', () => {
  bench('baseline (pre-P3) · columns.find', () => {
    for (let i = 0; i < ids.length; i++) {
      const _ = columns.find((c) => c.id === ids[i])?.defaultStyle;
      void _;
    }
  });

  bench('production · Map.get (store.getColumn)', () => {
    for (let i = 0; i < ids.length; i++) {
      const _ = byId.get(ids[i] as ColumnId)?.defaultStyle;
      void _;
    }
  });
});
