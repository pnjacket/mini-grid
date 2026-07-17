/**
 * `SCALE-PASTE-APPLY` micro-benchmark (P13) — `applyBatch` (paste/fill) resolved each
 * write's column via `columns.find` INSIDE the per-write loop → O(writes × columns).
 * P13 builds a `Map<ColumnId, ColumnDef>` once → O(writes + columns). Models a paste
 * block of N writes over a C-column grid.
 */
import { bench, describe } from 'vitest';

const C = 30;
const N = 5000;
const columns = Array.from({ length: C }, (_, i) => ({ id: `c${i}`, field: `f${i}` }));
const writes = Array.from({ length: N }, (_, i) => ({ columnId: `c${i % C}`, value: i }));

describe('SCALE-PASTE-APPLY · paste-block column resolution (P13)', () => {
  bench('baseline (pre-P13) · columns.find per write', () => {
    let acc = 0;
    for (const w of writes) {
      const col = columns.find((c) => c.id === w.columnId);
      if (col) acc++;
    }
    void acc;
  });

  bench('production · Map built once + get per write', () => {
    const byId = new Map(columns.map((c) => [c.id, c]));
    let acc = 0;
    for (const w of writes) {
      const col = byId.get(w.columnId);
      if (col) acc++;
    }
    void acc;
  });
});
