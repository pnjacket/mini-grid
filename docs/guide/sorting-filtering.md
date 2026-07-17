# Sorting & filtering

> Typechecked source: [`docs/examples/sorting-filtering.ts`](../examples/sorting-filtering.ts).

Sort and filter are client-side in v1. Both rebuild the ordered index off the
visible window, are vetoable/notified via events, and are gated by their feature
flags. The header UI (click to sort, ▼ to filter) is wired automatically; the API
below is the programmatic equivalent.

## Sorting

`sort(spec)` takes ordered entries — precedence follows entry order. Empty entries
resets to natural order. Sorting is undoable.

```ts
await grid.sort({
  entries: [
    { columnId: 'category', direction: 'asc' },
    { columnId: 'amount', direction: 'desc' },
  ],
});

grid.getSortSpec();       // the current SortSpec
await grid.sort({ entries: [] }); // clear
```

In the header, click cycles a column's sort; Shift-click adds a secondary key.

## Filtering

`filter(spec)` takes a `FilterPredicate` per column — a function
`(value, ctx) => boolean`. Predicates AND-combine; an empty `perColumn` = all rows
(never an error). Filtering is transient view state (not undoable).

```ts
await grid.filter({ perColumn: { amount: (value) => Number(value) >= 20 } });
```

To match the type-aware header menu, build a predicate from the operator set:

```ts
import { buildFilterPredicate } from '@mini-grid/core';

const predicate = buildFilterPredicate('number', 'gt', '15');
if (predicate) await grid.filter({ perColumn: { amount: predicate } });

await grid.filter({ perColumn: {} }); // clear
```

Operators are type-aware: text (`contains`, `startsWith`, …), number/date (`gt`,
`lt`, `between`, …), plus `blank` / `notBlank`.

## Structure: freeze, resize, reorder, merge, group

These interoperate with sort/filter (e.g. a frozen row stays pinned while sorted).

```ts
grid.setFrozen({ rows: 1, cols: 1 });     // pin leading rows/cols
grid.setColumnWidth('category', 200);      // resize (undoable)
grid.moveColumn('amount', 1);              // reorder (id stays stable)

grid.merge({ top: 0, left: 1, bottom: 0, right: 2 }); // anchor spans; covered cells suppressed
const { id } = grid.group({ axis: 'row', start: 0, span: 2 });
grid.setCollapsed(id, true);               // collapse hides the spanned rows
```

Merge requires a ≥2-cell range and rejects overlaps; groups reject partial
same-axis overlaps. Both are undoable and gated behind their flags.
