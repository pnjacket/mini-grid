/**
 * Vue adapter usage — the `<MiniGrid>` component via a render function.
 * Referenced by `docs/guide/framework-adapters.md`.
 */
import { defineComponent, h } from 'vue';
import { MiniGrid } from '@mini-grid/vue';
import type { ColumnDef, RowData } from '@mini-grid/core';

const columns: ColumnDef[] = [
  { id: 'id', field: 'id', header: 'ID', type: 'number', width: 80 },
  { id: 'name', field: 'name', header: 'Name', type: 'text', editable: true },
];

const data: RowData[] = [
  { id: 1, name: 'Ada' },
  { id: 2, name: 'Alan' },
];

export default defineComponent({
  name: 'Example',
  setup() {
    return () =>
      h(MiniGrid, {
        columns,
        data,
        options: { keyField: 'id' },
        onSelectionChange: (e: { selection: { activeCell: unknown } }) =>
          console.log(e.selection.activeCell),
      });
  },
});
