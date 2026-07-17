/**
 * Formatting — cell styling (CAP-FMT-CELL), value masks (CAP-FMT-VALUE), and all
 * conditional-format kinds (CAP-COND-FMT). Referenced by
 * `docs/guide/formatting.md`.
 */
import { createGrid } from '@mini-grid/core';
import type { CellStyle, ColumnDef, Grid } from '@mini-grid/core';

const columns: ColumnDef[] = [
  { id: 'id', field: 'id', header: 'ID', type: 'number' },
  // Value masks: currency + a custom formatter function.
  { id: 'amount', field: 'amount', header: 'Amount', type: 'number', formatMask: 'currency:USD' },
  { id: 'ratio', field: 'ratio', header: 'Ratio', type: 'number', formatMask: (v) => `${Number(v) * 100}%` },
  { id: 'score', field: 'score', header: 'Score', type: 'number' },
];

export async function build(host: HTMLElement): Promise<Grid> {
  const grid = createGrid(host, { columns, keyField: 'id' });
  await grid.setData([
    { id: 1, amount: 1999.5, ratio: 0.25, score: 88 },
    { id: 2, amount: 42, ratio: 0.9, score: 12 },
  ]);

  // CAP-FMT-CELL — write a sparse style over a logical range.
  const heading: CellStyle = { fillColor: '#fff3bf', textColor: '#5f3dc4', fontWeight: 'bold', align: { h: 'center' } };
  grid.setStyle({ top: 0, left: 1, bottom: 0, right: 3 }, heading);

  // CAP-COND-FMT — a value rule, a color scale, a data bar, and an icon set.
  grid.addConditionalRule({
    kind: 'value',
    scope: [{ top: 0, left: 3, bottom: 1_000, right: 3 }],
    config: { op: '>', value: 80 },
    style: { fillColor: '#c92a2a', textColor: '#ffffff' },
  });
  grid.addConditionalRule({
    kind: 'colorScale',
    scope: [{ top: 0, left: 3, bottom: 1_000, right: 3 }],
    config: { columnId: 'score', min: '#ffffff', mid: '#ffd43b', max: '#2b8a3e' },
  });
  grid.addConditionalRule({
    kind: 'dataBar',
    scope: [{ top: 0, left: 1, bottom: 1_000, right: 1 }],
    config: { columnId: 'amount', color: '#4263eb' },
  });
  grid.addConditionalRule({
    kind: 'iconSet',
    scope: [{ top: 0, left: 3, bottom: 1_000, right: 3 }],
    config: { columnId: 'score', icons: [{ min: 0, icon: '🔴' }, { min: 50, icon: '🟢' }] },
  });

  // A custom predicate returning a style (or null).
  grid.addConditionalRule({
    kind: 'custom',
    scope: [{ top: 0, left: 1, bottom: 1_000, right: 1 }],
    config: { predicate: (cell) => (Number(cell.value) < 100 ? { italic: true } : null) },
  });

  return grid;
}
