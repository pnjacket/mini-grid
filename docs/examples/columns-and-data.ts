/**
 * Columns & data — column types, feature flags, and the row/column CRUD API.
 * Referenced by `docs/guide/columns-and-data.md`.
 */
import { createGrid } from '@mini-grid/core';
import type { ColumnDef, Grid, RowData } from '@mini-grid/core';

const columns: ColumnDef[] = [
  { id: 'id', field: 'id', header: 'ID', type: 'number', width: 72 },
  { id: 'name', field: 'name', header: 'Name', type: 'text' },
  { id: 'active', field: 'active', header: 'Active', type: 'boolean' },
  { id: 'joined', field: 'joined', header: 'Joined', type: 'date', formatMask: 'date' },
  {
    id: 'plan',
    field: 'plan',
    header: 'Plan',
    type: 'text',
    editor: { kind: 'select', options: [{ value: 'free' }, { value: 'pro' }] },
    // Per-column feature opt-outs live under `flags`.
    flags: { sortable: true, filterable: true, resizable: true, reorderable: false },
  },
];

export async function build(host: HTMLElement): Promise<Grid> {
  const grid = createGrid(host, {
    columns,
    keyField: 'id',
    // Every capability is independently toggleable; disabled ⇒ no affordance.
    features: { group: false, merge: false },
  });

  const initial: RowData[] = [
    { id: 1, name: 'Ada', active: true, joined: '2020-01-01', plan: 'pro' },
  ];
  await grid.setData(initial);

  // Row CRUD (each is one undoable command).
  await grid.insertRows(1, [{ id: 2, name: 'Alan', active: false, joined: '2021-06-15', plan: 'free' }]);
  await grid.removeRows([1]);

  // Column CRUD.
  const { column } = await grid.insertColumn(2);
  await grid.removeColumn(column.id);

  // Pending changes bucketed by change-state.
  const changes = await grid.getChanges();
  console.log(changes.new, changes.dirty, changes.removed);

  return grid;
}
