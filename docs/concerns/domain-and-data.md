---
artifact: product-doc
role: concern
concern-id: domain-and-data
behavior: core
trigger: always
in-scope-subaspects: [domain-entities-relationships, identifiers, business-invariants-rules, lifecycle-states, data-classification-tags]
current-rung: contract-grade
status: published
version: 1.1.0
---

# Domain & Data — mini-grid

> One-line: the grid's own **in-memory** model — sheet, columns, rows, derived cells, styles, ranges, selection, merges, groups, rules, edit sessions, history — with typed fields, checkable invariants (each naming its enforcement), and full lifecycle rules. No datastore; row data is host-supplied.

## Purpose & Scope

Owns the canonical **entities** (`ENTITY-*`) and **invariants** (`INV-*`) of the grid's in-memory model, plus identifier formats, lifecycle states, and the (uniform) data-classification stance. The model is conceptual/in-memory — **no persistence layer** (Non-goals). Row *content* is host-supplied; mini-grid owns structure and behavior around it. **No user accounts → no `ENTITY-USER`.**

## Non-goals / Out-of-scope
- `persistence-storage-schema` — *(absent)* no datastore; rows from an in-memory array (v1) or the async DataSource adapter (**deferred v2**).
- `consistency-transactions` — *(absent)* no transactional store; mutations are in-memory state changes with an undo/redo command stack.
- `migrations-versioning` — *(absent)* no persisted domain schema. (Serialized *layout/state* format versioning is owned by Interfaces → `versioning-compatibility`.)
- `reference-seed-data` — *(absent)* ships no seed data.

*(End-user column insert/delete **is in v1** — see the column-CRUD lifecycle below.)*

## Requirements

### Entities & typed fields (`ENTITY-*`)

**`ENTITY-SHEET`** (singleton) — `columns: Column[]` (display order) · `totalRowCount: number` (pre-filter) · `rowCount: number` (post-filter, logical) · `keyField: string | null` · `freeze: FreezePane` · `merges: MergeRegion[]` · `groups: GroupNode[]` · `conditionalRules: ConditionalRule[]` · `sortSpec: SortSpec` · `filter: Filter` · `selection: Selection` · `history: History` · `dataSource: DataSource` · `rowHeights: Map<RowKey, number>` (sparse per-row height overrides from row-resize; default from options; measured wrap heights cached in the renderer — `ADR-ROW-HEIGHT`).

**`ENTITY-COLUMN`** — `id: string` *(stable identifier, unique)* · `field: string` (dot-path into the row object) · `header: string` · `type: 'text'|'number'|'date'|'boolean'|'select'|'custom'` · `width: number` (px) · `editable: boolean` · `editor?: EditorSpec | CustomEditorRef` · `validation?: ValidationRule[]` · `formatMask?: string | FormatterFn` · `defaultStyle?: CellStyle` · `comparator?: (a,b)=>number` · `flags: { sortable: boolean; filterable: boolean; resizable: boolean; reorderable: boolean }` · *(v1.3, `additive`)* `hidden?: boolean` (default `false`; a hidden column is **excluded from the view + ordered index projection** — `INV-COLUMN-HIDDEN-EXCLUDED` — but retains its `id`/`field`/styles so show restores it; **not** the same as delete, which drops the field) · `pinned?: 'leading'` (leading-edge pin; RTL-aware; pinned columns form a **leading contiguous block** — `INV-COLUMN-PIN-LEADING`; no trailing option). Header rendering/tooltip (`headerRender`/`headerTooltip`) are Interfaces `ColumnDef` projections of the header config, **not** stored domain fields.

**`ENTITY-ROW`** — `key: RowKey` *(identity)* · `data: object` (host record) · `changeState: 'clean'|'dirty'|'new'|'removed'`.
`RowKey = string | number` — the host value at `keyField`, or the positional index (number) when `keyField` is null.

**`ENTITY-CELL`** *(derived — not stored)* — identity `(rowKey, columnId)` · `value: unknown` (**always** `= row.data[column.field]`) · `resolvedStyle: CellStyle` (computed cascade) · `merge: MergeRegion | null`.

**`ENTITY-CELL-STYLE`** *(sparse overlay, keyed `(rowKey, columnId)`)* — all optional: `textColor?: string` · `fillColor?: string` · `fontFamily?: string` · `fontSize?: number` · `fontWeight?: number|'bold'` · `italic?: boolean` · `underline?: boolean` · `borders?: { top?; right?; bottom?; left?: { style: 'thin'|'medium'|'thick'|'dashed'|'dotted'; color: string } }` · `align?: { h?: 'start'|'center'|'end'; v?: 'top'|'middle'|'bottom' }` · `wrap?: boolean` · `indent?: number` · `formatMask?: string`.

**`ENTITY-RANGE`** *(value object)* — `top: number` · `left: number` · `bottom: number` · `right: number` (inclusive logical indices; normalized `top≤bottom`, `left≤right`).

**`ENTITY-SELECTION`** *(changed v1.3 — `breaking`: now a **multi-range set**, superseding the single-range + shift-extend model the code built)* — `ranges: Range[]` (a set of **disjoint** rectangular ranges; Ctrl/Cmd+click adds one) · `lines: { kind: 'row' | 'column'; index: number }[]` (**line selections** from header clicks — each also materialized into `ranges` as a full-axis range so range-readers see the whole row/column) · `activeCell: { rowKey: RowKey; columnId: string } | null` · `anchor: { row: number; col: number } | null`. **No checkbox/`selectedKeys` state** — the range-set is the whole model. Line-select, disjoint add, and corner select-all are the `CAP-SELECT` interactions (Interfaces `LIB-SELECTION`).

**`ENTITY-MERGE-REGION`** — `range: Range` (covers ≥2 cells) · `anchor: { row: number; col: number }` (= range top-left).

**`ENTITY-FREEZE-PANE`** — `frozenRowCount: number` (≥0) · `frozenColCount: number` (≥0). *(Public `setFrozen`/`getFrozen` + the realized `FreezePane` value type use the short field names `{ rows, cols }`; `EVT-*-FREEZE-CHANGE` projects `{ frozenRowCount, frozenColCount }` — same semantics.)*

**`ENTITY-GROUP-NODE`** — `id: string` · `axis: 'row'|'column'` · `start: number` · `span: number` (≥1) · `level: number` · `collapsed: boolean`.

**`ENTITY-CONDITIONAL-RULE`** — `id: string` · `scope: Range[]` · `kind: 'value'|'text'|'colorScale'|'dataBar'|'iconSet'|'custom'` · `config: RulePredicate | PredicateFn` · `style?: CellStyle` (value/text kinds) · `priority: number`.

**`ENTITY-SORT-SPEC`** — `entries: { columnId: string; direction: 'asc'|'desc' }[]` (order = precedence).

**`ENTITY-FILTER`** — `perColumn: Record<columnId, FilterPredicate>` (AND-combined; absent/empty entry = no filter on that column).

**`ENTITY-EDIT-SESSION`** *(≤1 active)* — `target: { rowKey; columnId }` · `editorKind` · `draftValue: unknown` · `state: 'editing'|'validating'|'committed'|'rejected'|'cancelled'` · `errors: ValidationError[]`.

**`ENTITY-HISTORY`** — `undoStack: Command[]` · `redoStack: Command[]` · `maxDepth: number | null` (configurable; **default null = unlimited**, confirmed).
**`ENTITY-HISTORY-ENTRY` (`Command`)** — `kind: 'edit'|'paste'|'insertRows'|'removeRows'|'insertCols'|'removeCols'|'merge'|'unmerge'|'freeze'|'group'|'ungroup'|'resize'|'reorder'|'style'|'conditionalRule'|'sort'` · `apply(): void` · `revert(): void` · `targetThread: 'worker'|'main'`. **`sort` is recorded** (Excel parity — a sort is undoable). **`filter` is NOT recorded** (transient view state, re-issued via API/UI — matches Excel, where applying/clearing a filter is not undoable).

**`ENTITY-DATA-SOURCE`** — `kind: 'in-memory'` → `{ rows: object[] }` (v1) | `kind: 'adapter'` → async interface (**deferred v2**).

**`ENTITY-FORMULA-CELL`** *(v1.5, sidecar — not a dense store; gated by the `formula` flag)* — `cellId: number` *(positional identity `rowIndex·2^14 + colIndex` — the v1.5.1 numeric-key optimization; positions are stable between structural rebuilds)* · `src: string` (raw `=…`, the **source of truth**) · `ast: FormulaNode` · `refs: CellId[]` (resolved precedents) · `value: FormulaValue` (last computed result **or** an `ENTITY-FORMULA-ERROR`) · *(v1.6, additive)* `volatile: boolean` (derived at parse time from whether the AST contains any volatile function — `CAP-FORMULA-VOLATILE`; `INV-FORMULA-VOLATILE`). Held in a `Map<cellId, FormulaCell>` in the engine; the computed `value` is mirrored into `row.data[field]` (`INV-FORMULA-DERIVED`), so `ENTITY-CELL` stays derived and every existing read path observes the result.

**`ENTITY-DEP-GRAPH`** *(v1.5)* — `formulas: Map<CellId, ENTITY-FORMULA-CELL>` · `dependents: Map<CellId, Set<CellId>>` (reverse edges) · derived `precedents` per formula · *(v1.6, additive)* `volatileCells: Set<CellId>` (the index of formula cells whose `volatile` flag is set — `CAP-FORMULA-VOLATILE`; every recalc seeds the dirty set with `edited ∪ volatileCells`, `INV-FORMULA-VOLATILE`). Keyed by a **numeric positional cell id** (`rowIndex·2^14 + colIndex`, v1.5.1 opt); the recalc engine (`COMPONENT-DATA-WORKER`) topologically orders it (`INV-FORMULA-ACYCLIC`) and BFS-dirties it on a single-cell commit (`INV-FORMULA-INCREMENTAL`).

**`ENTITY-FORMULA-ERROR`** *(v1.5, tagged sentinel)* — one of the seven v1.5 codes `#DIV/0!` · `#VALUE!` · `#NAME?` (unknown fn/ref) · `#REF!` (out-of-grid) · `#N/A` · `#NUM!` · `#CIRC!` (cycle), plus *(v1.6, additive)* `#SPILL!` (a spill range is blocked — `CAP-FORMULA-ARRAY`, `INV-SPILL-EMPTY`/`-NONOVERLAP`) and `#CALC!` (an array-calc error: empty array, nested array, mismatched array dims). A **tagged value**, never a bare string — a *literal* text `"#REF!"` in data is not an error. Propagates through operators/functions except where trapped by `IFERROR`/`IFNA`/`ISERROR`/`ISNA`. *(The data-type/async error family — `#GETTING_DATA`, `#FIELD!`, `#CONNECT!`, `#BLOCKED!`, `#BUSY!` — is **absent**: no linked data types / async sources exist here.)*

**`ENTITY-SPILL-RANGE`** *(v1.6, `CAP-FORMULA-ARRAY`; sidecar — the materialized dynamic array)* — `anchor: CellId` (the cell holding the array formula) · `rows: number` · `cols: number` · `values: FormulaValue[]` (row-major). The anchor **owns** the rectangle of covered cells (model mirrors `ENTITY-MERGE-REGION`): a non-anchor spill cell is a **projection** that displays its array element but is not an independent stored cell — editing it is blocked/redirected to the anchor (`INV-SPILL-PROJECTION`, `INV-SPILL-ANCHOR-OWNS`). Each projected value is mirrored into its `row.data[field]` (extends `INV-FORMULA-DERIVED`), spill-owned, so sort/filter/format/export observe spilled values. The `A1#` reference addresses the anchor's **current** spill range.

**`ENTITY-CELL-REFERENCE`** *(v1.6, `CAP-FORMULA-REFVAL`; evaluator value type — built as `ReferenceValue` in `eval-types.ts`)* — `{ kind: 'reference'; top: number; left: number; rows: number; cols: number }` — a rectangular region in **canonical** (0-based) coordinates (order-normalized), distinct from a materialized array. Used where a **scalar** is expected it materializes to its top-left (single cell) or `#VALUE!` (multi-cell in scalar context); used by a **range consumer** (`SUM`, `COUNT`, …) it materializes to the region's values. A reference resolving wholly/partly outside the grid → `#REF!` (`INV-REF-INGRID`); `OFFSET`/`INDIRECT` resolve their region **at eval time** ⇒ their formula is volatile (`INV-REF-DYNAMIC-DEP`).

### Identifiers
- **`ENTITY-COLUMN.id`** — developer-supplied stable string, unique within the sheet; identity is position-independent (reorder changes order, not `id`).
- **`RowKey`** — host value at `keyField` (any string/number, unique) **or** positional index when `keyField` is null. *Constraint:* reliable `getChanges()` diffing + edit/selection stability under sort/filter/CRUD require a host key; index-fallback identity is positional/best-effort.
- **Rule/group/merge ids** — internal stable string tokens minted by the grid; never reused.
- **No UUIDs owned** (no persistence); no UUID-version semantics apply.

### Business invariants (`INV-*`) — checkable + named enforcement
| ID | Checkable condition | Enforcement |
|---|---|---|
| `INV-COLKEY-UNIQUE` | ∀ i≠j: `columns[i].id ≠ columns[j].id` | **By-construction**: columns indexed into `Map<id,Column>` at bind/`updateOptions`; duplicate id → **throw `DUPLICATE_COLUMN_ID`** (Interfaces `ERR-*`, `source:'config'`). |
| `INV-ROWKEY-UNIQUE` | with `keyField`: ∀ i≠j: `rows[i].key ≠ rows[j].key` | **By-construction at bind** via `Map<key,row>`. **Default: throw `DUPLICATE_ROW_KEY`**; with `onDuplicateKey:'last-wins'` later overwrites (then **advisory**). |
| `INV-CELL-DERIVED` | ∀ cell: `cell.value === row(cell.rowKey).data[column(cell.columnId).field]` | **By-construction**: no dense cell store; reads project from the row. |
| `INV-MERGE-NONOVERLAP` | ∀ m1≠m2: `m1.range ∩ m2.range = ∅`; every merged cell ∈ exactly one region with one anchor | **By-construction**: `merge()` validates against existing regions; overlap rejected (`MERGE_OVERLAP`, `source:'operation'`). |
| `INV-MERGE-MIN2` | every merge covers ≥2 cells | **By-construction**: 1-cell merge rejected; shrink-to-1 dissolves the region. |
| `INV-RANGE-BOUNDS` | ∀ Range r: `0≤r.top≤r.bottom<rowCount` ∧ `0≤r.left≤r.right<colCount` | **By-construction**: ranges validated/clamped on creation and **re-clamped** after every structural change. |
| `INV-FREEZE-PREFIX` | `0≤frozenRowCount≤rowCount` ∧ `0≤frozenColCount≤colCount` | **By-construction**: `setFrozen` clamps; structural change re-clamps. |
| `INV-GROUP-NEST` | ∀ same-axis nodes a,b: ranges disjoint **or** one contains the other (proper nesting → forest) | **By-construction**: `group()` validates nesting; partial overlap rejected. |
| `INV-SELECTION-ACTIVE` | selection non-empty ⇒ `activeCell≠null` ∧ ∈ some range; empty ⇒ `activeCell=null` | **By-construction**. |
| `INV-SELECTION-WELLFORMED` *(v1.3)* | every range in `ranges` is **well-formed and non-empty** (`INV-RANGE-BOUNDS` holds per range); the set is **disjoint** (no two ranges overlap; an added range that touches/overlaps an existing one is coalesced or kept separate per the add policy, never producing a double-counted cell) | **By-construction**: `addRange`/`selectRow`/`selectColumn`/`setSelection` validate + clamp + normalize each range; re-clamped after every structural change. |
| `INV-SELECTION-LINE` *(v1.3)* | a `lines` entry of `kind:'row'` materializes a range spanning **all columns** (`left=0,right=colCount-1`) at that row; `kind:'column'` spans **all rows** (`top=0,bottom=rowCount-1`) at that column | **By-construction**: line-select builds the full-axis range from current extents; re-derived on extent change. |
| `INV-COLUMN-HIDDEN-EXCLUDED` *(v1.3)* | a column with `hidden===true` appears in **no** view row and in **no** ordered/visible column-index projection (its `id`/`field`/style overlays are retained for restore) | **By-construction**: the visible-column projection filters `hidden`; index/render read the projection. |
| `INV-COLUMN-PIN-LEADING` *(v1.3)* | all `pinned:'leading'` columns occupy a **contiguous block at the leading edge** of the visible order (trailing edge under RTL); unpinned columns follow | **By-construction**: the visible-column projection sorts pinned-leading first (stable within group); reorder/pin/hide re-derive it. |
| `INV-EDIT-SINGLE` | at most one `EditSession` with `state ∈ {editing,validating}` | **By-construction**: single slot; `beginEdit` while active resolves the prior per commit/cancel policy. |
| `INV-HISTORY-LINEAR` | new command after an undo clears `redoStack`; `revert()` restores prior state exactly; `|undoStack| ≤ maxDepth` (oldest dropped) | **By-construction**: stack ops. |
| `INV-ROWSTATE` | `changeState` follows the state machine (below); `new→removed` drops the row entirely | **By-construction**. |
| `INV-FORMULA-DERIVED` *(v1.5)* | a formula cell's `row.data[field]` always holds its last **computed** value; its `src` lives only in the sidecar `Map` | **By-construction**: recalc writes results into `data[field]`; the edit-seed reads `src` from the map. |
| `INV-FORMULA-ACYCLIC` *(v1.5)* | the evaluated graph is a DAG; any cycle yields `#CIRC!` on its members (no infinite loop) | **By-construction**: Kahn topo — unreached nodes are marked `#CIRC!`. |
| `INV-FORMULA-INCREMENTAL` *(v1.5)* | a single-cell recalc touches only the edited cell's transitive `dependents` | **By-construction**: BFS over `dependents`, topo-order the subset only. |
| `INV-FORMULA-REBUILD` *(v1.5; A1-translation built)* | after a structural row/col mutation, every formula's A1 references are **translated** (shifted by the signed count, or `#REF!`-ed inside a deleted band), the source re-serialized, and the graph fully recomputed | **By-construction**: `IndexEngine.insertRows`/`removeRows` call `FormulaEngine.applyStructural` (`translateAst` + `formatAst` + re-resolve + `recalcAll`). |
| `INV-FORMULA-VOLATILE` *(v1.6)* | **every** recalc pass (full or incremental) includes all `volatileCells` **and their transitive dependents** in the dirty set — so editing *any* cell re-rolls every `RAND` and re-evaluates every `NOW` | **By-construction**: the incremental dirty closure is seeded with `edited ∪ volatileCells`; `volatile` derived at parse time. |
| `INV-REF-INGRID` *(v1.6)* | a reference (`ENTITY-CELL-REFERENCE`) resolving wholly/partly outside the grid yields `#REF!` | **By-construction**: reference resolution bounds-checks against the canonical grid extents. |
| `INV-REF-DYNAMIC-DEP` *(v1.6)* | any formula containing `OFFSET`/`INDIRECT` is **volatile** and re-resolves its region each evaluation — the graph adds a conservative dependency, not a static edge | **By-construction**: `OFFSET`/`INDIRECT` mark the cell `volatile` (binds `CAP-FORMULA-REFVAL`→`CAP-FORMULA-VOLATILE`); no static precedent edge is emitted for the dynamic target. |
| `INV-SPILL-EMPTY` *(v1.6)* | a spill materializes only if **every** non-anchor target cell in the spill range is empty at spill time; otherwise the anchor shows `#SPILL!` and spills nothing | **By-construction**: spill-collision check over the target rectangle before materializing. |
| `INV-SPILL-PROJECTION` *(v1.6 delta; edit-guard **specced, build pending**)* | a non-anchor spill cell **displays** the array element but is **not** an independent stored cell; a typed edit / F2 / paste targeting it is **blocked** and selection **moves to the anchor** (only the anchor holds a formula) | **To be enforced** by the spill **edit-guard** (spill-surface delta, unbuilt — see `IMPLEMENTATION.md` 45d): on an edit attempt whose target falls inside a live spill range (via `LIB-FORMULA-SPILL`), the edit is rejected and selection is set to the owning `anchor`; a paste drops the overlapping cells **per-cell** (like `LIB-FORMULA-ENTRY`). Until the guard lands, the projection half holds **by construction** (the engine never stores a non-anchor formula; spilled values are `writeDisplay` projections), but the edit-block is not yet realized. |
| `INV-SPILL-NONOVERLAP` *(v1.6)* | no spill range overlaps literal data, another formula, or another spill/merge region; a collision blocks the spill (`#SPILL!`) | **By-construction**: the spill-time collision check rejects any occupied/covered target cell. |
| `INV-SPILL-ANCHOR-OWNS` *(v1.6)* | clearing/rewriting the anchor clears the whole spill range; the anchor is the single editable cell; on recompute the range grows/shrinks and vacated cells are released | **By-construction**: the anchor owns the spill rectangle (mirrors `INV-MERGE-*`); resize re-projects the delta + re-checks collisions. |
| `INV-INTERSECT-SCALAR` *(v1.7; `CAP-FORMULA-INTERSECT`)* | an `@`-prefixed sub-expression always evaluates to a **single scalar** (the row/column intersection) or `#VALUE!` — never an array, so it never spills | **By-construction**: the evaluator's `@` operator reduces its operand to the anchor-row/col element (1×1 → identity; no intersection → `#VALUE!`) before returning. |

### Lifecycle & states
**Cell edit:** `idle → editing → validating →` **`committed`** (valid → command mutates `row.data`, `changeState:'dirty'`, push `edit` Command) **| `rejected`** (invalid → stay `editing`, error shown, value not applied) **| `cancelled`** (draft discarded). Editing a **merged region** targets the **anchor** cell `(anchor.row, anchor.col)`; non-anchor covered cells are non-editable (confirmed). **Commit trigger** is normally Enter/Tab/blur; *(v1.1)* an editor may declare **immediate-commit** so its value commits on the editor's own `change` event — the **`boolean`/checkbox editor uses immediate-commit** (the toggled state is applied on `change`, before any blur can discard it).

**Row change-tracking:** `clean → dirty` (edit); `→ new` (insert); `{clean,dirty} → removed` (delete, tombstoned for diff); `new → removed` drops the row. `getChanges()` = `{ new, dirty, removed }` by key (requires `keyField`; else best-effort). Undo reverses each transition.

**Bind / rebind (`setData`):**
- **Duplicate keys:** configurable — **default reject** (`DUPLICATE_ROW_KEY`), `onDuplicateKey:'last-wins'` for lenient overwrite.
- **Rebind semantics:** configurable — **default reset** (undo/redo history cleared, selection cleared, change-tracking reset — a clean slate); `preserveOnRebind:true` best-effort re-maps selection/history to surviving keys and drops the rest.

**Structural adjustment on row/column insert & delete** (keeps `INV-RANGE-BOUNDS`/`-MERGE-*`/`-FREEZE-PREFIX`/`-GROUP-NEST` valid):
- **Insert** at index `i` (count `n`): all ranges/merges/group spans/freeze at ≥`i` shift by `+n`. A merge/group **spanning** `i` **expands** by `n` (matches Excel: inserting inside a merged block expands it). Inserting within the frozen prefix (`i < frozenCount`) increments the frozen count — **mini-grid's count-based model** (Excel's freeze is positional, so this is our behavior, not exact Excel parity).
- **Delete** rows/cols in `[i, i+n)`: ranges/merges/groups/freeze shift by `-n`; a **merge intersecting** the deleted span **shrinks to the survivors**, and **dissolves** if it collapses to ≤1 cell (`INV-MERGE-MIN2`); a group span shrinks, and the node is removed if `span→0`; deleting within the frozen prefix decrements the frozen count; selection is re-clamped. `removed` rows are tombstoned unless they were `new` (then dropped).
- **Column insert (end-user, v1):** inserts a **blank** column at the target index — the grid mints a fresh `id` + `field`; existing columns shift right; every row gets an empty value at the new field. Undoable (`insertCols`), vetoable (`EVT-BEFORE-INSERT-COL`).
- **Column delete (end-user, v1):** removes the `ColumnDef` + its cell-style overlays **and deletes the field key from every row's `data`** (destructive → affected rows become `dirty`, reflected in `getChanges`). Column-axis merges/groups/freeze/ranges adjust by the same shift / shrink-to-valid / dissolve rules as rows. Undoable (`removeCols`, restoring the def + field values on revert), vetoable (`EVT-BEFORE-DELETE-COL`). (Developer config changes via `updateOptions` apply the same column-axis adjustments.)

**Undo scope:** built-in undo/redo covers `edit`, **`paste`** (incl. cut/fill — one Command per operation), `insertRows`/`removeRows`, `insertCols`/`removeCols`, `merge`/`unmerge`, `freeze`, `group`/`ungroup`, `resize`, `reorder`, `style`, `conditionalRule`, and **`sort`** (Excel parity — a sort is undoable). **Filter is transient view state, not on the undo stack** (matches Excel — applying/clearing a filter is not undoable) — re-issued via API/UI. `maxDepth` configurable (default unlimited).

**Sheet/data:** `bound → mutated → rebound` per the rebind rules above.

### Data classification (`data-classification-tags`)
mini-grid defines **no business fields of its own** → owns **no field-level `pii`/`sensitive`/`secret` tags**. Every cell value is treated as **opaque, potentially-sensitive untrusted content**, handled uniformly: escaped-by-default on render, never logged (mechanisms owned by Security `SEC-ESCAPE-DEFAULT`/`SEC-NO-LOG-VALUES`). Classification remains host-owned.

## Open Questions
- None blocking Contract-grade. (SR behavior of large `aria-rowcount` is an A11y test item, not a Domain gap.)

## Dependencies & Cross-references
- **Realizes:** `CAP-EDIT`/`-VALIDATE`/`-UNDO`/`-MERGE`/`-GROUP`/`-FREEZE`/… (P&R).
- **Referenced by:** Interfaces (`LIB-*` project from these entities; `DUPLICATE_ROW_KEY`/`DUPLICATE_COLUMN_ID` on dup keys/ids; `getChanges`), Architecture (`COMPONENT-DATA-WORKER` owns row store; `COMPONENT-STORE` owns structural entities), Quality (each `INV-*` → an assertion), Security (values treated as untrusted).

## Examples / Worked scenarios
- *Edit → dirty → undo:* edit `(r42, price)`; session validates + commits; `row(r42).data.price` updated (`INV-CELL-DERIVED`), `changeState:'dirty'`, `edit` Command pushed; `undo()` reverts value + state (`INV-HISTORY-LINEAR`, `INV-ROWSTATE`).
- *Merge shrink on delete:* merge `A1:A3`; delete row 2 → merge becomes `A1:A2`; delete again → dissolves (`INV-MERGE-MIN2`).
- *Dup-key bind:* `setData` with two rows keyed `"x"` and default policy → throws `DUPLICATE_ROW_KEY`.

## Design Decisions
| # | Decision | Rationale |
|---|---|---|
| 1 | In-memory only; no persistence entity. | Client-side library; storage is the host's. |
| 2 | Row identity = host key, index fallback. | Stable identity when available; still works without, at best-effort diffing. |
| 3 | Column identity = stable `id`. | Reorder must not change identity keyed on by styles/rules/edits. |
| 4 | Cell = derived value + sparse style overlay. | Memory-efficient at 1M rows; single source of value (`INV-CELL-DERIVED`). |
| 5 | Full CRUD + `changeState`. | Data-entry + host persist-diffs; needs a host key to be reliable. |
| 6 | Conditional-format result > manual cell style, per property. | Excel cascade: column default → cell overlay → conditional rule. Confirmed. |
| 7 | Uniqueness invariants name enforcement; `INV-ROWKEY-UNIQUE` advisory under last-wins. | Can't structurally prevent host duplicates beyond the index Map. |
| 8 | Duplicate-key + rebind are configurable, default reject/reset. | Safe predictable defaults; escape hatches for lenient/incremental hosts. |
| 9 | Undo covers data + structural + **sort** (Excel parity); **filter** excluded. | Excel undoes a sort but not a filter; mini-grid matches. Filter is re-issuable query state. |
| 10 | Row insert/delete shrink-to-valid for merges/groups/freeze. | Keeps merge/range/freeze/group invariants valid automatically; least disruptive. |
| 11 | End-user column insert (blank, grid-minted field) / delete (destructive — drops the field from row data). | Operator-chosen; full spreadsheet column ops in v1. Delete marks affected rows `dirty`. |
| 12 | Selection is a **disjoint range-set** + line ranges; no checkbox/`selectedKeys` state (`breaking`). | Worksheet parity: Ctrl+click ranges, header line-select, corner select-all are the model. `ranges: Range[]` was already the field, but the semantics (disjoint set + line materialization) and the built single-range code both change → classified `breaking`. |
| 13 | `hidden`/`pinned` are **view-projection** column fields, not destructive. | Hide keeps the field (unlike column delete); leading-pin extends the freeze prefix (`INV-FREEZE-PREFIX` model), no trailing pin — matches the count-based freeze. The header **config** stays Interfaces-owned grid options, not a domain entity. |

## Contracts
The `ENTITY-*` typed-field definitions, the `INV-*` table (condition + enforcement), and the lifecycle rules above **are** the contracts. Enforcement errors surface via the Interfaces `ERR-*` catalog (`DUPLICATE_ROW_KEY`/`DUPLICATE_COLUMN_ID`/`INVALID_OPTIONS` at `source:'config'`; `MERGE_OVERLAP`/`GROUP_OVERLAP` at `source:'operation'`). Nothing testable remains unspecified.

## Acceptance criteria
- **AC-COLKEY:** binding columns with a duplicate `id` throws `DUPLICATE_COLUMN_ID`.
- **AC-ROWKEY:** binding rows with a duplicate key throws `DUPLICATE_ROW_KEY` by default; under `last-wins`, later row wins and `totalRowCount` reflects the dedup.
- **AC-DERIVED:** after `updateCell(r,c,v)`, `row(r).data[field]===v`, the cell reads `v`, `changeState==='dirty'`; `undo()` restores the prior value + state.
- **AC-MERGE-OVERLAP:** creating an overlapping merge is rejected (`INV-MERGE-NONOVERLAP` holds).
- **AC-MERGE-DELETE:** deleting a row inside `A1:A3` yields `A1:A2`; a further delete dissolves the merge.
- **AC-BOUNDS:** after any insert/delete, all ranges/merges/groups satisfy `INV-RANGE-BOUNDS`; freeze counts satisfy `INV-FREEZE-PREFIX`.
- **AC-GROUP-NEST:** creating a partially-overlapping same-axis group is rejected.
- **AC-REBIND:** `setData` (default) empties undo/redo history and clears selection; with `preserveOnRebind`, surviving-key selection is retained.
- **AC-HISTORY:** a new command after `undo()` clears the redo stack; `maxDepth=N` bounds the undo stack to N.
- **AC-UNDO-SCOPE:** a `merge`, a `sort`, and a column insert are undoable/redoable; a `filter` change is not on the undo stack.
- **AC-COLCRUD:** inserting a column adds a blank grid-minted field to every row; deleting a column removes its field from every row's `data` (rows become `dirty`) and its `ColumnDef`; both undo/redo cleanly and emit vetoable `EVT-BEFORE-INSERT-COL`/`EVT-BEFORE-DELETE-COL`.
- **AC-SELECTION-SET** *(v1.3)*: two Ctrl+click ranges yield `ranges.length===2` (disjoint, `INV-SELECTION-WELLFORMED`); a row-header click adds a `lines` entry + a full-width range (`INV-SELECTION-LINE`); after a structural change all ranges still satisfy `INV-RANGE-BOUNDS`.
- **AC-COLUMN-HIDDEN** *(v1.3)*: setting `hidden` excludes the column from the projection (`INV-COLUMN-HIDDEN-EXCLUDED`) while retaining its `field`/styles; clearing it restores the column unchanged (distinct from destructive delete).
- **AC-COLUMN-PIN** *(v1.3)*: pinning columns leaves them a leading contiguous block (`INV-COLUMN-PIN-LEADING`), trailing under RTL; reorder/hide re-derive the block without corrupting it.

