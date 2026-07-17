/**
 * React adapter usage — `<MiniGrid>` with a forwarded ref to the live Grid.
 * Referenced by `docs/guide/framework-adapters.md`.
 */
import { useRef } from 'react';
import { MiniGrid } from '@mini-grid/react';
import type { MiniGridHandle } from '@mini-grid/react';
import type { ColumnDef, RowData } from '@mini-grid/core';

const columns: ColumnDef[] = [
  { id: 'id', field: 'id', header: 'ID', type: 'number', width: 80 },
  { id: 'name', field: 'name', header: 'Name', type: 'text', editable: true },
];

const data: RowData[] = [
  { id: 1, name: 'Ada' },
  { id: 2, name: 'Alan' },
];

export function Example() {
  const ref = useRef<MiniGridHandle>(null);

  return (
    <MiniGrid
      ref={ref}
      columns={columns}
      data={data}
      options={{ keyField: 'id', theme: 'light' }}
      onSelectionChange={(e) => console.log(e.selection.activeCell)}
      onAfterEdit={(e) => console.log(e.cell.columnId, e.newValue)}
      style={{ height: 400 }}
    />
  );
}
