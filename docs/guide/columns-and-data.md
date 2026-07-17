# Columns & data

> Typechecked source: [`docs/examples/columns-and-data.ts`](../examples/columns-and-data.ts).

## Column definitions

A `ColumnDef` maps a `field` in your row data to a rendered column. `type` selects
the default editor and value handling; the common optional keys:

```ts
import type { ColumnDef } from '@mini-grid/core';

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
    flags: { sortable: true, filterable: true, resizable: true, reorderable: false },
  },
];
```

- `type` — `'text' | 'number' | 'date' | 'boolean' | 'select' | 'custom'`.
- `editable` — enable inline editing for the column.
- `editor` — override the type-default editor (see [editing](editing-and-validation.md)).
- `validation` — declarative rules run on commit.
- `formatMask` — a value-format mask or formatter function (see [formatting](formatting.md)).
- `defaultStyle` — base cell style (bottom of the style cascade).
- `renderer` — a custom cell renderer returning a DOM `Node` or string.
- `flags` — per-column opt-outs for `sortable` / `filterable` / `resizable` / `reorderable`.

## Binding data

Rows are plain objects (`RowData = Record<string, unknown>`). `setData` binds or
rebinds the whole dataset; `keyField` gives each row a stable identity.

```ts
await grid.setData([{ id: 1, name: 'Ada', active: true, joined: '2020-01-01', plan: 'pro' }]);
```

Pass an in-memory array of up to ~1M rows — rendering is virtualized. (An async
`DataSource` adapter is a defined extension point, deferred to v2.)

## Feature flags

Every capability is independently toggleable. A disabled feature is never
registered — no affordance and, structurally, no cost.

```ts
const grid = createGrid(host, { columns, keyField: 'id', features: { group: false, merge: false } });

grid.isFeatureEnabled('group'); // false
```

Flags: `editing`, `sorting`, `filtering`, `selection`, `resize`, `reorder`,
`freeze`, `merge`, `group`, `clipboard`, `formatting`, `conditionalFormatting`,
`theme`, `export`, `persistState`, `contextMenu`, `undo`, `i18n` — all default `true`.

## Row & column CRUD

Each mutation is one undoable command and fires a vetoable before / notify after event.

```ts
await grid.insertRows(1, [{ id: 2, name: 'Alan' }]); // insert at index
await grid.removeRows([1]);                          // remove by key
const { column } = await grid.insertColumn(2);       // blank column at index
await grid.removeColumn(column.id);                  // destructive column drop

const changes = await grid.getChanges(); // { new, dirty, removed } bucketed by key
```
