# mini-grid

**mini-grid** is a programmatic, framework-agnostic, TypeScript-first data-grid —
an Excel-worksheet-like presentation and data-entry surface over large datasets,
driven entirely from code. Its small, tree-shakeable core (`@mini-grid/core`, zero
required runtime dependencies) renders to virtualized DOM and stays fast at ~1M
rows; thin official adapters wrap it for React, Vue, and Svelte.

It is a **single sheet** (no cross-worksheet references). Excel-like in-cell
**formulas** are a first-class, fully-supported capability — **opt-in** via the
`formula` flag (default off, so a leading `=` stays literal text unless you enable it).

- **Large data** — DOM row/column virtualization renders only what's visible.
- **Rich editing** — inline editors (text · number · date · boolean · select ·
  custom), declarative + custom validation, row/column CRUD, undo/redo.
- **Excel-like formatting** — per-cell/range styling, value masks, and conditional
  formatting (value rules, color scales, data bars, icon sets, custom predicates).
- **Worksheet functions** — multi-column sort, per-column filtering, resize,
  reorder, frozen panes, cell merge, and collapsible row/column groups.
- **Formulas** *(opt-in)* — Excel-like in-cell formulas: A1 references + ranges,
  **475 functions** + 9 evaluator special forms (`LET`/`LAMBDA`/`MAP`/…), typed
  errors, dynamic-array **spill**, and cycle-detecting incremental recalculation.
- **Clipboard** — copy/cut/paste TSV to the system clipboard + a drag fill handle.
- **Export & state** — CSV (dependency-free) and `.xlsx` (optional `exceljs`);
  serialize/restore the grid layout.
- **Theming & i18n** — light/dark themes, density presets, locale-aware formatting,
  externalized strings, and full RTL.
- **Accessible by default** — ARIA-grid semantics, keyboard-complete operation,
  WCAG 2.1 AA.
- **Feature flags** — every capability is independently on/off; a disabled feature
  registers no affordance and carries no cost.

## Live demos

Interactive demos are hosted on GitHub Pages — **<https://pnjacket.github.io/mini-grid/>**:

- [Kitchen-sink](https://pnjacket.github.io/mini-grid/demo/kitchen-sink.html) — every capability with live toggles
- [1M-row grid](https://pnjacket.github.io/mini-grid/demo/index.html) — virtualization at scale
- [Formulas](https://pnjacket.github.io/mini-grid/demo/formula.html) — opt-in in-cell formula engine
- [Header region](https://pnjacket.github.io/mini-grid/demo/header.html) — sort/filter/resize/reorder/freeze + column management
- [Configurable menus](https://pnjacket.github.io/mini-grid/demo/menu.html) — context-menu customization
- [i18n + RTL](https://pnjacket.github.io/mini-grid/demo/i18n.html) — locale-aware formatting and right-to-left layout

Plus the [TypeDoc API reference](https://pnjacket.github.io/mini-grid/api/index.html).

## Install

```sh
npm install @mini-grid/core
# optional framework adapters (each treats its framework as an optional peer):
npm install @mini-grid/react   # or @mini-grid/vue, @mini-grid/svelte
```

The core ships **ESM + IIFE (UMD-style, worker inlined) + `.d.ts`**. For a
no-bundler page you can also load the global build from a CDN (`unpkg`/`jsdelivr`).

## Getting started (plain JS/TS)

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

const grid = createGrid(document.getElementById('app')!, { columns, keyField: 'id' });
await grid.setData(data);

grid.on('selectionChange', ({ selection }) => {
  console.log('active cell', selection.activeCell);
});
```

The mount element should have a bounded height so virtualization has a window
(e.g. `#app { height: 400px }`). Call `grid.destroy()` to unmount.

## Getting started (React)

```tsx
import { useRef } from 'react';
import { MiniGrid } from '@mini-grid/react';
import type { MiniGridHandle } from '@mini-grid/react';

export function Example() {
  const ref = useRef<MiniGridHandle>(null);
  return (
    <MiniGrid
      ref={ref}
      columns={columns}
      data={data}
      options={{ keyField: 'id', theme: 'light' }}
      onSelectionChange={(e) => console.log(e.selection.activeCell)}
      style={{ height: 400 }}
    />
  );
}
```

Vue (`<MiniGrid :columns :data :options @selection-change>`) and Svelte
(`use:miniGrid={{ columns, data, options }}`) work the same way — see the
[framework adapters guide](docs/guide/framework-adapters.md).

## Capabilities

Every row is an independently toggleable capability (`CAP-*`), off via
`features: { … }` on `createGrid`.

| Area | Capabilities |
| --- | --- |
| Data | `CAP-DATA-BIND` (in-memory array), `CAP-VIRTUALIZE` (~1M rows) |
| Editing | `CAP-EDIT` (5 editors + custom, row/col CRUD), `CAP-VALIDATE`, `CAP-UNDO` |
| Selection | `CAP-SELECT` (multi-range), `CAP-CLIPBOARD` (copy/cut/paste/fill) |
| Formatting | `CAP-FMT-CELL`, `CAP-FMT-VALUE`, `CAP-COND-FMT`, `CAP-THEME` |
| Worksheet | `CAP-SORT`, `CAP-FILTER`, `CAP-RESIZE`, `CAP-REORDER`, `CAP-FREEZE`, `CAP-MERGE`, `CAP-GROUP` |
| Output | `CAP-EXPORT` (CSV + xlsx), `CAP-PERSIST-STATE` |
| Reach | `CAP-I18N` (locale + RTL), `CAP-A11Y` (WCAG 2.1 AA), `CAP-FEATURE-FLAGS` |

## Documentation

- **Guides** — [`docs/guide/`](docs/guide/): getting started, columns & data,
  editing & validation, formatting, sorting & filtering, framework adapters.
- **API reference** — generated with TypeDoc into `docs/api/` (`pnpm docs:api`).
- **Demos** — [`demo/kitchen-sink.html`](demo/kitchen-sink.html) exercises every
  capability with live controls; `demo/index.html` is a 1M-row scroll demo and
  `demo/i18n.html` shows locale + RTL. Serve the repo root over HTTP after
  `pnpm -r build` (the demos load the built ESM directly).

## Monorepo layout

| Path              | Package             | Description                               |
| ----------------- | ------------------- | ----------------------------------------- |
| `packages/core`   | `@mini-grid/core`   | Framework-agnostic grid engine (no deps). |
| `packages/react`  | `@mini-grid/react`  | React adapter (React optional peer).      |
| `packages/vue`    | `@mini-grid/vue`    | Vue adapter (Vue optional peer).          |
| `packages/svelte` | `@mini-grid/svelte` | Svelte adapter (Svelte optional peer).    |
| `demo/`           | —                   | Plain-ESM demo pages (incl. kitchen sink).|
| `docs/`           | —                   | Guides, typechecked examples, API output. |
| `e2e/`            | —                   | Playwright E2E + accessibility tests.     |

## Dev commands

```sh
pnpm install          # install workspace dependencies
pnpm typecheck        # tsc -b across all packages
pnpm test             # vitest unit tests
pnpm -r build         # tsup build (JS + .d.ts) for every package
pnpm e2e              # playwright end-to-end / a11y tests
pnpm docs:api         # generate the TypeDoc API reference into docs/api/
pnpm docs:check       # typecheck the docs examples against the built types
pnpm license-scan     # fail on non-permissive dependency licenses
pnpm changeset        # record a release (lockstep versioning)
```

## License

[MIT](LICENSE) © mini-grid contributors.

The vendored documentation standard under [`dictum/`](dictum/) is [MIT](dictum/LICENSE) © David H. Jung and the Dictum contributors.

## Trademarks

Excel is a registered trademark of Microsoft Corporation. mini-grid is not
affiliated with, endorsed by, or sponsored by Microsoft. References to Excel
describe spreadsheet compatibility and behavioral similarity only.
