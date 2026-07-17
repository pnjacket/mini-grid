# demo

Plain-ESM demo pages for `@mini-grid/core` — no bundler. Served from the repo
root, they import the built ESM from `../packages/core/dist/index.js`, so run
`pnpm -r build` first, then serve the repo root over HTTP (e.g.
`python3 -m http.server 5173`).

| Page | What it shows |
| --- | --- |
| [`kitchen-sink.html`](kitchen-sink.html) | The showcase — every `CAP-*` with live controls (editing/validation, sort/filter, resize/reorder/freeze/merge/group, conditional formatting, clipboard, CSV/xlsx export, undo/redo, theme/density, locale/RTL, a feature-flag panel, plus the v1.3/v1.4 header region + column management + configurable menus + multi-range selection). Doubles as the SUCCESS-DX E2E harness (`e2e/kitchen-sink.spec.ts`). |
| [`index.html`](index.html) | A 1,000,000-row grid for the scroll-perf harness. |
| [`i18n.html`](i18n.html) | Locale-aware formatting + RTL mirroring. |
| [`header.html`](header.html) | `CAP-HEADER` — the unified header region: multi-band column headers with spans, a frozen row-number gutter, a select-all corner, tooltips, band/gutter resize, plus `CAP-COLUMN-MANAGE` hide/show/pin/autofit. |
| [`menu.html`](menu.html) | `CAP-MENU` — one target-branched `MenuBuilder` driving both the body-cell and header context menus (built-ins by command id, a custom node, a submenu, checkbox + radio items). |

All pages run headless under Playwright.
