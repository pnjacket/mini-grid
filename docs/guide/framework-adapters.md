# Framework adapters

The adapters are thin wrappers that bind a framework's lifecycle to the core's
public API (`createGrid` / the `Grid` facade / the `EVT-*` bus). They import the
core's public surface only — the core is a runtime dependency and the framework an
**optional peer**. All three expose the live `Grid` instance so you can call the
full API imperatively.

Common props/params across adapters:

- `columns` (required) — a new reference rebuilds the grid.
- `data` — a new reference calls `setData` (no rebuild).
- `options` — any other `createGrid` option (`keyField`, `theme`, `features`, …);
  a new reference rebuilds the grid.
- Event callbacks forward the `EVT-*` after-events.

## React

> Typechecked source: [`docs/examples/react-usage.tsx`](../examples/react-usage.tsx).

```tsx
import { useRef } from 'react';
import { MiniGrid } from '@mini-grid/react';
import type { MiniGridHandle } from '@mini-grid/react';

export function Example() {
  const ref = useRef<MiniGridHandle>(null); // ref.current is the live Grid
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
```

Named callbacks (`onSelectionChange`, `onAfterEdit`, `onError`) plus a generic
`events` map for the rest of the surface.

## Vue

> Typechecked source: [`docs/examples/vue-usage.ts`](../examples/vue-usage.ts).

```vue
<script setup lang="ts">
import { MiniGrid } from '@mini-grid/vue';
</script>

<template>
  <MiniGrid
    :columns="columns"
    :data="data"
    :options="{ keyField: 'id' }"
    @selection-change="(e) => console.log(e.selection.activeCell)"
  />
</template>
```

The component re-emits the whole `EVT-*` surface as Vue events and exposes the
instance via `getGrid()`.

## Svelte

> Typechecked source: [`docs/examples/svelte-usage.ts`](../examples/svelte-usage.ts).

Use the idiomatic action:

```svelte
<script>
  import { miniGrid } from '@mini-grid/svelte';
</script>

<div use:miniGrid={{ columns, data, options: { keyField: 'id' },
  onSelectionChange: (e) => console.log(e.selection.activeCell) }}></div>
```

There's also a raw `@mini-grid/svelte/MiniGrid.svelte` wrapper, and a compiler-free
`createMiniGrid(target, params)` for hosts without a Svelte toolchain:

```ts
import { createMiniGrid } from '@mini-grid/svelte';

const instance = createMiniGrid(target, { columns, data, options: { keyField: 'id' } });
instance.grid?.sort({ entries: [{ columnId: 'id', direction: 'asc' }] });
instance.destroy();
```

## Versioning

The core and all three adapters publish in **lockstep** at one version via
Changesets — install matching versions of `@mini-grid/core` and its adapter.
