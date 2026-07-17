/**
 * Sorting & filtering — multi-column sort, function predicates, the type-aware
 * operator builder, freeze/resize/reorder, and merge/group. Referenced by
 * `docs/guide/sorting-filtering.md`.
 */
import { buildFilterPredicate, createGrid } from '@mini-grid/core';
import type { ColumnDef, Grid } from '@mini-grid/core';

const columns: ColumnDef[] = [
  { id: 'id', field: 'id', header: 'ID', type: 'number' },
  { id: 'category', field: 'category', header: 'Category', type: 'text' },
  { id: 'amount', field: 'amount', header: 'Amount', type: 'number' },
];

export async function build(host: HTMLElement): Promise<Grid> {
  const grid = createGrid(host, { columns, keyField: 'id' });
  await grid.setData([
    { id: 1, category: 'a', amount: 10 },
    { id: 2, category: 'b', amount: 30 },
    { id: 3, category: 'a', amount: 20 },
  ]);

  // Multi-column sort (precedence follows entry order).
  await grid.sort({
    entries: [
      { columnId: 'category', direction: 'asc' },
      { columnId: 'amount', direction: 'desc' },
    ],
  });

  // Filter with a plain function predicate…
  await grid.filter({ perColumn: { amount: (value) => Number(value) >= 20 } });

  // …or build one from the type-aware operator set (as the header menu does).
  const predicate = buildFilterPredicate('number', 'gt', '15');
  if (predicate) {
    await grid.filter({ perColumn: { amount: predicate } });
  }

  // Clear the filter (empty = all rows).
  await grid.filter({ perColumn: {} });

  // Structure: freeze, resize, reorder, merge, group.
  grid.setFrozen({ rows: 1, cols: 1 });
  grid.setColumnWidth('category', 200);
  grid.moveColumn('amount', 1);
  grid.merge({ top: 0, left: 1, bottom: 0, right: 2 });
  const { id } = grid.group({ axis: 'row', start: 0, span: 2 });
  grid.setCollapsed(id, true);

  return grid;
}
