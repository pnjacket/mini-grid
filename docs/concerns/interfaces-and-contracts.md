---
artifact: product-doc
role: concern
concern-id: interfaces-and-contracts
behavior: core
trigger: always
in-scope-subaspects: [library-sdk-surface, event-surface, ui-entrypoints, error-model-catalog, versioning-compatibility, pagination-filtering-rate-limit-conventions]
current-rung: contract-grade
status: published
version: 1.1.0
---

# Interfaces & Contracts — mini-grid

> One-line: the developer-facing surface — TypeScript library API (`LIB-*`), events (`EVT-*`), the worker message protocol (`MSG-*`), DOM/input layer (`DOM-*`/`BIND-*`), and the total error model (`ERR-*`). Data-facing calls are **async** (`ADR-WORKER-OPS`); structural calls are sync. **All names camelCase.**

## Purpose & Scope

Owns the canonical contracts for the active sub-types: **library**, **events**, the **worker message protocol** (`MSG-*`, per spec DD#9), the **UI entrypoint/DOM-hook + input-binding** layer, and the shared **error model**. Every element below carries: typed signature (concrete projection — fields + wire names, referencing `ENTITY-*`), parameter optionality + empty-value semantics, error catalog, pre/postconditions, side-effects/idempotency, owning `COMPONENT-*`, served `CAP-*`.

## Non-goals / Out-of-scope
- `http-rpc-api-surface` — *(absent)* no network API.
- `cli-surface` — *(absent)* no CLI.
- UX **navigation contract** — owned by UX (single component, no routing). Interfaces owns only the DOM-hook/input layer below it.
- **No authz on any element** — the grid has no `ROLE-*` (Security: not a cross-user boundary); the event-surface subscription-authz rule (spec) is therefore **N/A** (no server subscription surface).

## Requirements

### Shared conventions & types (single-sourced; every element below references these)
- **Casing:** camelCase for all fields, methods, event/message payload keys.
- **Async boundary:** worker-backed **data ops return `Promise<Result>`**; main-thread **structural ops are synchronous** and return their `Result` (or `void`) immediately (`ADR-WORKER-OPS`).
- **Mutation results:** each data mutation **resolves a result object AND fires its `EVT-AFTER-*`**.
- **Identity types (from Domain):** `RowKey = string | number` · `ColumnId = string` · `CellRef = { rowKey: RowKey; columnId: ColumnId }` · `Range = { top: number; left: number; bottom: number; right: number }` (inclusive, normalized).
- **`CellStyle`** = projection of `ENTITY-CELL-STYLE` (all optional): `{ textColor?, fillColor?, fontFamily?, fontSize?, fontWeight?, italic?, underline?, borders?, align?, wrap?, indent?, formatMask? }`.
- **`Selection`** = projection of `ENTITY-SELECTION` *(v1.3 — a **range-set**)*: `{ ranges: Range[]; lines?: { kind: 'row'\|'column'; index: number }[]; activeCell: CellRef \| null; anchor: { row: number; col: number } \| null }`. `ranges` are the **disjoint** rectangular ranges (Ctrl/Cmd+click adds one); a **line** selection (header click) is carried as a `lines` entry AND materialized into `ranges` spanning the full opposite axis (so consumers reading `ranges` alone still see the whole row/column). Empty selection ⇒ `ranges: []`, `activeCell: null`. **No checkbox/`selectedKeys` concept** — the range-set is the sole selection model.
- **`HeaderRenderer`** *(v1.3)* — `type HeaderRenderer = (ctx: { axis: 'column' \| 'row'; band: number; columnId?: ColumnId; rowKey?: RowKey; rowIndex?: number; colIndex?: number; data?: object }) => string \| Node \| { content: string \| Node; colSpan?: number; rowSpan?: number }`. Symmetric across axes; `band` is the 0-based band index (0 = topmost column band / leading-most row band; the **bottom/primary** column band is `bands-1`). A returned **string renders as text via `textContent`**, a `Node` is inserted as-is — **no raw-HTML sink** (`SEC-RENDERER-DOM-ONLY`); the `{ content, colSpan?, rowSpan? }` form declares a header-cell **span/merge** (developer-driven; **no parent/child hierarchy is imposed**). Overlapping spans are rejected at config time → `INVALID_OPTIONS`.
- **`HeaderConfig`** *(v1.3, all fields optional; absent = today's single default column-header row, no row-header, no corner)* — the developer-populated, **fully symmetric** header-region config carried on `GridOptions.header`. Shape:
  - `columns?: { bands?: number` *(N column-header rows, default 1)*`; height?: number \| number[]` *(band height px; array = per-band)*`; resizable?: boolean` *(drag to resize band height)*`; wrap?: boolean` *(multi-line/wrapping labels)*`; render?: HeaderRenderer` *(per-cell; falls back to the built-in label/`id` helper)*`; affordances?: 'bottom' \| number` *(which band carries sort/filter/resize handles; default `'bottom'` = the primary band `bands-1`)* `}`
  - `rows?: false \| { bands?: number` *(M row-header columns, default 1)*`; width?: number \| number[]` *(row-header width px; array = per-band)*`; resizable?: boolean; content?: 'number' \| 'key' \| HeaderRenderer` *(built-in convenience helpers or a custom renderer; default `'number'`)*`; select?: boolean` *(click a row-header cell → line-select the whole row; default `true` when `rows` set)* `}` — `false`/absent = **no row-header gutter** (default).
  - `corner?: { render?: HeaderRenderer` *(developer-customizable corner content)*`; selectAll?: boolean` *(click the corner → select-all; default `true`)* `}` — the row-header × column-header intersection cell; present only when both a column-header and a row-header exist.
  - `tooltips?: boolean` *(enable `ColumnDef.headerTooltip` string tooltips; rich tooltip content comes from `render` returning a `Node`; default `true` when any `headerTooltip` is set)*.
  - `autofit?: boolean` *(enable the autofit affordance — double-click a resize handle to fit + the `autofitAllColumns()` action; `CAP-COLUMN-MANAGE`)*.
  - `menu?: boolean` *(enable the dedicated header context-menu **surface** `LAYER-HEADER-MENU`; its **content** — items, ordering, submenus, custom items — comes from `GridOptions.menu` (the target-branched `MenuBuilder`, `CAP-MENU`); default `true` when `header` is set)*.

  **Every sub-behavior is independently toggleable** (omit/`false` a field → that affordance and its cost are absent, per `PATTERN-FEATURE-FLAGS`). Errors: malformed `header` → `INVALID_OPTIONS` (throw @ create/`updateOptions`); an overlapping/out-of-bounds header span → `INVALID_OPTIONS`. The header **menu content** is configured by `GridOptions.menu` (the `MenuBuilder`, `CAP-MENU`, see the **Menu model** below) — `header.menu` is only the per-surface enable toggle *(v1.4 — resolves the former menu-config deferral)*.
- **`FeatureFlags`** (the `GridOptions.features` map — one boolean per capability, default on unless noted; disabling removes the affordance + tree-shakes the cost, `PATTERN-FEATURE-FLAGS`) gains the **v1.3 granular header toggles**: `header` (the whole header subsystem), `rowHeader` (the `header.rows` gutter axis, default off), `columnManage` (hide/show + pin + autofit), `headerMenu` (the dedicated `LAYER-HEADER-MENU`), `autofit`, `headerResize` (band-height/row-header-width resize), `multiRangeSelect` (disjoint multi-range + line-select; when off, selection degrades to a single range). These compose with the fine-grained `HeaderConfig` sub-flags (a `features` flag off wins over a `header` sub-field). Reconciles with the existing per-capability flag shape (`CAP-FEATURE-FLAGS`).
- **Menu model** *(v1.4, `CAP-MENU`)* — **one target-branched builder** drives both the body-cell menu and the dedicated header/row-header/corner menus.
  - **`MenuContext`** = `{ target: { kind: 'cell' \| 'column-header' \| 'row-header' \| 'corner'; cellRef?: CellRef; columnId?: ColumnId; rowKey?: RowKey }; selection: Range[]; value?: unknown; event: Event; position: { x: number; y: number } }`. `target.kind` selects the surface; the branch fields are populated per kind (`cellRef` for `'cell'`, `columnId` for `'column-header'`, `rowKey` for `'row-header'`, none for `'corner'`). `selection` = the current range-set (`Selection.ranges`); `value` = the cell value for a `'cell'` target; `event` = the originating pointer/keyboard `Event`; `position` = the viewport anchor point.
  - **`MenuItem`** = a **discriminated union** on `kind`: `action` (`handler?: (ctx: MenuContext) => void` **or** `command?: BuiltinCommandId \| string`) · `separator` (optional `group?: string`) · `submenu` (`children: MenuItem[]`) · `checkbox`/`toggle` (`checked?: boolean` + `handler?`/`command?`) · `radio` (`group: string; checked?: boolean` + `handler?`/`command?`) · `custom` (`render: (ctx: MenuContext) => Node` — **developer-owned DOM**, mounted as-is, `SEC-MENU-CUSTOM-RENDER`). **Common fields** (all kinds): `id: string`; `label?: string` **or** `labelKey?: string` (i18n — resolved through the bundle via `LIB-LOCALE`; a literal `label` is used as text as-is); `icon?: string \| Node`; `shortcut?: string` (hint text only — **not** a key binding); `hidden?: boolean` (omitted entirely); `disabled?: boolean` (rendered greyed + `aria-disabled`). Builders are **synchronous** (return `MenuItem[]` immediately); a `handler` may itself do async work, but built-in **async/loading item state is [FUTURE-SCOPE]**.
  - **`MenuBuilder`** = `type MenuBuilder = (ctx: MenuContext) => MenuItem[]` — a **single** builder that **switches on `ctx.target.kind`** to return the cell menu vs the dedicated header/row-header/corner menus.
  - **`builtinItems`** — a registry of ready-made item **factories**: `builtinItems.copy`/`cut`/`paste`, `insertRowAbove`/`insertRowBelow`/`deleteRows`, `insertColLeft`/`insertColRight`/`deleteCols`, `sortAsc(ctx)`/`sortDesc(ctx)`/`clearSort`, `filter(ctx)`, `hideColumn(ctx)`/`showColumn(ctx)`/`pinColumn(ctx)`/`unpinColumn(ctx)`/`autofit(ctx)`/`autofitAll`, `groupBy(ctx)`/`ungroup(ctx)`, `selectAll`. Each returns a fully-wired, localized `MenuItem` (equivalent to `{ kind:'action', command: <id> }`). Developers **compose** these into the returned array — the first of the **two built-in paths**.
  - **`BuiltinCommandId`** — the **command-id catalog** (the second built-in path: `{ kind:'action', command, label, icon }`, grid supplies the behavior + developer supplies presentation) = `'copy' \| 'cut' \| 'paste' \| 'insert-row-above' \| 'insert-row-below' \| 'delete-rows' \| 'insert-col-left' \| 'insert-col-right' \| 'delete-cols' \| 'sort-asc' \| 'sort-desc' \| 'clear-sort' \| 'filter' \| 'hide-column' \| 'show-column' \| 'pin-column' \| 'unpin-column' \| 'autofit' \| 'autofit-all' \| 'group-by' \| 'ungroup' \| 'select-all'`. Each routes to its owning `LIB-*`: `copy`/`cut`/`paste` → `LIB-CLIPBOARD`; row/col insert/delete → `LIB-INSERT-ROWS`/`-REMOVE-ROWS`/`-COLUMN-CRUD`; `sort-*` → `LIB-SORT`; `filter` → `LAYER-FILTER-MENU`; `hide`/`show`/`pin`/`unpin`/`autofit`/`autofit-all` → `LIB-COLUMN-MANAGE`; `group-by`/`ungroup` → `LIB-GROUP`; `select-all` → `LIB-SELECTION`. **Feature-flag aware:** a built-in whose capability flag is **off** is **inert** and its item **auto-hides**; developer `handler`/`custom` items are unaffected. An unknown `command` string → `INVALID_OPTIONS`.
- **`SortSpec`** = `{ entries: { columnId: ColumnId; direction: 'asc'|'desc'; comparator?: Comparator }[] }` — a `comparator` is a **custom function** (main-thread; see the seam below). **`FilterSpec`** = `{ perColumn: Record<ColumnId, ColumnFilter> }` where *(v1.1)* `ColumnFilter = BuiltinFilter | FilterPredicate`. **`BuiltinFilter`** = a **serializable** descriptor `{ op: 'equals'|'notEquals'|'contains'|'startsWith'|'endsWith'|'gt'|'lt'|'between'|'in'|'blank'|'notBlank'; value?; values? }` (crosses the worker seam); a `FilterPredicate` is a **custom function** (main-thread). The built-in filter menu emits `BuiltinFilter` descriptors.
- **Error type:** `class GridError extends Error { code: ErrCode; severity: 'error'|'warning'; source: 'config'|'validation'|'operation'|'data-op'|'export'|'adapter'; context?: { rowKey?: RowKey; columnId?: ColumnId; columnIndex?: number; range?: Range } }`. Thrown (sync), promise-rejected (async), or carried on `EVT-ERROR` (see `ERR-*`).
- **Event type:** `GridEvent<P> = { type: string } & P`; a **vetoable** before-event adds `preventDefault(): void` + `defaultPrevented: boolean` — on veto the action aborts, no `after` fires, state unchanged.
- **Empty-value rule:** an absent/`undefined` optional arg = "use default"; an **empty `FilterSpec`/empty per-column predicate = no filter (all rows)**, never an error; an empty `SortSpec.entries` = unsorted (natural order).

### Library / SDK surface (`LIB-*`)

Each row: **signature (typed projection)** · optionality/empty · **errors** · **side-effects/idempotency** · owner `COMPONENT` · `CAP`. Async = `Promise`.

**Lifecycle & config**
| Element | Signature | Errors | Side-effect · owner · CAP |
|---|---|---|---|
| `LIB-CREATE` | `createGrid(container: HTMLElement, options: GridOptions): Grid` | `INVALID_OPTIONS`, `INVALID_COLUMN_DEF`, `DUPLICATE_COLUMN_ID` (throw) | mounts DOM + worker · `COMPONENT-API` · all |
| `LIB-DESTROY` | `grid.destroy(): void` | — | idempotent; unmounts, terminates worker · `COMPONENT-API` |
| `LIB-UPDATE-OPTIONS` | `grid.updateOptions(patch: Partial<GridOptions>): void` | `INVALID_OPTIONS`, `DUPLICATE_COLUMN_ID` (throw) | re-config; applies column-axis adjustments · `COMPONENT-API` · `CAP-FEATURE-FLAGS` |
| `LIB-OPTIONS` | `GridOptions = { data?, columns: ColumnDef[], keyField?, features?: FeatureFlags, theme?, locale?, direction?, localeBundle?, keyBindings?, onDuplicateKey?, preserveOnRebind?, header?: HeaderConfig, menu?: MenuBuilder \| 'default' \| false, ...callbacks }` *(v1.3: `header?: HeaderConfig` — the unified, symmetric header-region config, **replacing** the v1.2 flat `rowHeader?/rowHeaderSelect?/rowHeaderWidth?` fields, which are **removed**. `HeaderConfig` defined in shared types; absent = today's single default column-header row. The row-header gutter is now `header.rows`.)* *(v1.4: `menu?` configures **both** context menus — a `MenuBuilder` (target-branched) **replaces** the defaults, `'default'`/absent = the shipped default builder (today's cell + header items, no regression), `false` = **no context menu**; `CAP-MENU`.)* | `INVALID_OPTIONS` on malformed `header`/overlapping span/unknown menu `command` (throw) | pure type · served by all · `CAP-HEADER`/`CAP-MENU` |
| `LIB-MENU` *(v1.4)* | `openMenu(target: MenuTarget, position?: { x: number; y: number }): void` · `closeMenu(): void` — `MenuTarget = { kind:'cell'; cellRef: CellRef } \| { kind:'column-header'; columnId: ColumnId } \| { kind:'row-header'; rowKey: RowKey } \| { kind:'corner' }` | invalid/unknown target ref → `INVALID_OPTIONS` (throw); `menu:false` → `openMenu` is a **no-op** | sync; invokes the configured (or default) `MenuBuilder` with the derived `MenuContext`, resolves `builtinItems`/`command` ids + **drops flag-off built-ins**, mounts the `role="menu"` overlay at `position` (default: the target cell), fires `EVT-MENU-OPEN`; light-dismiss (`closeMenu`/Esc/outside-click) restores focus to the origin · `COMPONENT-INTERACTION` · `CAP-MENU` |
| `LIB-COLUMN-DEF` | `ColumnDef = { id: ColumnId; field: string; header?: string; type?; width?; editable?; editor?; validation?; formatMask?; defaultStyle?; comparator?; flags?; headerRender?: HeaderRenderer; headerTooltip?: string; hidden?: boolean; pinned?: 'leading' }` (projection of `ENTITY-COLUMN`) *(v1.3 additions: `headerRender?` — per-column header renderer, overrides `header.columns.render` for this column; `headerTooltip?: string` — simple tooltip text; `hidden?: boolean` — omit the column from the view + index projection (`CAP-COLUMN-MANAGE`, default `false`); `pinned?: 'leading'` — leading-edge pin, RTL-aware, no trailing option (`CAP-COLUMN-MANAGE`).)* | — | pure type |

**Data (async, `Promise<Result>`)**
| Element | Signature · result projection | Optionality/empty · errors | Side-effect · owner · CAP |
|---|---|---|---|
| `LIB-SET-DATA` | `setData(rows: object[], opts?: { keyField?: string; onDuplicateKey?: 'reject'\|'last-wins'; preserveOnRebind?: boolean }): Promise<{ rowCount: number }>` | opts optional (defaults: reject/reset). Errors: `DUPLICATE_ROW_KEY` (reject) | replaces dataset in worker; resets history/selection unless `preserveOnRebind` · `COMPONENT-DATA-WORKER` · `CAP-DATA-BIND` |
| `LIB-GET-ROWS` | `getRows(range: { startIndex: number; endIndex: number }): Promise<{ startIndex: number; rows: Array<{ key: RowKey; data: object }> }>` | range **clamped** to `[0, rowCount)` (canonical bound); empty if out of range | read-only, idempotent · `COMPONENT-DATA-WORKER` · `CAP-VIRTUALIZE` |
| `LIB-GET-COUNT` | `getRowCount(): Promise<{ rowCount: number; totalRowCount: number }>` | — | read-only · `COMPONENT-DATA-WORKER` |
| `LIB-UPDATE-CELL` | `updateCell(rowKey, columnId, value): Promise<{ rowKey; columnId; oldValue; newValue; changeState: 'dirty' }>` | value required. Errors: `VALIDATION_FAILED` (reject + `EVT-VALIDATION-ERROR`) | writes row.data; pushes `edit` history; fires `EVT-AFTER-EDIT` · `COMPONENT-DATA-WORKER`/`-EDIT` · `CAP-EDIT` |
| `LIB-INSERT-ROWS` | `insertRows(atIndex: number, rows: object[]): Promise<{ atIndex; count: number; rowCount }>` | atIndex clamped `[0,rowCount]`. Vetoable via `EVT-BEFORE-INSERT` | inserts; rows `new`; adjusts ranges/merges/freeze/groups; history · `COMPONENT-DATA-WORKER` · `CAP-EDIT` |
| `LIB-REMOVE-ROWS` | `removeRows(rowKeys: RowKey[]): Promise<{ removed: RowKey[]; rowCount }>` | empty array = no-op. Vetoable via `EVT-BEFORE-DELETE` | tombstones rows; adjusts structures; history · `COMPONENT-DATA-WORKER` · `CAP-EDIT` |
| `LIB-COLUMN-CRUD` | `insertColumn(atIndex: number): Promise<{ column: ColumnDef; atIndex }>` · `removeColumn(columnId): Promise<{ columnId; removedField: string }>` | atIndex clamped `[0,colCount]`. Vetoable (`EVT-BEFORE-INSERT-COL`/`-DELETE-COL`) | insert = blank grid-minted field; delete = **destructive** (drops field from row data → rows `dirty`); history · `COMPONENT-DATA-WORKER` · `CAP-EDIT` |
| `LIB-GET-CHANGES` | `getChanges(): Promise<{ new: RowKey[]; dirty: RowKey[]; removed: RowKey[] }>` | requires `keyField` (else best-effort, `severity:'warning'`) | read-only · `COMPONENT-DATA-WORKER` · `CAP-EDIT` |
| `LIB-DATASOURCE` | `DataSource` interface (in-memory default) | v2 adapter → `ADAPTER_ERROR` | **[FUTURE-SCOPE] v2** · `CAP-DATA-BIND` |

**View ops**
| Element | Signature · result | Optionality/empty · errors | Side-effect · owner · CAP |
|---|---|---|---|
| `LIB-SORT` | `sort(spec: SortSpec): Promise<{ spec; rowCount }>` | empty `entries` = unsorted. Errors: `WORKER_OP_FAILED` (throwing comparator) | *(v1.1)* fully-built-in spec → **worker** rebuilds index off-thread; a spec with any custom `comparator` → **main-thread** (`ADR-SORT-FILTER-SEAM`); **undoable**; `EVT-AFTER-SORT` · `COMPONENT-DATA-WORKER` · `CAP-SORT` |
| `LIB-FILTER` | `filter(spec: FilterSpec): Promise<{ spec; rowCount; totalRowCount }>` | **empty = no filter (all)**. Errors: `WORKER_OP_FAILED` | *(v1.1)* all-`BuiltinFilter` spec → **worker**; any `FilterPredicate` function → whole op **main-thread**; **not undoable**; `EVT-AFTER-FILTER` · `COMPONENT-DATA-WORKER` · `CAP-FILTER` |
| `LIB-SELECTION` | `getSelection(): Selection` · `setSelection(sel: Selection): void` · *(v1.3)* `addRange(range: Range): void` · `selectRow(index: number, opts?: { additive?: boolean }): void` · `selectRows(indices: number[]): void` · `selectColumn(index: number, opts?: { additive?: boolean }): void` · `selectColumns(indices: number[]): void` · `selectAll(): void` · `clearSelection(): void` | sel `ranges`/`lines` clamped to extents; `additive` (Ctrl/Cmd) **adds a disjoint range** without replacing; a row/column line-select materializes a full-axis range (see `Selection`); empty = clear | sync; **selection state = a set of ranges** (`ENTITY-SELECTION`, `INV-SELECTION-WELLFORMED`); fires `EVT-SELECTION-CHANGE` carrying the full range-set · `COMPONENT-STORE`/`COMPONENT-INTERACTION` · `CAP-SELECT` |
| `LIB-COLUMN-MANAGE` *(v1.3)* | `hideColumn(id: ColumnId): void` · `showColumn(id: ColumnId): void` · `pinColumn(id: ColumnId, edge: 'leading' \| null): void` · `autofitColumn(id: ColumnId): void` · `autofitAllColumns(): void` | `id` unknown → `INVALID_COLUMN_DEF` (throw); `edge` other than `'leading'`/`null` → `INVALID_OPTIONS`; autofit on a hidden column is a no-op | sync, **idempotent** (hide-hidden / show-shown = no-op); hide/show sets `ENTITY-COLUMN.hidden` + reprojects the view/index (`INV-COLUMN-HIDDEN-EXCLUDED`); pin sets `pinned` + reflows the **leading contiguous pinned block** (`INV-COLUMN-PIN-LEADING`), RTL-aware; autofit measures **visible/sampled cells only** (bounded pass, no full-column scan — Architecture/Performance) and sets width; fires `EVT-COLUMN-HIDDEN`/`-PINNED`/`-AUTOFIT`; undoable (`resize`/structural Commands) · `COMPONENT-STORE`/`COMPONENT-INTERACTION` · `CAP-COLUMN-MANAGE` |
| `LIB-SCROLL` | `scrollTo(target: CellRef \| { rowIndex; colIndex }): void` | clamped | sync, idempotent · `COMPONENT-VIEWPORT` |

**Structural / styling (sync)**
| Element | Signature | Errors | Side-effect · owner · CAP |
|---|---|---|---|
| `LIB-SET-STYLE` | `setStyle(range: Range, style: CellStyle): void` | range clamped | idempotent overlay; `style` history; `EVT-STATE-CHANGE` · `COMPONENT-STORE` · `CAP-FMT-CELL` |
| `LIB-COND-FMT` | `addConditionalRule(rule): { id }` · `removeConditionalRule(id): void` | — | undoable; · `COMPONENT-STORE` · `CAP-COND-FMT` |
| `LIB-MERGE` | `merge(range: Range): void` · `unmerge(range): void` | `MERGE_OVERLAP` (throw); 1-cell merge rejected | undoable; `EVT-AFTER-MERGE-CHANGE` · `COMPONENT-STORE` · `CAP-MERGE` |
| `LIB-FREEZE` | `setFrozen(o: { rows?: number; cols?: number }): void` | clamped to extents | undoable · `COMPONENT-STORE` · `CAP-FREEZE` |
| `LIB-GROUP` | `group(o: { axis; start; span }): { id }` · `ungroup(id)` · `setCollapsed(id, boolean)` | `GROUP_OVERLAP` (throw) | undoable · `COMPONENT-STORE` · `CAP-GROUP` |
| `LIB-RESIZE`/`LIB-REORDER` | `setColumnWidth(columnId, width): void` · `moveColumn(columnId, toIndex): void` | width ≥ min; toIndex clamped | undoable; events · `COMPONENT-STORE` · `CAP-RESIZE`/`CAP-REORDER` |
| `LIB-THEME` | `setTheme('light'\|'dark'): void` + CSS vars | — | idempotent · `COMPONENT-RENDER` · `CAP-THEME` |

**Editing / history / clipboard**
| Element | Signature | Errors | Side-effect · owner · CAP |
|---|---|---|---|
| `LIB-EDIT-CONTROL` | `beginEdit(cell: CellRef): void` · `commitEdit(): Promise<{ ...editResult }>` · `cancelEdit(): void` | `VALIDATION_FAILED` on commit | drives `ENTITY-EDIT-SESSION`; `EVT-EDIT-*` · `COMPONENT-EDIT` · `CAP-EDIT` |
| `LIB-UNDO`/`LIB-REDO` | `undo(): Promise<void>` · `redo(): Promise<void>` | no-op when stack empty | reverts/reapplies last command (data→worker, structural→main) · `COMPONENT-HISTORY` · `CAP-UNDO` |
| `LIB-CLIPBOARD` | `copy(): Promise<void>` · `cut(): Promise<void>` · `paste(): Promise<{ targetRange: Range }>` · `fill(range: Range): Promise<void>` | paste parses TSV as text (`SEC-PASTE-UNTRUSTED`); vetoable | writes clipboard / applies via worker; `EVT-AFTER-PASTE` · `COMPONENT-CLIPBOARD` · `CAP-CLIPBOARD` |

**Formulas** *(v1.5, `CAP-FORMULA`; gated by the `formula` flag)*
| Element | Signature | Errors | Side-effect · owner · CAP |
|---|---|---|---|
| `LIB-FORMULA-ENTRY` | *(via `LIB-UPDATE-CELL` / interactive edit / **paste**)* a committed value starting with `=` is stored as a formula | parse failure → `EVT-VALIDATION-ERROR` + `FORMULA_PARSE_FAILED`, cell keeps prior value (paste rejects the bad cell **per-cell**, never keeps it as literal text) | commit path unchanged; the `=…` source held in the engine sidecar (`ENTITY-FORMULA-CELL`), its computed value written to `row.data[field]` (`INV-FORMULA-DERIVED`); fires `EVT-AFTER-RECALC` · `COMPONENT-DATA-WORKER` · `CAP-FORMULA` |
| `LIB-FORMULA-GET` | `getCellFormula(rowKey: RowKey, columnId: ColumnId): string \| undefined` | returns `undefined` when the `formula` flag is off (no throw) | read-only; returns the raw `=…` for a formula cell, else `undefined` (the edit-seed hook, so the editor shows the formula) · `COMPONENT-DATA-WORKER` · `CAP-FORMULA` |
| `LIB-FORMULA-RECALC` | `recalculate(): Promise<{ changed: number; cycles: number; elapsedMs: number }>` | resolves a zeroed summary `{changed:0,cycles:0,elapsedMs:0}` when the flag is off | forces a **full** recalc; resolves the summary; fires `EVT-AFTER-RECALC` · `COMPONENT-DATA-WORKER` · `CAP-FORMULA` |
| `LIB-FORMULA-SPILL` *(v1.6, additive — delta; **specced, build pending**: the worker-engine substrate `FormulaEngine.getSpillRanges()` is built, the public `grid.getSpillRanges()` + recalc-result carry are not — see `IMPLEMENTATION.md` 45d/45e)* | `getSpillRanges(): { anchor: { row: number; col: number }; rows: number; cols: number }[]` | returns `[]` when the `formula` flag is off or no spill is live | synchronous, **read-only** snapshot of the current dynamic-array spill ranges (canonical positional coords), for host outline rendering and the spill edit-guard; a projection of the worker engine's `getSpillRanges()` carried on the last `recalc-result` · `COMPONENT-DATA-WORKER` · `CAP-FORMULA-ARRAY` |
| `LIB-FORMULA-EVAL` | `parseFormula(src): FormulaNode` + `evaluate(node, resolver): FormulaValue` | an evaluation error is **returned as an `ENTITY-FORMULA-ERROR` value**, not thrown | two-step, pure: parse `src` to an AST, then evaluate a node against a **caller-supplied `CellResolver`**, **no store write** (exported for tooling/tests) · `COMPONENT-DATA-WORKER` · `CAP-FORMULA` |

*(v1.6, additive — the only new public `LIB-*` on the formula surface is `LIB-FORMULA-SPILL` (the spill-range query, above); no new `ERR-*`.* The full catalog — **475 registry functions** after the v1.7 completion (`CAP-FORMULA-FN`, owned by the P&R capability register) — is authored in **[`docs/formula-functions.md`](../formula-functions.md)** — every function, category, arity, and tag; it needs no new API element (functions are registry entries). The **`#`-spill reference** (`A1#`, addressing an anchor's current spill range — `CAP-FORMULA-ARRAY`) extends the **formula reference surface** parsed inside `=…` sources (`LIB-FORMULA-ENTRY`/`-EVAL`), not the public library API. **No new public `ERR-*`:** in-cell evaluation results — including the v1.6 `#SPILL!`/`#CALC!` — are `ENTITY-FORMULA-ERROR` **values** displayed in the cell, never thrown `GridError`s. The only formula-surface events remain `EVT-AFTER-RECALC`/`-FORMULA-ERROR` plus the v1.6 `EVT-SPILL-CHANGE` above.)*

**Export / state / i18n**
| Element | Signature · result | Optionality/empty · errors | Side-effect · owner · CAP |
|---|---|---|---|
| `LIB-EXPORT` | `exportCsv(opts?: { allData?: boolean }): Promise<Blob>` · `exportXlsx(opts?): Promise<Blob>` | **default scope = current sorted/filtered view**; `allData:true` = full dataset (confirmed default). Errors: `XLSX_UNAVAILABLE`, `EXPORT_FAILED` | read-only; applies `SEC-EXPORT-FORMULA-GUARD` (default on, `sanitizeFormulas:false` off) · `COMPONENT-EXPORT` · `CAP-EXPORT` |
| `LIB-STATE` | `serializeState(): GridState` · `restoreState(state: GridState): void` | `GridState` carries `version` (see Versioning) | serialize read-only; restore applies layout · `COMPONENT-STATE-SERDE` · `CAP-PERSIST-STATE` |
| `LIB-LOCALE` | `setLocale(locale: string, bundle?: MessageBundle): void` · `setDirection('ltr'\|'rtl'): void` — `MessageBundle = Record<string, string \| PluralForms>` (`PluralForms = Partial<Record<Intl.LDMLPluralRule, string>>` for count-bearing keys, per `Intl.PluralRules`) | bundle optional (English default) | idempotent · `COMPONENT-I18N` · `CAP-I18N` |

**Extension-point contracts (developer-supplied)**
| Element | Signature | Contract |
|---|---|---|
| `LIB-EDITOR-API` | `interface CellEditor { mount(cell: CellRef, ctx): void; getValue(): unknown; validate?(): true \| ValidationError; destroy(): void; immediateCommit?: boolean; renderInPopover?: boolean }` | grid calls mount→(getValue/validate)→destroy. *(v1.1)* `immediateCommit` (checkbox) commits on the editor's `change`; `renderInPopover` (select) renders options in an overlay layer escaping the cell bounds · `CAP-EDIT` |
| `LIB-RENDERER-API` | `type CellRenderer = (cell: CellContext) => Node \| FrameworkComponent \| string` | **No raw-HTML sink**: a `Node`/component is inserted; a returned **string is rendered as text via `textContent`** (never `innerHTML`) — `SEC-RENDERER-DOM-ONLY` · `CAP-FMT-CELL` |
| `LIB-VALIDATOR-API` | `type Validator = (value: unknown, ctx) => true \| ValidationError` | pure; sync · `CAP-VALIDATE` |
| `LIB-CONDFMT-PREDICATE` | `type CondFmtPredicate = (cell: CellContext) => CellStyle \| null` | pure · `CAP-COND-FMT` |
| `LIB-COMPARATOR-API` | `type Comparator = (a, b) => number` (sort) · `type FilterPredicate = (value, ctx) => boolean` | *(v1.1)* custom **functions run on the main thread** (they can't cross `postMessage`); their presence forces the whole sort/filter main-thread (`ADR-SORT-FILTER-SEAM`); a throw → `WORKER_OP_FAILED` · `CAP-SORT`/`CAP-FILTER` |
| `LIB-FORMATTER-API` | `type FormatterFn = (value: unknown, ctx) => string` | pure · `CAP-FMT-VALUE` |

### Event surface (`EVT-*`) — vetoable before + notify after (ALL actions)

Every action emits a vetoable `before-*` + a notify `after-*`; payloads are concrete projections. Owner: `COMPONENT-STORE`/`COMPONENT-API` emit; served CAP per action.

| Event pair | Payload projection |
|---|---|
| `EVT-*-EDIT` | `{ cell: CellRef; oldValue: unknown; newValue: unknown }` |
| `EVT-*-PASTE` | `{ targetRange: Range; data: string[][] }` (parsed TSV) |
| `EVT-*-INSERT` / `EVT-*-DELETE` (row) | `{ atIndex: number; count: number }` / `{ rowKeys: RowKey[] }` |
| `EVT-*-INSERT-COL` / `EVT-*-DELETE-COL` | `{ atIndex: number }` / `{ columnId: ColumnId }` |
| `EVT-*-SORT` / `EVT-*-FILTER` | `{ spec: SortSpec }` / `{ spec: FilterSpec }` |
| `EVT-*-RESIZE` / `EVT-*-REORDER` | `{ columnId; width }` / `{ columnId; fromIndex; toIndex }` |
| `EVT-*-FREEZE-CHANGE` / `EVT-*-MERGE-CHANGE` / `EVT-*-GROUP-CHANGE` | `{ frozenRowCount; frozenColCount }` / `{ range: Range; merged: boolean }` / `{ node: GroupNode }` |
| `EVT-SELECTION-CHANGE` (notify) | `{ selection: Selection }` *(v1.3 — `selection` is now the full **range-set** projection: `ranges[]` + optional `lines[]` + `activeCell`; consumers that read a single range must read `ranges[0]`/`ranges` — semantic change, see `CE-MULTI-RANGE-SELECT`)* |
| `EVT-COLUMN-HIDDEN` (notify) *(v1.3)* | `{ columnId: ColumnId; hidden: boolean }` — fired by `hideColumn`/`showColumn` · `CAP-COLUMN-MANAGE` |
| `EVT-COLUMN-PINNED` (notify) *(v1.3)* | `{ columnId: ColumnId; pinned: 'leading' \| null }` — fired by `pinColumn` · `CAP-COLUMN-MANAGE` |
| `EVT-COLUMN-AUTOFIT` (notify) *(v1.3)* | `{ columnId: ColumnId; width: number } \| { columns: { columnId: ColumnId; width: number }[] }` — fired by `autofitColumn`/`autofitAllColumns` · `CAP-COLUMN-MANAGE` |
| `EVT-MENU-OPEN` (notify) *(v1.4)* | `{ target: MenuTarget; items: MenuItem[]; position: { x: number; y: number } }` — fired when a context menu opens (cell or header/row/corner), carrying the resolved (flag-filtered) items · `CAP-MENU` |
| `EVT-AFTER-RECALC` (notify) *(v1.5; the `spillChanged` field is the v1.6 delta — **specced, carry pending**: `RecalcSummary.spillChanged` exists in the engine but is not yet on the public payload)* | `{ changed: number; cycles: number; elapsedMs: number; trigger: 'load'\|'edit'\|'structural'\|'manual'; spillChanged: boolean }` — fired after a recalc pass; `spillChanged` is a cheap hint that ≥1 `EVT-SPILL-CHANGE` fired this pass (the host may re-query `LIB-FORMULA-SPILL` instead of tracking each delta) · `CAP-FORMULA` |
| `EVT-FORMULA-ERROR` (notify) *(v1.5)* | `{ cell: CellRef; code: FormulaErrorCode }` — a cell resolved to an error value (`ENTITY-FORMULA-ERROR`) this recalc · `CAP-FORMULA` *([FUTURE-SCOPE] — declared, not yet emitted; error/cycle counts surface via `EVT-AFTER-RECALC`'s `cycles` and the in-cell `#…!` value)* |
| `EVT-SPILL-CHANGE` (notify) *(v1.6 delta — **specced, public emission pending**: the engine detection substrate (`RecalcSummary.spillChanged` + `FormulaEngine.getSpillRanges()`) is built; the per-anchor diff, recalc-result carry, and `COMPONENT-API` emission are not — see `bindings.yaml` / `IMPLEMENTATION.md` 45e)* | `{ anchor: { row: number; col: number }; rows: number; cols: number; blocked: boolean }` — **canonical positional** anchor (0-based `row`/`col`, view-independent). Fired **once per changed anchor** during a recalc pass (so N emissions per pass), before the pass's `EVT-AFTER-RECALC`. Three encodings: **active** spill → `rows≥1, cols≥1, blocked:false`; **blocked** (`#SPILL!`) → `blocked:true` with `rows`/`cols` = the *attempted* extent; **cleared/removed** (anchor no longer spills) → `rows:0, cols:0, blocked:false`. · `CAP-FORMULA-ARRAY` |
| `EVT-EDIT-BEGIN`/`-COMMIT`/`-CANCEL` (notify) | `{ cell: CellRef }` |
| `EVT-VALIDATION-ERROR` (notify) | `{ cell: CellRef; error: GridError }` |
| `EVT-SCROLL`/`EVT-VIEWPORT-CHANGE` (notify) | `{ firstRow: number; lastRow: number; firstCol: number; lastCol: number }` |
| `EVT-STATE-CHANGE` (notify) | `{}` (coalesced) |
| `EVT-ERROR` (notify) | `{ error: GridError }` |
| `EVT-PERF` (notify, opt-in `options.perf`) | `{ measure: PerformanceMeasure }` — latest perf mark (Performance measurement-hooks) |

### Worker message protocol (`MSG-*`) — typed payloads (`PATTERN-WORKER-PROTOCOL`)
Envelope: `{ kind: string; reqId: number }`; the worker's index has a monotonic `version`; stale (superseded-version) replies are dropped; ops serialize in the worker.

| Message | Dir | Payload |
|---|---|---|
| `MSG-LOAD` | M→W | `{ reqId; rows: object[]; keyField: string\|null; columns: { id; field; type }[]; onDuplicateKey }` |
| `MSG-QUERY-WINDOW` | M→W | `{ reqId; startIndex: number; endIndex: number }` |
| `MSG-WINDOW` | W→M | `{ reqId; startIndex; rows: { key: RowKey; data: object }[]; version }` |
| `MSG-APPLY-EDIT` | M→W | `{ reqId; rowKey; field: string; value: unknown }` |
| `MSG-INSERT` / `MSG-REMOVE` | M→W | `{ reqId; atIndex; rows }` / `{ reqId; rowKeys: RowKey[] }` |
| `MSG-INSERT-COL` / `MSG-REMOVE-COL` | M→W | `{ reqId; atIndex; column }` / `{ reqId; columnId; field }` |
| `MSG-PASTE-APPLY` | M→W | `{ reqId; anchor: CellRef; cells: { rowKey; field; value }[] }` *(main thread resolves TSV → per-cell validated/column-ordered writes before the worker applies them; `anchor` carried for provenance)* |
| `MSG-SORT` / `MSG-FILTER` | M→W | `{ reqId; spec: SortSpec }` / `{ reqId; spec: FilterSpec }` |
| `MSG-AGGREGATE` | M→W | `{ reqId; columnId; agg: 'min'\|'max'\|'topN'; n? }` *(field is `agg`, not `kind` — `kind` is the envelope discriminator)* |
| `MSG-INDEX-SUMMARY` | W→M | `{ reqId?; version; rowCount; totalRowCount; affected?: { startIndex; endIndex } }` |
| `MSG-AGGREGATE-RESULT` | W→M | `{ reqId; columnId; agg; result }` |
| `MSG-EXPORT-ROWS` / `MSG-EXPORT-ROWS-RESULT` *(v1.1)* | M→W / W→M | `{ reqId }` / `{ reqId; rows: WireRow[] }` — fetch **every canonical row** `{ key, data }` in natural order (sort/filter ignored) to the main thread; the request leg of the **custom-fn (main-thread) sort/filter path** (`ADR-SORT-FILTER-SEAM`) |
| `MSG-SET-INDEX` *(v1.1)* | M→W | `{ reqId; orderedKeys: RowKey[]; sort: SortSpec; filter: FilterSpec }` — install a **main-thread-computed ordered view** (the result of a custom comparator/predicate); `sort`/`filter` carry the **serializable baseline** (declarative sort + `BuiltinFilter`-only filter — no functions cross the seam) so later structural/built-in ops rebuild coherently; reply `MSG-INDEX-SUMMARY`. The apply leg of the custom-fn path (`ADR-SORT-FILTER-SEAM`) |
| `MSG-RECALC` / `MSG-RECALC-RESULT` *(v1.5)* | M→W / W→M | `{ reqId; locale? }` / `{ reqId; changed; cycles; version; rowCount; totalRowCount }` — force a full formula recalc (`LIB-FORMULA-RECALC`); `locale` refreshes the formula locale first (`COMPONENT-I18N`) |
| `MSG-ERROR` | W→M | `{ reqId?; code: ErrCode; message: string; context? }` → mapped to `ERR-*` |

### UI entrypoint — DOM hooks + input bindings (`DOM-*`/`BIND-*`)
- `DOM-ROOT` — `<div role="grid" aria-rowcount aria-colcount aria-multiselectable="true" dir data-mini-grid>`; theme class `mg-theme-{light|dark}`; CSS custom properties `--mg-*`.
- `DOM-CELL` — `role="gridcell" data-row-key data-col-id aria-rowindex aria-colindex aria-selected aria-readonly`.
- `DOM-ROWHEADER` *(v1.2 → v1.3)* — a frozen leading-edge row-header gutter cell: `role="rowheader" data-row-key aria-rowindex data-band`; present only when `header.rows` is configured (may be **M bands** wide, `data-band` = 0-based band index); realized by `COMPONENT-RENDER`. Clicking it (when `header.rows.select`) **line-selects the whole row** via `LIB-SELECTION.selectRow` (`CAP-SELECT`); it is a convenience axis of the unified header region (`CAP-HEADER`).
- `DOM-HEADER` *(extended v1.3)* — a column-header cell: `role="columnheader" aria-sort data-col-id data-band`; the header region is now **N bands** (`header.columns.bands`), each an `aria-`level `role="row"` band, so a cell carries `data-band` (0-based) and, when the renderer declares a span/merge, **`aria-colspan`/`aria-rowspan`** (+ matching `colspan`/`rowspan`-equivalent layout). `aria-sort`/filter/resize affordances render on the configured **affordance band** (default the bottom/primary band); *(v1.4.1)* the **sort indicator (`aria-sort` + arrow) is set on exactly that one affordance-band cell of the sorted column** — never mirrored onto the column's other bands or onto a spanning parent/child header cell. Clicking a column-header cell (outside an affordance) **line-selects the whole column** via `LIB-SELECTION.selectColumn`; *(v1.4.1)* clicking a **spanning** cell (`colSpan > 1`) line-selects **all columns it spans** via `LIB-SELECTION.selectColumns` over the spanned column range (not just the anchor) (`CAP-SELECT`). Realized by `COMPONENT-RENDER`; interactions by `COMPONENT-INTERACTION`.
- `DOM-HEADER-SORT` — the **sort-indicator hook** on a column header: the `aria-sort` attribute + visual arrow, rendered on **exactly one cell per sorted column** — its affordance-band cell *(v1.4.1)* — and never mirrored onto sibling bands or a spanning cell; an unsorted-but-sortable affordance cell carries `aria-sort="none"`, and a stale indicator is stripped on re-render. A sub-hook of `DOM-HEADER` bound separately (its own renderer path); realized by `COMPONENT-RENDER` (`renderHeader`).
- `DOM-CORNER` *(v1.3)* — the row-header × column-header **intersection** cell: `role="columnheader" data-mg-corner aria-label` (localized "Select all"); present only when both a column-header and a row-header exist. Renders `header.corner.render` content (developer-customizable); clicking it (when `header.corner.selectAll`) invokes `LIB-SELECTION.selectAll` (`CAP-SELECT`/`CAP-HEADER`). Realized by `COMPONENT-RENDER`.
- `DOM-HEADER-MENU` *(v1.3, builder-driven v1.4)* — the dedicated header context-menu surface: `role="menu"` overlay (light-dismiss), opened from a header cell (right-click / long-press / ContextMenu key / a menu affordance) or programmatically (`openMenu`); **separate from `DOM-EDITOR`/the cell `LAYER-CONTEXT-MENU`**. Its items are produced by the `GridOptions.menu` `MenuBuilder` for the `'column-header'`/`'row-header'`/`'corner'` targets and carry the rich-item roles (`menuitem`/`menuitemcheckbox`/`menuitemradio`/`aria-haspopup` for submenus — see A11y `A11Y-HEADER-MENU`); the **default builder** supplies sort/filter/hide/show/pin/autofit/insert/delete/group-by. Realized by `COMPONENT-INTERACTION` (`CAP-MENU`, UX `LAYER-HEADER-MENU`).
- `DOM-EDITOR` — `data-mg-editor` mount node.
- `BIND-KEYS` — **remappable** map (defaults): arrows/Tab/Enter/Esc/F2/PageUp-Down/Home-End/Shift-extend/Ctrl+C-X-V/Ctrl+Z-Y; edit: dbl-click/F2/type-to-replace; commit: Enter (↓)/Tab (→); cancel: Esc.
- `BIND-POINTER-HEADER` — the **header-region pointer bindings**, split out of `BIND-POINTER` at build (own delegation root on the header element — re-rendered header cells need no re-binding; realized by the worksheet `HeaderController`, `COMPONENT-INTERACTION`): plain click cycles the column's sort asc→desc→none · **Shift-click appends/cycles a secondary/tertiary sort key** (multi-sort) · click the filter icon → `LAYER-FILTER-MENU` · drag the right-edge handle → live-preview resize committed as one undoable `resize` · drag a header past a small threshold → reorder at the pointer (a sub-threshold press stays a sort click, so the gestures never collide) · click outside an affordance → column line-select (span-aware, *v1.4.1*). Each gesture is gated by its feature flag + per-column `flags`.
- `BIND-POINTER` — click/drag select · **Ctrl/Cmd+click → add a disjoint range** (`CAP-SELECT` multi-range) · **click a row-header/column-header → line-select the whole row/column** (Shift-click extends the line range; *(v1.4.1)* a **spanning** column-header cell selects **all columns it spans**) · **click the corner → select-all** · **shift-click header → add multi-sort key** · click header filter icon → `LAYER-FILTER-MENU` · **double-click a column resize handle → autofit** (`CAP-COLUMN-MANAGE`) · long-press → range + drag handles · resize/reorder/fill-handle/header-band-resize drag · right-click/long-press on a **body cell → `LAYER-CONTEXT-MENU`**, on a **header → `LAYER-HEADER-MENU`** (both builder-driven, `CAP-MENU`).

### Error model (`ERR-*`) — total + never console-only (`PATTERN-ERROR`)
Every error (incl. worker/runtime) is a `GridError` reaching a user-visible surface — thrown to the developer, promise-rejected, or `EVT-ERROR` + inline UI — **never only the console**. Full catalog:

| Code | Condition | Source | Surfaced | Forced-by (test) | Proving tier |
|---|---|---|---|---|---|
| `DUPLICATE_ROW_KEY` | dup key at bind (reject policy) | config | throw @ `setData`/`createGrid` | bind fixture with duplicate keys | unit/component |
| `DUPLICATE_COLUMN_ID` | dup `column.id` | config | throw @ create/`updateOptions` | columns with duplicate id | unit/component |
| `INVALID_OPTIONS` / `INVALID_COLUMN_DEF` | malformed options/column def *(incl. malformed `header` / **overlapping or out-of-bounds header span** / unknown column id in `hideColumn`/`pinColumn` → `INVALID_COLUMN_DEF`)* | config | throw @ create/`updateOptions`/`LIB-COLUMN-MANAGE` | malformed options / overlapping-span / unknown-column-id fixture | unit |
| `VALIDATION_FAILED` | cell validator rejects | validation | `EVT-VALIDATION-ERROR` + inline UI; edit stays `rejected` | configure a rejecting validator, type an invalid value | component + **E2E** |
| `MERGE_OVERLAP` | merge overlaps existing / <2 cells | operation | throw @ `merge()` | call `merge` on overlapping ranges | unit/component |
| `GROUP_OVERLAP` | partially-overlapping same-axis group | operation | throw @ `group()` | call `group` with partial overlap | unit/component |
| `WORKER_OP_FAILED` | worker op throws (e.g. throwing comparator) | data-op | promise reject + `EVT-ERROR` | supply a **config comparator that throws**, trigger a sort | **E2E** (+ unit stub) |
| `WORKER_CRASHED` | worker terminated/crashed (fatal) | data-op | `EVT-ERROR` + reject in-flight ops; degraded read-only until `setData` (Architecture resilience) | terminate/mock-crash the worker | component/**E2E** |
| `XLSX_UNAVAILABLE` | `exportXlsx` with lib absent | export | promise reject + `EVT-ERROR` | call `exportXlsx` with the lib mocked absent | component/**E2E** |
| `EXPORT_FAILED` | export serialization failure | export | promise reject + `EVT-ERROR` | force a serialization failure fixture | component |
| `ADAPTER_ERROR` | async DataSource failure | adapter | promise reject + `EVT-ERROR` | (v2) | **[FUTURE-SCOPE]** |
| `FORMULA_PARSE_FAILED` *(v1.5)* | committed `=…` is syntactically invalid | validation | `EVT-VALIDATION-ERROR` + reject commit (cell keeps prior value) | commit `"=1+"` | component + **E2E** |
| `FORMULA_DISABLED` *(v1.5)* | **reserved** code — defined in `ErrCode` but the formula APIs **degrade gracefully** rather than throw it (`getCellFormula` → `undefined`, `recalculate` → zeroed summary when the `formula` flag is off) | config | reserved — not thrown | n/a (graceful degrade; no forcing) | n/a |

*(v1.5: **in-cell evaluation** errors are `ENTITY-FORMULA-ERROR` **values**, not thrown `ERR-*` — they display in the cell like Excel; only the two rows above are thrown/surfaced `GridError`s.)*

Each E2E-gated row names an **E2E-usable** forcing (real config validator / throwing comparator / mocked-absent lib) — no unit-only stub gates an E2E row (spec DD#10).

### Versioning & compatibility
- **SemVer** for the public API (`LIB-*`/`EVT-*`/`DOM-*`); breaking = major.
- **`GridState.version`** — integer schema version on serialized state; `restoreState` accepts the current + documented prior versions, migrating forward; an unknown-future version → `INVALID_OPTIONS` (`severity:'warning'`, ignored fields dropped). Starts at `1`.
- `MSG-*` is **internal** (core + worker ship in lockstep) — not externally versioned.
- Adapter packages version **in lockstep** with core (`ADR-MONOREPO`).

### Pagination / filtering conventions
Client-side. `LIB-GET-ROWS` windows by **ordered index** `{ startIndex, endIndex }`, clamped to `[0, rowCount)` (the one canonical bound; `rowCount` is post-filter). `SortSpec`/`FilterSpec` are plain objects; **empty filter = all**. Same shapes feed the v2 async adapter server-side (**[FUTURE-SCOPE]**).

## Open Questions
- Whether `EVT-STATE-CHANGE` carries a change-kind discriminator or stays opaque+coalesced. (Non-blocking.)

**Resolved:** built-in filter operators = the **type-aware standard set** (UX `LAYER-FILTER-MENU`): text equals/not/contains/starts-ends/blank; number & date =/≠/>/</between/blank; set/list; plus custom `FilterPredicate`.

## Dependencies & Cross-references
- **Projects from:** `ENTITY-*` (Domain). **Each element owned by** a `COMPONENT-*` (Architecture), **serves** a `CAP-*` (P&R).
- **References:** `SEC-RENDERER-DOM-ONLY`/`-PASTE-UNTRUSTED`/`-EXPORT-FORMULA-GUARD` (Security), `A11Y-*`/`BIND-KEYS` (Accessibility), `INV-*`/`getChanges` (Domain — Domain's invariants trigger the `source:'config'`/`'operation'` `ERR-*` codes owned here).

## Examples / Worked scenarios
- *Await + result:* `const r = await grid.updateCell('r42','price',9.99)` → `r = { rowKey:'r42', columnId:'price', oldValue:8, newValue:9.99, changeState:'dirty' }`; `EVT-AFTER-EDIT` fires with the same projection.
- *Vetoed paste:* `EVT-BEFORE-PASTE` handler calls `preventDefault()` → `paste()` resolves without applying; no `EVT-AFTER-PASTE`.
- *Worker error surfaced:* a throwing comparator → `sort()` rejects with `GridError{ code:'WORKER_OP_FAILED', source:'data-op' }` and `EVT-ERROR` fires (never console-only).

## Design Decisions
| Decision | Rationale |
|---|---|
| Async data API resolves a result object + fires after-event | Operator-chosen; await-ergonomic and observable. |
| Typed `GridError` with string `code` + `context` | Operator-chosen; discoverable, matches the total error model. |
| camelCase, single-sourced shared types | Removes the casing/field-selection drift the spec warns of (#19). |
| One canonical bound (`getRows` range vs `rowCount`) | DTO bound derives from the same `rowCount`; no reconcile-by-arithmetic. |
| `MSG-*` is a first-class typed contract | Intra-process wire schema with network-event drift potential (spec DD#9). |
| E2E-gated `ERR-*` rows name E2E-usable forcings | Forcing + tier authored together (spec DD#10). |

## Contracts
The typed element tables, the `EVT-*`/`MSG-*` payload projections, the `DOM-*`/`BIND-*` hooks, and the `ERR-*` catalog above **are** the contracts — each with signature, projection, optionality/empty, errors, side-effects, owner, and served capability.

## Acceptance criteria
- **AC-RESULT:** every async data mutation resolves the documented result object AND fires its `EVT-AFTER-*` with the same projection.
- **AC-VETO:** a `preventDefault()` in any `EVT-BEFORE-*` aborts the action; no `after` fires; state unchanged.
- **AC-ERR-TYPE:** every surfaced error is a `GridError` with a catalog `code`; no raw framework/worker error reaches the caller or dies console-only.
- **AC-ERR-CATALOG:** each `ERR-*` row is reproducible by its named forcing at its proving tier (validator reject → E2E; throwing comparator → E2E; overlapping merge → unit).
- **AC-EMPTY:** an empty `FilterSpec` returns all rows (not an error); an absent optional arg uses the default.
- **AC-BOUND:** `getRows` with a range past `rowCount` clamps and returns only in-range rows.
- **AC-STATE-VERSION:** `restoreState` accepts current + documented prior `version`s; an edit round-trips through serialize→restore.
- **AC-MSG:** every `MSG-*` carries `reqId`; a superseded-`version` `MSG-WINDOW` reply is dropped.
- **AC-SELECTION-SET** *(v1.3)*: `getSelection()` returns a **range-set**; `addRange`/Ctrl+click yields ≥2 disjoint `ranges`; `selectRow`/`selectColumn` materialize a full-axis range (+ a `lines` entry); `selectAll` selects the sheet; `EVT-SELECTION-CHANGE` carries the full set.
- **AC-HEADER-CONFIG** *(v1.3)*: a `header` with `columns.bands:N`/`rows.bands:M`/`corner`/a spanning `render` renders the bands + spans (`aria-colspan`/`-rowspan`/`data-band`); an overlapping span throws `INVALID_OPTIONS`; each sub-flag off removes only its affordance.
- **AC-HEADER-SPAN-SELECT** *(v1.4.1)*: clicking a spanning header cell covering columns *[c..c+n)* selects the full column range *[c..c+n)* (all `n` columns `aria-selected`), not just column `c`; a sorted column shows `aria-sort` on exactly one (affordance) cell.
- **AC-COLUMN-MANAGE** *(v1.3)*: `hideColumn`/`showColumn` toggle `hidden` + reproject (idempotent); `pinColumn(id,'leading')` forms a leading contiguous block (RTL-aware); `autofitColumn`/`autofitAllColumns` set widths from a bounded visible-content measure; each fires its `EVT-COLUMN-*`; an unknown id throws `INVALID_COLUMN_DEF`.
- **AC-MENU-CONFIG** *(v1.4)*: with no `menu` option the **default builder** shows the cell items + the header items; a custom `MenuBuilder` branching on `ctx.target.kind` returns **distinct** cell vs header menus; a `builtinItems.*` factory and a raw `{ command }` id both invoke the built-in behavior; a built-in whose capability flag is off is **absent** (auto-hidden); `openMenu(target, position)` opens the menu programmatically + fires `EVT-MENU-OPEN`; `menu:false` yields no context menu; a `custom` item's `render` `Node` is mounted as-is; an unknown `command` string throws `INVALID_OPTIONS`.

