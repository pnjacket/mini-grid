---
artifact: product-doc
role: concern
concern-id: user-experience
behavior: module
trigger: interactive_ui
in-scope-subaspects: [screen-specifications, states, user-journeys, component-reuse-design-system-binding, responsive-layout]
current-rung: contract-grade
status: published
version: 1.1.0
---

# User Experience — mini-grid

> One-line: one grid **surface** with layered sub-surfaces (editor, filter menu, context menu, tooltip), every control + state enumerated (incl. client-local **ambient** states), CSS-var theming with comfortable/compact density, and the end-user journeys the real-flow E2E traverses.

## Purpose & Scope

Owns the grid's visual/interaction spec (`SCREEN-*`) and journeys (`JOURNEY-*`). One embeddable component: **no app navigation → no `ROUTE-*`**; sub-surfaces are **layers** (toggle/trigger reachability). a11y/i18n owned by 11.14 (referenced).

## Non-goals / Out-of-scope
- `navigation-ia-contract` — *(absent)* single component; no routing (`ROUTE-*`/`NAV-*` not minted).
- Design-system binding — no component library → the interim reuse rule **defaults out**; what remains is the in-product visual-consistency rule (owned here) + CSS-var theming.

## Requirements

### `SCREEN-GRID` — controls + default/empty states
Guard = **enabling conditions** (no auth): a control is present/active only when its feature flag is on and preconditions hold. Density: **comfortable (default) / compact** preset via `--mg-*` tokens.

| Control | Behavior · default/empty state |
|---|---|
| Column header — label | shows `header ?? id` |
| Column header — **sort** | click cycles asc→desc→none; **Shift-click adds a secondary/tertiary key** (`SortSpec.entries`); `aria-sort` + the sort arrow reflect state on **only the clicked column's affordance-band cell** *(v1.4.1)* — not on its other bands or a spanning cell; default = unsorted |
| Column header — **filter icon** | opens `LAYER-FILTER-MENU`; shown when `column.flags.filterable`; default = no filter (icon inactive) |
| Column header — **resize/reorder** handles | drag to resize width / reorder; shown per `flags.resizable`/`reorderable` |
| Row — **resize** handle | drag bottom border → per-row height override (`rowHeights`); shown per config |
| Row — **group collapse** toggle | present when grouped (`GROUP-NODE`); default = expanded |
| Body **cell** | renders value + resolved style; editable cell opens `LAYER-EDITOR`; default = read display |
| **Dynamic-array spill** *(v1.6, `CAP-FORMULA-ARRAY`)* | an array-formula **anchor** + its projected cells show a `data-mg-spill` **outline** (`LAYER-SPILL-OUTLINE`); non-anchor spill cells are **read-only projections** — a typed edit / F2 / paste is **blocked** and selection **moves to the anchor** (the formula owner), Excel-like. Present only when the `formula` flag is on and a spill is live. |
| **Selection** highlight + **fill handle** | active range shows highlight + a fill handle at the range corner; empty selection = none |
| **Scrollbars** (both axes) | virtualization-driven; reflect logical extent |
| **Header region — column-header bands** *(v1.3, `CAP-HEADER`)* | N configurable column-header rows (`header.columns.bands`); each cell = built-in label/`id` or the `header.columns.render`/`ColumnDef.headerRender` output, with developer **spans/merges** (no imposed hierarchy). Sort/filter/resize affordances sit on the **bottom (primary) band by default, configurable** (`header.columns.affordances`). *(v1.4.1)* clicking a **spanning/merged** header cell (outside an affordance) **line-selects every column the span covers** (`LIB-SELECTION.selectColumns`), not just the first. Band height **resizable** + **multi-line/wrap** when enabled. Default = one label band. |
| **Header region — row-header gutter bands** *(v1.3, `CAP-HEADER`; supersedes v1.2 `CAP-ROW-HEADER`)* | optional frozen **leading-edge** column(s) (trailing edge under RTL); M bands (`header.rows.bands`); per-cell content = `'number'` / `'key'` / custom renderer; `role="rowheader"`. When `header.rows.select` is on, clicking a gutter cell **line-selects the whole row** + Shift-click extends. Row-header **width resizable** when enabled. Shown only when `header.rows` is configured (default **off**). |
| **Header region — corner cell** *(v1.3, `CAP-HEADER`)* | the row-header × column-header intersection; **select-all** on click (`header.corner.selectAll`, default on) + **developer-customizable content** (`header.corner.render`); default = "Select all" affordance. Present only when both header axes exist. *(Replaces the former standalone Select-all corner row.)* |
| **Column management affordances** *(v1.3, `CAP-COLUMN-MANAGE`)* | **hide/show** columns; **leading-edge pin** (RTL-aware; no trailing); **autofit** via double-click the resize handle + a "fit all columns" action. Each shown per its feature flag; hidden columns leave the view; pinned columns stay at the leading edge under scroll. |
| **Header tooltips** *(v1.3, `CAP-HEADER`)* | per-column `headerTooltip` string on hover/focus + **rich** content when the header renderer returns a `Node`; shown when `header.tooltips`. |

**Display states:** `loading` (window pending) · `empty` (no rows / all filtered — distinct copy) · `populated` · `error` (data-op/worker failure via `ERR-*`).
**Interaction/input states:** `focused` · `selection` (**multi-range: disjoint ranges via Ctrl/Cmd+click + row/column line-select via header click + corner select-all + Shift-extend; no checkboxes**) · `editing` · `validating` · `invalid` · `read-only/disabled` · `sorted`/`filtered` indicators · `frozen`/pinned regions · column `hidden` · group `collapsed/expanded` · drag (resize/reorder/fill/range-select/header-band-resize) · RTL.
**Ambient states** (no user action produced them): window arrival (skeleton→fill), sort/filter settling (pending affordance on the header), programmatic update (region re-render), validation-error appearance, worker error. (Announcement of these = A11y `A11Y-GRID` live region.)

### Layers — full contracts (all non-modal, light-dismiss: outside-click/Esc/scroll)
| Layer | Trigger | Controls · states · guard |
|---|---|---|
| `LAYER-EDITOR` | dbl-click / F2 / type-to-replace (remappable) | type-specific editor (text/number/date/checkbox/dropdown/custom); **commit** Enter(↓)/Tab(→), **cancel** Esc; states editing→validating→invalid(`LAYER-VALIDATION-TIP`)/committed; guard = cell editable |
| ↳ **`select` (dropdown) editor** *(v1.1 change)* | opens on the same triggers | the option list renders as an **overlay popover** positioned over the grid (like `LAYER-FILTER-MENU`/`LAYER-CONTEXT-MENU`) — it **must escape the cell's overflow bounds** (the previous clipped-inside-cell rendering is the bug being fixed). Opens below the cell, **flips above** if no room; **scrolls** internally for long lists. Keyboard: ↑/↓ move the highlighted option, **type-ahead** jumps, **Enter** selects + commits, **Esc** cancels; **dismiss** on select / Esc / outside-click / scroll of the grid. |
| ↳ **`boolean` (checkbox) editor** *(v1.1 change)* | opens on trigger; Space toggles | the checkbox **commits its new state on the `change` event (immediately)** — the toggle is applied *before* any blur/focus-loss, so clicking the checkbox can never discard the value (the previous premature-blur-commit that dropped the toggled value is the bug being fixed). |
| `LAYER-FILTER-MENU` | click header filter icon | **type-aware operator** select + value input(s) + Apply/Clear; **empty value = no filter (all)**; states open/applied/cleared; guard = `flags.filterable` |
| `LAYER-CONTEXT-MENU` *(builder-driven v1.4, `CAP-MENU`)* | right-click / long-press / ContextMenu key **on a body cell**, or `openMenu` | **builder-driven** (the one `GridOptions.menu` `MenuBuilder`, `ctx.target.kind==='cell'`); the **default builder** ships today's items: copy/cut/paste · insert row above/below · delete row(s) · insert col left/right · delete col(s) (**no out-of-box regression**). Supports rich items — **submenu · checkbox/toggle · radio · developer-`render` custom** — plus per-item `hidden`/`disabled`; built-ins auto-hide when their flag is off; labels via i18n. States open/item-disabled; light-dismiss |
| `LAYER-HEADER-MENU` *(v1.3, builder-driven v1.4, `CAP-MENU`)* | right-click / long-press / ContextMenu key / menu affordance **on a header cell** (column-header / row-header / corner), or `openMenu` | **dedicated** header menu (separate from `LAYER-CONTEXT-MENU`), driven by the **same** `MenuBuilder` branching on `ctx.target.kind` (`'column-header'`/`'row-header'`/`'corner'`); the **default builder** ships: **sort · filter · hide · show · pin · autofit · insert · delete · group-by**. Same rich item types (submenu/toggle/radio/custom), per-item `hidden`/`disabled`, flag-aware built-ins, and i18n labels as the cell menu. States open/item-disabled; light-dismiss |
| `LAYER-VALIDATION-TIP` | ambient: validation failure | shows `GridError.message`; dismiss on correction/cancel |
| `LAYER-SPILL-OUTLINE` *(v1.6, `CAP-FORMULA-ARRAY`)* | ambient: a dynamic-array spill range intersects the viewport | a non-interactive `data-mg-spill` **halo** around the spill range (anchor + projected cells), mirroring the merge outline; drawn **per visually-contiguous run** when an active sort/filter fragments the canonical-contiguous range (each visible run gets its own halo; projected values are always correct per-cell). Sourced from `LIB-FORMULA-SPILL`; refreshed on `EVT-SPILL-CHANGE`. No trigger/dismiss — present while the spill is live and visible. |

**Built-in filter operators (type-aware):** text → equals/not-equals, contains, starts-with/ends-with, blank/not-blank; number & date → =, ≠, >, <, between, blank/not-blank; plus a **set/list** filter; a custom `FilterPredicate` is always available (Interfaces `LIB-COMPARATOR-API`).

**No built-in modal dialogs** — any confirm (e.g. delete) is host-provided; the modal-inertness bar is **N/A** (nothing background-inert ships). (confirmed)

### User journeys (`JOURNEY-*`) — what the real-flow E2E traverses
| ID | Journey (`PERSONA-USER`) | CAP |
|---|---|---|
| `JOURNEY-BROWSE` | scroll a large dataset, multi-sort (shift-click), filter | `CAP-VIRTUALIZE`/`-SORT`/`-FILTER` |
| `JOURNEY-EDIT` | select → edit → validate → commit → undo | `CAP-EDIT`/`-VALIDATE`/`-UNDO` |
| `JOURNEY-RANGE-OPS` | **disjoint multi-range** (Ctrl/Cmd+click) + header line-select + corner select-all → copy → paste → fill | `CAP-SELECT`/`-CLIPBOARD` |
| `JOURNEY-HEADER` *(v1.3; menu v1.4)* | configure column-header bands + a custom/spanning renderer; hide + leading-pin + autofit a column; multi-range + row/column line-select via headers; corner select-all; open the dedicated header menu built by a **custom `MenuBuilder`** (custom item + submenu + toggle + a built-in-by-`command` id + a flag-hidden built-in) and via **programmatic `openMenu`** | `CAP-HEADER`/`-COLUMN-MANAGE`/`-MENU`/`-SELECT` |
| `JOURNEY-CRUD` | insert/delete rows **and columns** via context menu | `CAP-EDIT` |
| `JOURNEY-STRUCTURE` | resize/reorder, freeze, merge, collapse group | `CAP-RESIZE/REORDER/FREEZE/MERGE/GROUP` |
| `JOURNEY-TOUCH` | tap-select, **long-press → drag handles**, fill, touch-scroll | `CAP-SELECT`/`-CLIPBOARD` |

### Component reuse / theming (themeable tokens)
No component library → in-product visual consistency owned by `SCREEN-GRID`. Restyle via **CSS custom properties** + light/dark theme classes (`mg-theme-{light,dark}`). Token set (`DOM-ROOT`): `--mg-font-family` · `--mg-font-size` · `--mg-cell-padding` *(density)* · `--mg-row-height-default` *(density)* · `--mg-border-color` · `--mg-header-bg`/`--mg-header-color` · `--mg-cell-bg`/`--mg-cell-color` · `--mg-selection-bg`/`--mg-selection-border` · `--mg-active-border` · `--mg-fill-handle-color` · `--mg-frozen-shadow` · `--mg-focus-ring` · `--mg-scrollbar-*`. **Density presets** (comfortable/compact) set `--mg-cell-padding` + `--mg-row-height-default`.

### Responsive / layout
Desktop, **tablet**, **touch/mobile**; small-screen keeps horizontal scroll + frozen panes usable. Touch model = **long-press → range + drag selection handles + fill handle** (locked). Key/pointer maps owned by Interfaces `BIND-KEYS`/`BIND-POINTER` (defaults + remappable); shift-click multi-sort and long-press context menu are `BIND-POINTER` entries.

## Open Questions
- None blocking Contract-grade. *(v1.4: both context menus — the cell `LAYER-CONTEXT-MENU` and the header `LAYER-HEADER-MENU` — are now **builder-driven** by one target-branched `MenuBuilder` (`GridOptions.menu`, `CAP-MENU`); a shipped default builder preserves today's items. The former menu-config deferral is resolved.)*

## Dependencies & Cross-references
- **Realizes:** `CAP-*`. **Drives:** `LIB-*`/`BIND-*`/`DOM-*` (Interfaces). **Bound by:** `A11Y-*` (roles + focus-order refinement).
- **Displays:** `ENTITY-*`. **Guard:** enabling conditions (no `ROLE-*`).

## Examples / Worked scenarios
- *Multi-sort + settle:* shift-click two headers → `SortSpec.entries=[{a,asc},{b,desc}]`; each header shows a pending affordance while the worker rebuilds the index; view reflows on `MSG-INDEX-SUMMARY` (`JOURNEY-BROWSE`).
- *Filter empty = all:* open `LAYER-FILTER-MENU`, clear the value → no filter, all rows return (not an error).

## Design Decisions
| Decision | Rationale |
|---|---|
| One `SCREEN-GRID` + layers; no `ROUTE-*` | Single embeddable component. |
| Default themeable chrome incl. context menu, filter menu | Operator-chosen; "rich spreadsheet presentation." |
| Layers non-modal light-dismiss; no built-in modals | Embeddable; host owns any true modal. |
| Comfortable/compact density via tokens | Operator-chosen; on top of variable row height. |
| Type-aware built-in filter operators + custom predicate | Operator-chosen; covers common needs without host UI. |
| *(v1.4)* Context menus builder-driven; one target-branched `MenuBuilder`; default builder preserves items (`CAP-MENU`) | Cell + header/row/corner menus share one config surface with rich item types (submenu/toggle/radio/custom) without host UI; zero-config keeps today's items (no regression). |
| Shift-click multi-sort | Operator-chosen; familiar Excel/AG-Grid gesture. |
| Ambient-state register first-class | The data worker makes load-bearing states arrive with no click. |

## Contracts
`SCREEN-GRID` (controls — incl. the v1.3 header region: column-header bands, row-header gutter bands, corner, column-manage affordances, tooltips — + default/empty states + display/interaction/ambient states + guard + driven `LIB-*`/`BIND-*` surface), the **six** `LAYER-*` contracts (incl. `LAYER-CONTEXT-MENU` + `LAYER-HEADER-MENU`, both builder-driven under `CAP-MENU`, and the v1.6 `LAYER-SPILL-OUTLINE`), the `JOURNEY-*` set (incl. `JOURNEY-HEADER`), and the themeable-token list above **are** the contracts.

## Acceptance criteria
- **AC-CONTROLS:** every `SCREEN-GRID`/layer control operates from its default/empty state with a non-error outcome (real-flow E2E, `E2E-STANDARD`).
- **AC-AMBIENT:** each ambient state renders its affordance without user action (worker settle → header pending; window arrival → skeleton→fill).
- **AC-FILTER-EMPTY:** clearing a filter returns all rows (not an error).
- **AC-MULTISORT:** shift-clicking a second header adds a secondary sort key.
- **AC-THEME:** overriding `--mg-*` tokens restyles the grid; compact density reduces row height/padding.
- **AC-NO-MODAL:** no built-in surface traps the background (there are no modals; layers light-dismiss).

