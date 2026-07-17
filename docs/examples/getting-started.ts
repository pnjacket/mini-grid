/**
 * Getting started — mount a grid, bind an in-memory array, react to selection.
 * Referenced by `docs/guide/getting-started.md`. Typechecked by `pnpm docs:check`.
 */
import { createGrid } from '@mini-grid/core';
import type { ColumnDef, RowData } from '@mini-grid/core';

const columns: ColumnDef[] = [
  { id: 'id', field: 'id', header: 'ID', type: 'number', width: 80 },
  { id: 'name', field: 'name', header: 'Name', type: 'text', editable: true },
  { id: 'email', field: 'email', header: 'Email', type: 'text' },
];

const data: RowData[] = [
  { id: 1, name: 'Ada Lovelace', email: 'ada@example.com' },
  { id: 2, name: 'Alan Turing', email: 'alan@example.com' },
];

export function mount(host: HTMLElement) {
  const grid = createGrid(host, {
    columns,
    keyField: 'id',
    theme: 'light',
    density: 'comfortable',
  });

  // Bind the dataset (returns a promise resolving the bound row count).
  void grid.setData(data);

  // Subscribe to selection changes (one of the EVT-* after-events).
  const off = grid.on('selectionChange', ({ selection }) => {
    console.log('active cell', selection.activeCell);
  });

  // Later: off(); grid.destroy();
  return { grid, off };
}
