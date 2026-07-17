# Formatting & conditional formatting

> Typechecked source: [`docs/examples/formatting.ts`](../examples/formatting.ts).

mini-grid splits Excel-like formatting into three capabilities: cell styling
(`CAP-FMT-CELL`), value masks (`CAP-FMT-VALUE`), and conditional formatting
(`CAP-COND-FMT`). Theming (`CAP-THEME`) restyles the chrome.

## Value masks

A column's `formatMask` maps its raw value to a display string (the underlying
value is never mutated — editing edits raw). Built-in masks are `Intl`-based and
locale-aware:

- `number` · `number:<digits>`
- `currency:<CODE>` · `currency:<CODE>:<digits>` (e.g. `currency:USD`)
- `percent` · `percent:<digits>` (value `0.5` → `50%`)
- `date` · `date:<short|medium|long|full>`

```ts
const columns = [
  { id: 'amount', field: 'amount', header: 'Amount', type: 'number', formatMask: 'currency:USD' },
  { id: 'ratio', field: 'ratio', header: 'Ratio', type: 'number', formatMask: (v) => `${Number(v) * 100}%` },
];
```

A `FormatterFn` (as `ratio` above) gives you full control.

## Cell / range styling

`setStyle(range, style)` writes a sparse overlay keyed by `(rowKey, columnId)`;
properties merge over the cascade. `clearStyle(range)` removes it. Both are undoable.

```ts
import type { CellStyle } from '@mini-grid/core';

const heading: CellStyle = {
  fillColor: '#fff3bf',
  textColor: '#5f3dc4',
  fontWeight: 'bold',
  align: { h: 'center' },
};
grid.setStyle({ top: 0, left: 1, bottom: 0, right: 3 }, heading);
```

`CellStyle` covers `textColor`, `fillColor`, font (`fontFamily`/`fontSize`/
`fontWeight`/`italic`/`underline`), `borders` (per side), `align`, `wrap`, `indent`.

## Conditional formatting

`addConditionalRule(rule)` returns `{ id }` (undoable; remove with
`removeConditionalRule(id)`). Five kinds:

```ts
// 1. value / text rule — a comparison op → a style
grid.addConditionalRule({
  kind: 'value',
  scope: [{ top: 0, left: 3, bottom: 1_000, right: 3 }],
  config: { op: '>', value: 80 },
  style: { fillColor: '#c92a2a', textColor: '#ffffff' },
});

// 2. color scale — gradient over the full-dataset min/mid/max
grid.addConditionalRule({
  kind: 'colorScale',
  scope: [{ top: 0, left: 3, bottom: 1_000, right: 3 }],
  config: { columnId: 'score', min: '#ffffff', mid: '#ffd43b', max: '#2b8a3e' },
});

// 3. data bar — proportional in-cell bar
grid.addConditionalRule({
  kind: 'dataBar',
  scope: [{ top: 0, left: 1, bottom: 1_000, right: 1 }],
  config: { columnId: 'amount', color: '#4263eb' },
});

// 4. icon set — thresholds → a glyph
grid.addConditionalRule({
  kind: 'iconSet',
  scope: [{ top: 0, left: 3, bottom: 1_000, right: 3 }],
  config: { columnId: 'score', icons: [{ min: 0, icon: '🔴' }, { min: 50, icon: '🟢' }] },
});

// 5. custom predicate — (cell) => CellStyle | null
grid.addConditionalRule({
  kind: 'custom',
  scope: [{ top: 0, left: 1, bottom: 1_000, right: 1 }],
  config: { predicate: (cell) => (Number(cell.value) < 100 ? { italic: true } : null) },
});
```

Color scales, data bars, and top-N rules read full-dataset aggregates (computed off
the visible window) and cache them. Bars and icons render as DOM nodes only — never
`innerHTML` of untrusted content (`SEC-RENDERER-DOM-ONLY`).

## Theme & density

```ts
grid.setTheme('dark'); // toggles the mg-theme-{light|dark} class + --mg-* tokens
```

Density (`comfortable` / `compact`) is a construction-time option. Restyle the
chrome by overriding the `--mg-*` CSS custom properties.
