---
artifact: product-doc
role: concern
concern-id: product-and-requirements
behavior: core
trigger: always
in-scope-subaspects: [problem-motivation, target-users-personas, goals-success-criteria, capability-register, constraints-assumptions, risks]
current-rung: contract-grade
status: published
version: 1.1.0
---

# Product & Requirements — mini-grid

> One-line: a programmatic, framework-agnostic JavaScript data-grid that gives web developers an Excel-worksheet-like presentation and data-entry surface over large datasets — with Excel-like in-cell formulas available as a first-class **opt-in** capability (`formula` flag, default off).

## Purpose & Scope

**Problem & motivation.** Web developers who need to present and edit tabular data at scale face a gap: lightweight table libraries don't offer Excel-grade styling, conditional formatting, or rich data entry; full grid suites are heavy, opinionated, hard to style like a real worksheet, and often weak on very large datasets and accessibility. mini-grid exists to give developers a **programmatic, Excel-worksheet-like grid** they drive entirely from code — every visual and behavioral aspect settable via API, every feature independently toggleable — that stays fast at ~1M rows and is accessible by default.

**What it is.** A **library**: a framework-agnostic TypeScript core plus optional React/Vue/Svelte adapters, embeddable in a plain HTML page or any framework. It renders to **virtualized DOM**. Excel-like in-cell **formulas** are a first-class **opt-in** capability (`formula` flag, default off — a leading `=` stays literal text unless enabled); in v1 it is a **single sheet** (no cross-worksheet references).

This concern owns the canonical **capability register** (`CAP-*`), **personas** (`PERSONA-*`), and **success criteria** (`SUCCESS-*`) that the rest of the doc set traces against. Non-functional *targets* (fps, latency, WCAG level) are **owned by their home concerns** and only referenced here.

## Non-goals / Out-of-scope

- **Of the formula surface** (in scope since v1.5 — `CAP-FORMULA` + its extensions; the pre-v1.5 blanket exclusion is superseded): still out are **cross-worksheet references** *(absent — single sheet, no worksheets)*; the **~30 architecturally-blocked catalog functions** (network/OS/workbook-context, incl. `INFO` — each enumerated with its blocking fact in `formula-support.md` Non-goals) *(absent)*; and **named ranges, structured table refs, whole-column/row refs (`A:A`), iterative calc, live-`=…` `.xlsx` export, and fill/paste relative-ref translation** *(deferred — [FUTURE-SCOPE], see [`formula-support.md`](../formula-support.md))*.
- **Multi-sheet / workbook** (tabs) — v1 is a **single sheet**. *(deferred — [FUTURE-SCOPE] post-v1)*
- **Server-side data-source adapter & server-side sort/filter/paging** — designed as an extension point; implementation *(deferred — [FUTURE-SCOPE] v2)*.
- **Aggregation / summary row** (header-region totals, per-column aggregates rendered in a pinned summary band) — the header subsystem is developer-populated with **no imposed structure**, and a built-in aggregation/summary surface is **not in scope**. *(deferred — [FUTURE-SCOPE] post-v1; a developer can render arbitrary content into a header band today, but the grid ships no aggregation engine or summary-row contract.)*
- `market-competitive-context` — *(absent)* not build-relevant for this component.
- `stakeholders-decision-makers` — *(absent)* single-owner OSS library.

## Requirements

### Personas (`PERSONA-*`)

| ID | Persona | Who / why | Referenced by |
|---|---|---|---|
| `PERSONA-DEV` | **Integrating web developer** (primary) | Embeds mini-grid to deliver a rich, Excel-like data surface without building a grid from scratch. Works through the programmatic TypeScript API: binds data, sets styling/formatting, wires editing/validation, toggles features. Values total in-code control, framework-agnosticism, large-data performance, and built-in accessibility. Pain today: grids that are heavy, hard to style like Excel, slow at scale, or inaccessible. | Interfaces (API surface), Architecture (adapters), Domain, Security (config trust) |
| `PERSONA-USER` | **End-user of the rendered grid** | The person interacting with the grid on screen — scrolls, selects, edits cells, copies/pastes, sorts, filters, resizes. Expects familiar, Excel-like, keyboard-fluent behavior. Pain today: laggy grids, missing keyboard support, unfamiliar interactions. | UX (journeys), Domain (user entity), Security (maps to roles), A11y |

### Capability register (`CAP-*`) — the traceability spine

All capabilities are **in-scope for v1** unless the Scope column says otherwise. Every capability is **individually toggleable** (see `CAP-FEATURE-FLAGS`). Persona key: **D** = `PERSONA-DEV`, **U** = `PERSONA-USER`.

| ID | Capability | Description | Persona | Scope | Success |
|---|---|---|---|---|---|
| `CAP-DATA-BIND` | Data binding | Bind an **in-memory array** data source; async **DataSource adapter** exposed as a designed extension point. | D | v1 (adapter impl **deferred v2**) | `SUCCESS-DATA-BIND` |
| `CAP-VIRTUALIZE` | Virtualized rendering | DOM row/column virtualization: render only visible cells to handle ~1M rows. | D·U | v1 | `SUCCESS-LARGE-DATA` |
| `CAP-EDIT` | Cell editing / data entry | Inline editors: text, number, date/time, boolean (checkbox), dropdown, and a **custom-editor** plug-in API; plus **row and column insert/delete** (CRUD). | U·D | v1 | `SUCCESS-EDIT-ROUNDTRIP` |
| `CAP-VALIDATE` | Data validation | Built-in rules (type, range, list, required, regex) + inline error feedback + **custom validator** hook. | U·D | v1 | `SUCCESS-EDIT-ROUNDTRIP` |
| `CAP-UNDO` | Undo / redo | Built-in edit history **and** consumer change-hooks; either, or disabled. | U·D | v1 | `SUCCESS-EDIT-ROUNDTRIP` |
| `CAP-SELECT` | Selection | **Full multi-range** selection via mouse/touch/keyboard: a **set of disjoint ranges** (Ctrl/Cmd+click adds a range), **row/column line-selection** by clicking a header (row-header → whole row; column-header → whole column), **Shift-extend** the active range, and **select-all** via the corner cell. **No checkboxes, ever.** *(changed v1.3 — `breaking`: selection state becomes a **range-set**, superseding the single-range + shift-extend model; see `ENTITY-SELECTION`, `CAP-HEADER` corner + line-select.)* | U | v1 | `SUCCESS-SELECT-CLIP` |
| `CAP-CLIPBOARD` | Clipboard & fill | Copy/cut/paste to system clipboard (TSV) + drag **fill handle**; down-configurable to selection-only. | U | v1 | `SUCCESS-SELECT-CLIP` |
| `CAP-FMT-CELL` | Cell/range formatting | Programmatic Excel-like styling per cell/range: **text (fore) color, fill (back) color, font** (family/size/weight/italic/underline), **borders** (per side/style/color), **alignment** (h/v), wrap, indent. | D | v1 | `SUCCESS-STYLE-API` |
| `CAP-FMT-VALUE` | Value formatting | Number/currency/percent/date display formats via Excel-like masks or format functions (locale-aware, see `CAP-I18N`). | D | v1 | `SUCCESS-STYLE-API` |
| `CAP-COND-FMT` | Conditional formatting | Value/text rules, color scales, data bars, icon sets, and a **custom predicate** returning a style. | D | v1 | `SUCCESS-COND-FMT` |
| `CAP-SORT` | Sorting | Single/multi-column sort (client-side v1). | U·D | v1 | `SUCCESS-SORT-FILTER` |
| `CAP-FILTER` | Filtering | Per-column filtering, UI + API (client-side v1). | U·D | v1 | `SUCCESS-SORT-FILTER` |
| `CAP-RESIZE` | Resize | Drag to resize column widths / row heights. | U | v1 | `SUCCESS-WORKSHEET-FNS` |
| `CAP-REORDER` | Reorder | Drag to reorder columns (rows optional). | U | v1 | `SUCCESS-WORKSHEET-FNS` |
| `CAP-FREEZE` | Frozen panes | Pin/freeze rows and columns so they stay visible while scrolling. | D·U | v1 | `SUCCESS-WORKSHEET-FNS` |
| `CAP-MERGE` | Cell merge | Merge cells across rows/columns (anchor + span). *Complex — confirmed v1.* | D | v1 | `SUCCESS-WORKSHEET-FNS` |
| `CAP-GROUP` | Grouping / outline | Row/column grouping with collapsible outlines. *Complex — confirmed v1.* | D·U | v1 | `SUCCESS-WORKSHEET-FNS` |
| `CAP-EXPORT` | Export | Export current data/view to **CSV** (no dep) and **Excel .xlsx** (optional lib). | U·D | v1 | `SUCCESS-EXPORT` |
| `CAP-PERSIST-STATE` | State persistence | Serialize/restore grid state (column widths, order, sort, filters) for save/restore of layouts. | D | v1 | `SUCCESS-PERSIST` |
| `CAP-THEME` | Theming | Built-in light/dark themes + CSS custom properties to restyle the grid chrome. | D | v1 | `SUCCESS-STYLE-API` |
| `CAP-I18N` | i18n & RTL | Locale-aware number/date formatting, externalized strings, and full right-to-left layout. | D·U | v1 | `SUCCESS-I18N` |
| `CAP-A11Y` | Accessibility | Full ARIA-grid semantics + keyboard-complete operation + screen-reader support. | U | v1 | `SUCCESS-A11Y` |
| `CAP-FEATURE-FLAGS` | Feature flags | Every capability above independently on/off; disabling one removes its affordance and cost. | D | v1 | `SUCCESS-FEATURE-TOGGLE` |
| ~~`CAP-ROW-HEADER`~~ | ~~Row-header gutter~~ | **RETIRED v1.3** — superseded by `CAP-HEADER` (the row-header gutter is now the `header.rows` axis of the unified, symmetric header subsystem). Was unbuilt (doc-only slice 16). *(tombstone → `CAP-HEADER`)* | — | ~~v1.2~~ retired | — |
| `CAP-HEADER` | Header subsystem | *(v1.3)* Unified, **fully symmetric** header **region** on both axes — **developer-populated with NO imposed structure**. **Configurable band count** (N column-header rows via `header.columns.bands`; M row-header columns via `header.rows.bands`). A **header-cell renderer** receives `(axis, band, columnId\|rowKey, indices, data)` and returns content; the developer may **span/merge** header cells freely (**no parent/child hierarchy is assumed or imposed**). Built-in **content helpers** are just conveniences: column label/`id`, row `'number'`/`'key'`. **Corner cell** (row-header × column-header intersection) = select-all + developer-customizable content. **Tooltips** (per-column `headerTooltip` string **+** rich content via the renderer). **Header sizing**: row-header width + column-header band height, **resizable** bands, **multi-line/wrapping** labels — each independently toggleable. **Affordance placement**: sort/filter/resize live on the column's **bottom (primary) band by default, configurable**. **Every sub-behavior independently enable/disable-able.** | D·U | v1 (v1.3) | `SUCCESS-HEADER` |
| `CAP-COLUMN-MANAGE` | Column management | *(v1.3)* **Hide/show** columns; **leading-edge pin** only (RTL-aware; extends the existing leading-prefix freeze — **no trailing pin**); **autofit** column width (double-click the resize handle to fit, plus a **fit-all-columns** API/menu action, bounded to visible/sampled content). Each independently toggleable. | D·U | v1 (v1.3) | `SUCCESS-COLUMN-MANAGE` |
| ~~`CAP-HEADER-MENU`~~ | ~~Header context menu~~ | **RETIRED v1.4** — generalized into `CAP-MENU` (configurable context menus spanning the cell + header/row/corner surfaces). Was unbuilt (doc-only slice 20). *(tombstone → `CAP-MENU`)* | — | ~~v1.3~~ retired | — |
| `CAP-FORMULA` | Excel-like in-cell formulas | *(v1.5 baseline; extended by `CAP-FORMULA-FN`/`-VOLATILE`/`-REFVAL`/`-ARRAY`)* Opt-in (`formula` flag, default off) **in-cell formulas**: a cell whose raw value starts with `=` is parsed to an AST and evaluated in **A1 notation** against other cells — a **475-function library** + 9 evaluator special forms (from v1.5's ~70; see `CAP-FORMULA-FN` / `docs/formula-functions.md`), cell + **range** references, absolute/relative (`$A$1`), the **nine** typed error values (the seven core `#DIV/0!`…`#CIRC!` + `#SPILL!`/`#CALC!`), and **cycle-detecting incremental recalculation**. The **computed result** flows through the existing derived-value pipeline (sort/filter/format/export/aggregate see the *result*; editing sees the *formula string*). Single-sheet → **no cross-sheet references** (by definition). Gated + tree-shaken by the flag (`CAP-FEATURE-FLAGS`). | D·U | v1 (v1.5) | `SUCCESS-FORMULA` |
| `CAP-FORMULA-FN` | Formula function library | *(v1.5 minted at ~70; extended v1.6 → 455, completed v1.7 → 475)* The **registry of pure `(args) => value \| RangeValue` functions** the formula evaluator exposes — **475 registry functions + 9 evaluator special forms** (`LET`/`LAMBDA`/`MAP`/`REDUCE`/`SCAN`/`BYROW`/`BYCOL`/`MAKEARRAY`/`ISOMITTED`) spanning math/trig, statistical (incl. distributions), financial (incl. odd-period bonds), date/time, text, information, engineering, database, lookup, and the `*IFS` family, plus the v1.7 array-result set (`TREND`/`GROWTH`/`LINEST`/`LOGEST`, matrix, `GROUPBY`/`PIVOTBY`). The **exhaustive named catalog** — every function, category, arity, tag — lives in [`docs/formula-functions.md`](../formula-functions.md); the catalog is **honestly closed** (the ~30 architecturally-blocked functions are enumerated with their blocking facts). Semantics owned by [`docs/formula-support.md`](../formula-support.md); no public API element (functions are registry entries). | D·U | v1 (v1.5→v1.7) | `SUCCESS-FORMULA-CATALOG` |
| `CAP-MENU` | Configurable context menus | *(v1.4, generalizes the retired `CAP-HEADER-MENU`)* **Builder-driven** context menus for **both** the body-**cell** menu and the dedicated **column-header / row-header / corner** menus. A **single** `MenuBuilder` (`GridOptions.menu`) branches on `ctx.target.kind` to produce each surface; a **default builder ships** so zero-config keeps today's cell items **and** the header items (**no out-of-box regression**), `'default'` references it, a custom builder replaces it, `false` disables. Items offer **built-ins two ways** (importable `builtinItems.*` factories **and** raw `command` ids — grid supplies behavior, developer supplies presentation), rich **item types** (action · separator/group · submenu · checkbox/toggle · radio · developer-`render` custom), per-item `hidden`/`disabled`, **feature-flag-aware** built-ins (auto-hide when their capability is off), i18n labels, and a **programmatic** `openMenu(target, position)`. Synchronous in v1. | D·U | v1 (v1.4) | `SUCCESS-MENU` |
| `CAP-FORMULA-VOLATILE` | Volatile recalculation | *(v1.6, additive)* Formula functions whose value can change **without any precedent changing** recompute on **every** recalc — the volatile set `NOW TODAY RAND RANDBETWEEN RANDARRAY OFFSET INDIRECT INFO CELL`. The incremental dirty closure is seeded with `edited ∪ volatileCells` (`INV-FORMULA-VOLATILE`), so editing *any* cell re-rolls every `RAND` and re-evaluates every `NOW` (Excel semantics). Extends the built `CAP-FORMULA` engine; gated by the `formula` flag. | D·U | v1 (v1.6) | `SUCCESS-FORMULA-VOLATILE` |
| `CAP-FORMULA-REFVAL` | Reference values | *(v1.6, additive)* A **reference** value type in the evaluator (distinct from a materialized array) enabling functions that *return*/*transform* references — `OFFSET INDIRECT INDEX`(reference form)`/ADDRESS` (+ `ROW`/`COLUMN`/`ROWS`/`COLUMNS` over references). `OFFSET`/`INDIRECT` targets are dynamic ⇒ the containing formula is **volatile** (`INV-REF-DYNAMIC-DEP`, binds to `CAP-FORMULA-VOLATILE`); an out-of-grid reference → `#REF!` (`INV-REF-INGRID`). Evaluator/engine extension of the built `CAP-FORMULA`. | D·U | v1 (v1.6) | `SUCCESS-FORMULA-REFVAL` |
| `CAP-FORMULA-ARRAY` | Dynamic-array spill engine | *(v1.6, additive)* A formula may compute to a **rectangular array** that **spills** into the anchor + the cells below/right (anchor-owns-range, mirroring `CAP-MERGE`) — `FILTER SORT SORTBY UNIQUE SEQUENCE XLOOKUP TRANSPOSE HSTACK/VSTACK …` + the `LAMBDA`/`LET`/`MAP`/`REDUCE`/`SCAN`/`BYROW`/`BYCOL` family. A blocked spill shows `#SPILL!`, an array-calc error `#CALC!`; the `A1#` spill reference addresses the anchor's current spill range; spilled values flow through the derived pipeline. **The largest v1.6 capability.** Extends the built `CAP-FORMULA` engine + `COMPONENT-RENDER`; gated by the `formula` flag. | D·U | v1 (v1.6) | `SUCCESS-FORMULA-ARRAY` |
| `CAP-FORMULA-INTERSECT` | Implicit-intersection `@` | *(v1.7, additive)* A prefix **`@` operator** coercing an array/range/reference to a **single value** by intersecting with the formula cell's own row/column (`=@A1:A10` picks the current row's cell); a 1×1 stays itself, no intersection → `#VALUE!`, and an `@`-prefixed sub-expression never spills (`INV-INTERSECT-SCALAR`). The one v1.7 catalog-completion item needing an engine (parser/evaluator) change; gated by the `formula` flag. | D·U | v1 (v1.7) | `SUCCESS-FORMULA-INTERSECT` |

### Goals & success criteria (`SUCCESS-*`)

Observable product-level outcomes. NFR-shaped criteria are **pointers** to the owning concern's target (measurable there).

| ID | Success criterion |
|---|---|
| `SUCCESS-LARGE-DATA` | Renders and scrolls a **1M-row** dataset while meeting the performance budget → **pointer to `PERF-*`** (Performance & Scalability). |
| `SUCCESS-A11Y` | Meets **WCAG 2.1 AA** and is fully keyboard-operable → **pointer to `A11Y-*`** (Accessibility & i18n). |
| `SUCCESS-EDIT-ROUNDTRIP` | An end-user edits a cell, passes validation, commits, and the change survives serialize→restore/reload; undo reverts it. |
| `SUCCESS-STYLE-API` | A developer sets fore/back color, font, borders, alignment, and a value-format mask on a cell/range **entirely via the API** and sees it rendered; themes apply via CSS vars. |
| `SUCCESS-COND-FMT` | A developer defines a conditional rule (e.g. value > X → red fill) and only matching cells render the style; a custom-predicate rule works. |
| `SUCCESS-SELECT-CLIP` | Multi-range select + copy/paste round-trips TSV with the system clipboard; fill-handle propagates values. |
| `SUCCESS-SORT-FILTER` | Sorting and filtering (client-side) reorder/subset the visible rows correctly and update indicators. |
| `SUCCESS-WORKSHEET-FNS` | Resize, reorder, freeze, merge, and group each behave correctly and interoperate (e.g. frozen + sorted). |
| `SUCCESS-EXPORT` | Exported CSV and .xlsx reflect current data and applied formats. |
| `SUCCESS-PERSIST` | Grid state serializes and restores column widths, order, sort, and filters faithfully. |
| `SUCCESS-I18N` | Locale formatting and RTL render correctly; UI strings are externalized. |
| `SUCCESS-DATA-BIND` | Binding an in-memory array renders the data; the async DataSource interface is defined (impl deferred v2). |
| `SUCCESS-FEATURE-TOGGLE` | Every capability can be disabled via config; when off, its affordance and cost are absent. |
| `SUCCESS-HEADER` | With `header` configured, the grid renders the requested column-header **bands** (N rows) and row-header **bands** (M cols); the per-cell **renderer** output appears with any declared **col/row spans**; built-in helpers (`'number'`/`'key'`, column label/`id`) render; the **corner** shows custom content and select-all works; `headerTooltip` + rich renderer tooltips show; band **resize**, **wrap**, and **band-height/row-header-width** apply; sort/filter/resize affordances sit on the configured band. Every sub-behavior is independently on/off. Off by default (no `header` → today's single default header row). |
| `SUCCESS-COLUMN-MANAGE` | Hiding a column removes it from the view (and index projection); showing restores it; a leading-pinned column stays visible at the leading edge while scrolling (trailing edge under RTL); autofit (double-click handle) and fit-all size columns to their visible content. |
| `SUCCESS-MENU` | Zero-config, **both** the cell menu (copy/cut/paste/insert/delete) and the header/row/corner menu (sort/filter/hide/show/pin/autofit/insert/delete/group-by) open with their default items, each invoking its action or disabled/hidden per feature flag; a **custom `MenuBuilder`** replaces them (custom item + submenu + toggle + built-in-by-`command` id, a flag-off built-in auto-hides); `openMenu(target, position)` opens programmatically; `menu:false` disables — all light-dismiss. |
| `SUCCESS-FORMULA` | *(v1.5)* With the `formula` flag on, a user authors `=SUM(A1:A3)+B1*2` and the cell shows the **computed result**; sort/filter/format/export operate on that result while the cell **editor shows the formula string**; editing an upstream cell **incrementally** recomputes its dependents; a reference cycle yields `#CIRC!` without hanging. |
| `SUCCESS-FORMULA-CATALOG` | *(v1.6, additive; completed v1.7)* A user finds the Excel function they expect — the library covers the **full pure** scalar/range catalog — **475 registry functions** + 9 evaluator special forms (statistical, financial, engineering, database, … + the `*IFS` family), each matching its Excel result; the named catalog (`docs/formula-functions.md`) is honestly closed (out-of-scope functions enumerated with their blocking fact). |
| `SUCCESS-FORMULA-VOLATILE` | *(v1.6, additive)* Editing an unrelated cell re-rolls every `RAND`/`RANDBETWEEN` and re-evaluates `NOW`/`TODAY` across the sheet (Excel volatile semantics), while a non-volatile, non-dependent cell is untouched. |
| `SUCCESS-FORMULA-REFVAL` | *(v1.6, additive)* `OFFSET`/`INDIRECT`/`INDEX`(ref)/`ADDRESS` return/transform references — `SUM(OFFSET(A1,0,0,3,1))=SUM(A1:A3)`, `INDIRECT("A"&2)=A2` — and an out-of-grid reference resolves to `#REF!`. |
| `SUCCESS-FORMULA-ARRAY` | *(v1.6, additive)* One formula, many results — `=FILTER(A1:A9,B1:B9>0)` / `=SEQUENCE(3)` **spills** into a rectangular range that grows/shrinks on recompute, blocks with `#SPILL!` when obstructed, is addressable via `A1#`, and whose spilled values sort/filter/export as their projected values. |
| `SUCCESS-FORMULA-INTERSECT` | *(v1.7, additive)* A user authors `=@A1:A10` and the cell resolves the **single value on its own row** (Excel `@` implicit-intersection parity); `@` on a 1×1 is identity and on a non-intersecting array yields `#VALUE!`. |
| `SUCCESS-DX` | An adopter installs the package, follows the README/getting-started, and renders + edits a grid; the **demo page** exercises every `CAP-*`. *(Developer-experience: docs + demo are deliverables, not grid capabilities.)* |
| `SUCCESS-FRAMEWORK-AGNOSTIC` | The grid mounts and functions in plain HTML and via each provided framework adapter. |

**Observable check per `SUCCESS-*` (Contract-grade — each binds to a Quality test / owning-concern target):**

| `SUCCESS-*` | Observable check |
|---|---|
| `SUCCESS-LARGE-DATA` | **pointer → `PERF-SCROLL`/`PERF-SORT`** over `SEQ-*` on the reference machine (Performance perf tier) |
| `SUCCESS-A11Y` | **pointer → `A11Y-GRID`** — axe zero violations + keyboard-only journey + live-region assertions (a11y tier) |
| `SUCCESS-EDIT-ROUNDTRIP` | `JOURNEY-EDIT` E2E: edit→validate→commit→serialize→restore reflects the value; undo reverts (Domain `AC-DERIVED`) |
| `SUCCESS-STYLE-API` | programmatic style set + **computed-style assertion**; theme via CSS vars (E2E/component) |
| `SUCCESS-COND-FMT` | a value rule + a custom predicate → matching cells carry the resolved style (computed-style assertion) |
| `SUCCESS-SELECT-CLIP` | `JOURNEY-RANGE-OPS` E2E: **disjoint multi-range** (Ctrl/Cmd+click adds ranges) + **header line-select** (row/column) + **corner select-all** + Shift-extend; copy/paste round-trips TSV over the range-set; fill propagates — **no checkboxes** |
| `SUCCESS-SORT-FILTER` | async sort/filter reorder/subset visible rows + indicators (E2E; `INV-*`) |
| `SUCCESS-WORKSHEET-FNS` | resize/reorder/freeze/merge/group behave + interoperate (e.g. frozen+sorted) — `JOURNEY-STRUCTURE` |
| `SUCCESS-EXPORT` | exported CSV/xlsx reflect current view + formats (unit mapping + E2E) |
| `SUCCESS-PERSIST` | `serializeState`→`restoreState` round-trips widths/order/sort/filters (Interfaces `AC-STATE-VERSION`) |
| `SUCCESS-I18N` | locale formatting + RTL render correctly; strings externalized (i18n tier) |
| `SUCCESS-DATA-BIND` | in-memory array renders; DataSource interface defined (adapter impl deferred v2) |
| `SUCCESS-FEATURE-TOGGLE` | every capability disables via config → no affordance/cost (Quality flag matrix, `AC-FLAGS`) |
| `SUCCESS-FRAMEWORK-AGNOSTIC` | grid mounts + works in plain HTML and via each adapter (adapter integration E2E) |
| `SUCCESS-FORMULA` | `AC-FORMULA-*` (Quality): unit eval (`AC-FORMULA-EVAL`) + chain/cycle/incremental (`AC-FORMULA-CHAIN`/`-CYCLE`/`-INCREMENTAL`) + a derived-pipeline E2E (`AC-FORMULA-DERIVED`: sort/filter/editor/CSV) + the ≥300k-cell demo (`AC-FORMULA-DEMO`); no-regression via `PERF-FORMULA-NEUTRAL` |
| `SUCCESS-FORMULA-CATALOG` *(v1.6)* | `AC-FORMULA-CATALOG` (Quality): a unit test per pure-tagged function asserts a known input→output; the `*IFS` family matches Excel multi-criteria results (`docs/formula-functions.md` the catalog source) |
| `SUCCESS-FORMULA-VOLATILE` *(v1.6)* | `AC-FORMULA-VOLATILE` (Quality): editing an unrelated cell re-rolls every `RAND` + re-evaluates `NOW`/`TODAY`; a non-volatile non-dependent cell is untouched |
| `SUCCESS-FORMULA-REFVAL` *(v1.6)* | `AC-FORMULA-REFVAL` (Quality): `SUM(OFFSET(A1,0,0,3,1))=SUM(A1:A3)`, `INDIRECT("A"&2)=A2`, an OFFSET/INDIRECT formula flagged volatile |
| `SUCCESS-FORMULA-ARRAY` *(v1.6)* | `AC-FORMULA-ARRAY-SPILL`/`-RESIZE`/`-DERIVED` (Quality): unit array eval + component + E2E — spill materialize/collide(`#SPILL!`)/resize, `A1#`, and spilled values through the derived pipeline |
| `SUCCESS-FORMULA-INTERSECT` *(v1.7)* | `AC-FORMULA-INTERSECT` (Quality, unit): `=@A1:A3` in row 2 = `A2`; `@` on a 1×1 is identity; `@` on a non-intersecting array → `#VALUE!`; an `@`-prefixed sub-expression never spills (`INV-INTERSECT-SCALAR`) |
| `SUCCESS-DX` | E2E over the **demo page** asserts it mounts and exercises every `CAP-*` (capability showcase); a **docs-example compile/typecheck** check + README-getting-started smoke (Quality) |
| `SUCCESS-HEADER` | `JOURNEY-HEADER` E2E: `header.columns.bands:2` → two `role="row"` header bands with `aria-colspan`/`data-band`; a custom `header.columns.render` returning `{content, colSpan}` merges cells; `header.rows.content:'number'` → row-header gutter shows 1..N (`role="rowheader"`); corner (`role`) renders custom content + select-all; band resize/wrap + `headerTooltip` assert; each toggled off removes only its affordance |
| `SUCCESS-COLUMN-MANAGE` | E2E: `hideColumn(id)` drops the column from the DOM + index projection, `showColumn(id)` restores; `pinColumn(id,'leading')` keeps it at the leading edge under scroll (trailing under RTL); `autofitColumn`/`autofitAllColumns` set widths to fit visible content (bounded measure) |
| `SUCCESS-MENU` | E2E (`JOURNEY-HEADER`/`JOURNEY-RANGE-OPS`): default builder → cell + header menus present their default items (each fires or is disabled per flag); a **custom `MenuBuilder`** renders a custom item + submenu + toggle + a built-in-by-`command` id + a flag-hidden built-in; `openMenu` opens programmatically; Esc/outside-click dismisses |

Both NFR-pointer criteria resolve to a home-concern owner: `PERF-*` (Performance & Scalability, Contract-grade) and `A11Y-*` (Accessibility & i18n). Their exact thresholds are measurable at the owner (perf thresholds calibrated by the Slice-0 spike — six of the eight v1 targets frozen from measurement, the remainder `[PROVISIONAL]` at the owner; WCAG 2.1 AA).

### Constraints & assumptions (`constraints-assumptions`)

**Constraints:**
- Authored in **TypeScript**; ships JS + `.d.ts`.
- **Framework-agnostic core + optional adapters**; **zero required runtime dependencies** in the core (frameworks and xlsx lib are peer/optional).
- Target platforms: **evergreen desktop browsers + touch/tablet**; legacy browsers out of scope.
- Escape-by-default rendering (Security) constrains how cell content/custom renderers are drawn.

**Assumptions:**
- Bundle kept **lean and tree-shakeable** with no hard numeric ceiling — a confirmed **goal, not a contract**.
- `CAP-MERGE` and `CAP-GROUP` are **confirmed in v1** despite their complexity; sequenced late in the build playbook (Delivery) to contain risk.
- Client-side data ops in v1; async/server delegation deferred to v2.

### Risks (`risks`)
- Client-side sort/filter of 1M rows may exceed the frame/latency budget → mitigation: perf-calibration spike + optional web-worker offload (Performance).
- `CAP-MERGE` + `CAP-GROUP` + virtualization interactions are a complexity hotspot → mitigation: sequence them late in the build playbook (Delivery).
- Breadth of toggleable features risks combinatorial interaction bugs → mitigation: feature-flag on/off test matrix (Quality).

## Open Questions
- Confirm published **npm package name** = `mini-grid` (availability/trademark). [REVISIT]

## Dependencies & Cross-references
- **Owned here, referenced everywhere:** `CAP-*`, `PERSONA-*`, `SUCCESS-*`.
- **Referenced (not owned):** performance targets `PERF-*` (Performance & Scalability); accessibility level `A11Y-*` / WCAG 2.1 AA (Accessibility & i18n). These resolve to their home concerns.

## Examples / Worked scenarios
- *Developer, large data + styling:* `PERSONA-DEV` binds a 1M-row array (`CAP-DATA-BIND`, `CAP-VIRTUALIZE`), applies a value-format mask + red-fill conditional rule to a column (`CAP-FMT-VALUE`, `CAP-COND-FMT`), freezes the header row (`CAP-FREEZE`), and disables editing (`CAP-FEATURE-FLAGS`). Verifies `SUCCESS-STYLE-API`, `SUCCESS-COND-FMT`, `SUCCESS-LARGE-DATA`.
- *End-user, data entry:* `PERSONA-USER` filters (`CAP-FILTER`), edits a cell through a dropdown editor with validation (`CAP-EDIT`, `CAP-VALIDATE`), undoes it (`CAP-UNDO`), then copies a range and pastes (`CAP-CLIPBOARD`). Verifies `SUCCESS-EDIT-ROUNDTRIP`, `SUCCESS-SELECT-CLIP`.

## Design Decisions
| Decision | Rationale |
|---|---|
| Formula engine ships **opt-in** (`formula` flag, default off) | Presentation & entry is the default posture; formulas are a first-class capability but off by default so a leading `=` stays literal text and existing hosts see no behavior change (`CAP-FORMULA`). |
| Virtualized DOM (not Canvas) | Testability/E2E for automated verification + native styling/editing/a11y. (Architecture ADR.) |
| Excel cell-formatting split into explicit capabilities (`CAP-FMT-CELL`/`-VALUE`/`CAP-COND-FMT`) | Formatting richness is a first-class product goal; explicit CAPs make it traceable, not buried. |
| Two personas (dev + end-user) | The programmatic consumer and the on-screen user have distinct goals; roles/authz split to Security. |
| NFR success criteria are pointers | Perf/a11y targets owned once at their home concern; P&R references, doesn't restate. |
| Header region is developer-populated, symmetric, no imposed hierarchy (`CAP-HEADER` supersedes `CAP-ROW-HEADER`) | Configurable bands + a per-cell renderer with free spans on both axes is strictly more general than a fixed gutter/tree; built-in `number`/`key`/label are convenience renderers, not structure. Aggregation/summary stays out of scope. |
| Selection is a full multi-range set; no checkboxes (`CAP-SELECT` breaking) | Excel/worksheet parity: disjoint ranges + header line-select + corner select-all match the on-screen mental model; checkboxes are a different (list) idiom the product deliberately omits. |
| Context menus are builder-driven; one `MenuBuilder` target-branched over cell + header/row/corner (`CAP-MENU` supersedes `CAP-HEADER-MENU`) | One target-branched builder covers every menu surface with rich item types + built-ins two ways; a **default builder** preserves today's items so the config is purely **additive** (no regression). Custom menu-item DOM is a developer-trust boundary (`SEC-MENU-CUSTOM-RENDER`), distinct from untrusted cell data (`SEC-RENDERER-DOM-ONLY`). |
| *(2026-07-12)* `CAP-FORMULA-FN` minted **here**, in the capability register (was minted inside `formula-support.md`); the stale pre-v1.5 "formula engine excluded" non-goal replaced by the precise residual formula exclusions | Owned once, referenced everywhere: the `CAP-*` prefix is owned by this register — the feature spec now *references* the ID. The blanket exclusion contradicted `CAP-FORMULA` (in scope since v1.5); what is genuinely still out (cross-sheet refs, the ~30 blocked functions, the deferred ref features) is now stated exactly, sourced from `formula-support.md` Non-goals. |

## Contracts
The **`CAP-*` register** (**32 in-scope** — 23 v1 + the v1.3/v1.4 header & menu subsystem `CAP-HEADER`/`CAP-COLUMN-MANAGE`/`CAP-MENU` (3) + *(v1.5)* `CAP-FORMULA` + `CAP-FORMULA-FN` (2) + *(v1.6, additive)* `CAP-FORMULA-VOLATILE`/`CAP-FORMULA-REFVAL`/`CAP-FORMULA-ARRAY` (3) + *(v1.7, additive)* `CAP-FORMULA-INTERSECT` (1); `CAP-ROW-HEADER` and `CAP-HEADER-MENU` **retired** → tombstones, not counted) each ID'd + persona-linked + in/out-of-scope marked, the **`PERSONA-*`** definitions (2, stable), and the **`SUCCESS-*`** register (**24 in-scope** — 15 v1 + 3 v1.3/v1.4 `SUCCESS-HEADER`/`-COLUMN-MANAGE`/`-MENU` + 1 v1.5 `SUCCESS-FORMULA` + 4 v1.6 `SUCCESS-FORMULA-CATALOG`/`-VOLATILE`/`-REFVAL`/`-ARRAY` + 1 v1.7 `SUCCESS-FORMULA-INTERSECT`; `SUCCESS-ROW-HEADER` retired → `SUCCESS-HEADER`, `SUCCESS-HEADER-MENU` retired → `SUCCESS-MENU`; each bound to an observable check above) are **frozen and referenceable**. Tokens are stable — never renamed once referenced (`CAP-EDIT` now spans cell editing + row/col CRUD; `CAP-SELECT` now carries the full multi-range model). A **retired** token (`CAP-ROW-HEADER` → `CAP-HEADER`, `CAP-HEADER-MENU` → `CAP-MENU`) is tombstoned, never reused. All referenced NFR targets resolve to a home concern: `PERF-*` (Performance), `A11Y-*` (Accessibility & i18n).

## Acceptance criteria
- **AC-CAP-COMPLETE:** every in-scope capability has a stable `CAP-*` ID + an in/out-of-scope mark; the 23 v1 caps + the v1.3/v1.4 header & menu subsystem (`CAP-HEADER`, `CAP-COLUMN-MANAGE`, `CAP-MENU` — 3) + the v1.5 `CAP-FORMULA`/`CAP-FORMULA-FN` (2) + the v1.6 `CAP-FORMULA-VOLATILE`/`-REFVAL`/`-ARRAY` (3) + the v1.7 `CAP-FORMULA-INTERSECT` (1) = **32 in-scope** are all marked in-scope; `CAP-ROW-HEADER` (→ `CAP-HEADER`) and `CAP-HEADER-MENU` (→ `CAP-MENU`) are **retired** (tombstoned); aggregation/summary + v2 items + the residual formula exclusions are in Non-goals.
- **AC-SUCCESS-CHECK:** every `SUCCESS-*` maps to an observable check (table above); the two NFR pointers resolve to measurable owner targets.
- **AC-PERSONA-STABLE:** `PERSONA-DEV`/`PERSONA-USER` are defined and referenced by Security/Domain/UX without redefinition.
- **AC-TRACE:** each `CAP-*` traces to at least one `JOURNEY-*` (UX) and its test (Quality coverage map) — no capability built in a single layer.

