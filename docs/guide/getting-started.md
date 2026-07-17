# Getting started

`@mini-grid/core` is a framework-agnostic data-grid you drive from code. This guide
mounts a grid, binds an in-memory array, and reacts to events.

> The complete, typechecked source for this guide is
> [`docs/examples/getting-started.ts`](../examples/getting-started.ts).
> All example files are compiled against the built types by `pnpm docs:check`.

## Install

```sh
npm install @mini-grid/core
```

## Mount a grid

`createGrid(host, options)` returns a live `Grid`. Give the host element a bounded
height so virtualization has a viewport.

```ts
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

const grid = createGrid(host, {
  columns,
  keyField: 'id',        // row identity — required for reliable edits/diffing
  theme: 'light',        // 'light' | 'dark'
  density: 'comfortable', // 'comfortable' | 'compact'
});

await grid.setData(data); // resolves { rowCount }
```

```html
<div id="app" style="height: 400px"></div>
```

The core injects its own AA-contrast base stylesheet — no CSS import needed.

## React to events

Subscribe to the typed event bus with `grid.on(type, handler)`; it returns an
unsubscribe function.

```ts
const off = grid.on('selectionChange', ({ selection }) => {
  console.log('active cell', selection.activeCell);
});
```

Before-events (e.g. `beforeSort`) are **vetoable** via `event.preventDefault()`;
after-events (e.g. `afterEdit`) are notifications.

## Clean up

```ts
off();          // remove a single listener
grid.destroy(); // unmount and release resources (idempotent)
```

## Next

- [Columns & data](columns-and-data.md) — column types, feature flags, CRUD.
- [Editing & validation](editing-and-validation.md)
- [Formatting](formatting.md)
- [Sorting & filtering](sorting-filtering.md)
- [Framework adapters](framework-adapters.md)
