/**
 * Svelte adapter usage — the `miniGrid` action + the compiler-free
 * `createMiniGrid` wrapper. Referenced by `docs/guide/framework-adapters.md`.
 *
 * In a `.svelte` file you would instead write:
 *   <div use:miniGrid={{ columns, data, options }}></div>
 * (or import `@mini-grid/svelte/MiniGrid.svelte`).
 */
import { createMiniGrid, miniGrid } from '@mini-grid/svelte';
import type { MiniGridParams } from '@mini-grid/svelte';
import type { ColumnDef, Grid, RowData } from '@mini-grid/core';

const columns: ColumnDef[] = [
  { id: 'id', field: 'id', header: 'ID', type: 'number', width: 80 },
  { id: 'name', field: 'name', header: 'Name', type: 'text', editable: true },
];

const data: RowData[] = [
  { id: 1, name: 'Ada' },
  { id: 2, name: 'Alan' },
];

const params: MiniGridParams = {
  columns,
  data,
  options: { keyField: 'id' },
  onSelectionChange: (e) => console.log(e.selection.activeCell),
  onReady: (grid: Grid) => console.log('ready', grid.getSortSpec()),
};

/** Imperative (no Svelte toolchain required). */
export function mount(target: HTMLElement) {
  return createMiniGrid(target, params);
}

/** The action, for `use:miniGrid` inside a `.svelte` component. */
export { miniGrid };
