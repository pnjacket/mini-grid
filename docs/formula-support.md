---
artifact: product-doc
role: feature-spec
feature-id: formula-support
spans-concerns: [product-and-requirements, domain-and-data, architecture, interfaces-and-contracts, user-experience, performance-and-scalability, security-and-privacy, quality-and-testing]
delta: v1.7
current-rung: contract-grade
status: built
version: 1.7.1
---

# Formula Support — mini-grid (v1.5 core + v1.6 catalog & advanced capabilities + v1.7 catalog completion, doc-feature)

<!--
  v1.5 (built): the formula engine — A1 refs, ~70 functions, typed errors,
  incremental recalc. Sections below marked with no version tag are v1.5.
  v1.6 (BUILT — this delta is now implemented): the full Excel-comparable function
  catalog (`CAP-FORMULA-FN` grew to **455** registry functions + 9 evaluator special
  forms) + the three advanced capabilities (`CAP-FORMULA-VOLATILE`,
  `CAP-FORMULA-REFVAL`, `CAP-FORMULA-ARRAY` spill engine) + locale-aware text
  formatting + structural-edit reference rewriting. See the "## v1.6 delta" sections,
  `docs/formula-functions.md` (the named catalog), and `IMPLEMENTATION.md` (the
  per-slice build record).
  v1.7 (BUILT): catalog completion — the ~20 deferred functions (registry 455 → 475)
  + the implicit-intersection `@` operator (`CAP-FORMULA-INTERSECT`). See the
  "# v1.7 delta" section + IMPLEMENTATION.md.
  STILL PENDING (specced, unbuilt): the v1.6 spill-surface delta — public
  `LIB-FORMULA-SPILL` / `EVT-SPILL-CHANGE` emission / `LAYER-SPILL-OUTLINE` /
  the spill edit-guard (engine substrate built; see IMPLEMENTATION.md 45d/45e).
-->


> One-line: opt-in **Excel-like in-cell formulas** — a cell whose raw value begins
> with `=` is parsed to an AST, evaluated against other cells addressed in **A1
> notation**, and its **computed result** flows through the existing derived-value
> pipeline (sort/filter/format/export/aggregate see the *result*, editing sees the
> *formula*). Recalculation is a **topologically-ordered, incrementally-dirtied
> dependency graph** — a single edit recomputes only its transitive dependents.
> Single-sheet only (no worksheets ⇒ **no cross-sheet references**, by definition).

## Purpose & Scope            <!-- rung: Sketch → Specified -->

Adds `CAP-FORMULA` to mini-grid: authored formulas, a **475-function library** (v1.5
shipped ~70; the v1.6 catalog + advanced capabilities and the v1.7 completion are built), cell + range
references, reference values, a dynamic-array spill engine, and a recalculation
engine with cycle detection and typed error values. Owned (implementation) by `COMPONENT-DATA-WORKER` (canonical data lives
there — consistent with `ADR-WORKER-OPS` / `ADR-CONDFMT-AGG`), gated by the
`formula` feature flag (`PATTERN-FEATURE-FLAGS`, **default off** — a leading `=`
stays literal text until a host opts in). A **first-class, fully-supported**
capability: the scope below is deliberately "full array of formula behaviour"
**minus** the items called out as `[FUTURE-SCOPE]`.

## Non-goals / Out-of-scope   <!-- rung: Sketch — LOAD-BEARING -->

### Built since the original delta
- **Reference rewriting on structural edits** *(now built — was `[FUTURE-SCOPE]`)* —
  inserting/removing a row/column **rewrites** the A1 references across all formulas
  so they keep pointing at the same data: a reference at/after the mutation point
  shifts (`=A5` → `=A6` on an insert above), a reference inside a deleted band becomes
  `#REF!`, and the re-serialized source updates what the editor shows. Absolute refs
  shift too (the data itself relocated). See `INV-FORMULA-REBUILD` + `translateAst`/
  `formatAst`/`applyStructural`. *(Column inserts are append-only, so no column
  translation is needed; a non-contiguous canonical row delete falls back to a plain
  positional rebuild.)*

### Deferred (buildable later — `[FUTURE-SCOPE]`)
- **Named ranges, structured table refs (`Table[Col]`), whole-column/row refs
  (`A:A`/`1:1`), iterative (circular-by-design) calc, `.xlsx` live-formula export** —
  deferred; export emits the **computed value** (`SEC-EXPORT-FORMULA-GUARD`).
- *(The former "handful of catalog functions" gap is **closed** — the v1.7 delta built
  the odd-period bonds, array-result regression, matrix, `GROUPBY`/`PIVOTBY`, multi-return
  `XLOOKUP`, `AREAS`, `PROB`, `MODE.MULT`, `ARRAYTOTEXT`, `ISOMITTED`, and the `@` operator.
  `INFO` is **not** deferred — it is fully `ABSENT` by design, see Non-goals below.)*

### Absent (architecturally impossible in mini-grid — `ABSENT`, the subject cannot exist)
These `~30` Excel functions are **out of scope by design**, each blocked by a
mini-grid architectural fact (not a matter of effort). Enumerated so the catalog is
honestly closed.
| Function(s) | Blocking fact |
|---|---|
| `WEBSERVICE`, `RTD`, `STOCKHISTORY`, `IMAGE` (URL fetch), `DETECTLANGUAGE`, `TRANSLATE`, `ARRAYTOTEXT`-web, linked **Stocks/Geography** data types | **`SEC-NO-EGRESS`** — the grid makes **no** network request of its own (static-scanned in the bundle). A function that fetches from a URL/service cannot ship without breaking the security contract. |
| `CUBEMEMBER`, `CUBEVALUE`, `CUBESET`, `CUBEKPIMEMBER`, `CUBERANKEDMEMBER`, `CUBEMEMBERPROPERTY`, `CUBESETCOUNT` | **No OLAP / Power-Pivot data model** — there is no cube backend to query. |
| `GETPIVOTDATA` | **No pivot tables** — mini-grid has no pivot feature to read from. |
| `SHEET`, `SHEETS`, all `Sheet2!A1` cross-sheet refs | **No worksheets** — single sheet by design; these degenerate to `1` / `#REF!` (meaningless, so not offered). |
| Most `CELL(info_type)` (`"filename"`, `"format"`, `"color"`, `"protect"`, `"parentheses"`) and `INFO(type)` (`"directory"`, `"osversion"`, `"numfile"`, `"recalc"`) | **No workbook / file / OS context** to introspect. *(The data `CELL` info-types — `CELL("row"/"col"/"contents"/"type"/"width")` — ARE in scope; `INFO` is wholly out of scope — see the catalog.)* |
| `PHONETIC` | **No furigana metadata** — Excel stores per-cell phonetic strings; mini-grid's cell model has none. |
| `DBCS`, `ASC`, `BAHTTEXT`, `JIS` | Locale-display niche with **no meaningful mini-grid analog** (double-byte / Thai-baht spelled-number). *(`BAHTTEXT` is technically pure but deliberately out of scope as vanishingly niche.)* |

## Requirements               <!-- rung: Specified → Contract-grade -->

### Cell reference model (A1 notation) — `CAP-FORMULA-REF`
- **Column** letters map to the **canonical column order** as loaded: `A` = 1st
  column, `B` = 2nd, … `Z`, `AA`, `AB`, … (bijective base-26). Independent of the
  live view order / reorder / hidden state.
- **Row** numbers are **1-based canonical row indices** in **load (natural) order**:
  `A1` = column-A cell of the first-loaded row. **Independent of the active
  sort/filter** — a reference is absolute to the data grid, exactly like Excel.
- **Ranges** — `A1:B3` (rectangular, inclusive, order-normalized), `A:A` (whole
  column) and `1:1` (whole row) `[FUTURE-SCOPE]` — v1 supports bounded `A1:B3`.
- **Absolute/relative** — `$A$1` / `A$1` / `$A1` / `A1`. The relativity markers (`$`)
  are **recorded** at parse time and **honoured by structural-edit translation**
  (`INV-FORMULA-REBUILD` — an absolute ref that relocates still shifts); a bare `A1`
  is relative on both axes, `$A$1` fully absolute. *(Relative-ref translation on
  **drag-fill / copy-paste** — Excel's fill semantics — is `[FUTURE-SCOPE]`: a
  filled/pasted formula is currently copied **verbatim**, not shifted.)*

### Function library — `CAP-FORMULA-FN` *(ID minted in the P&R capability register; this section owns the semantics only)*
- **Operators** *(v1.5, built)*: arithmetic `+ - * / ^`, unary `-`/`+`, postfix `%`,
  text `&`, comparison `= <> < > <= >=`, parentheses. Excel precedence.
- **v1.5 built set (~70)** — math/agg, logical, text, lookup, date, info (the names
  in the built catalog below carry a `✅`).
- **v1.6 full catalog (built — 455 registry functions)** — the complete
  Excel-comparable set of **pure scalar/range** functions (no new engine capability): the full math/trig,
  **statistical**, **financial**, date/time, text, information, **engineering**, and
  **database** categories, plus the **`*IFS` family** (`SUMIFS`/`COUNTIFS`/
  `AVERAGEIFS`/`MAXIFS`/`MINIFS`). **The exhaustive named catalog — every function,
  grouped by category, tagged built `✅` / v1.6-pure / needs-a-capability — lives in
  [`docs/formula-functions.md`](formula-functions.md)** (`CAP-FORMULA-FN`). Functions
  that need a *new engine capability* (volatile recalc, a reference type, or the
  spill engine) are specified under the v1.6 capability sections below and tagged in
  the catalog.

### Typed error values — `ENTITY-FORMULA-ERROR`
*(v1.5, built)* `#DIV/0!`, `#VALUE!`, `#NAME?` (unknown function/ref), `#REF!`
(out-of-grid ref), `#N/A`, `#NUM!`, `#CIRC!` (cycle). *(v1.6, additive)* `#SPILL!`
(a spill range is blocked — `CAP-FORMULA-ARRAY`) and `#CALC!` (an array-calc error:
empty array, nested array, mismatched array dims). Errors **propagate** through
operators/functions (an operand that is an error yields that error) except where
trapped by `IFERROR`/`IFNA`/`ISERROR`/`ISNA`. *(The data-type / async error family —
`#GETTING_DATA`, `#FIELD!`, `#CONNECT!`, `#BLOCKED!`, `#BUSY!` — is **absent**: no
linked data types / async sources exist here.)*

### Storage & derived-value integration — `INV-FORMULA-DERIVED`
- The **formula source string** is the source of truth, held in a sidecar
  `Map<cellId, FormulaCell>` in the engine. The **computed value** is written into
  `row.data[field]` — so **every existing read path** (`LIB-GET-ROWS`, sort, filter,
  `LIB-COND-FMT`, `MSG-AGGREGATE`, `LIB-EXPORT`) observes the **result**, unchanged.
- The **edit seed** (`getCellValue` for an open editor / `LIB-UPDATE-CELL` old-value)
  returns the **formula string** for a formula cell (so editing shows `=A1+B1`, not
  its result). This is the single derived-pipeline hook.

### Recalculation — `CAP-FORMULA-RECALC`
- **Graph**: `precedents[cell]` = cells this formula reads; `dependents[cell]` =
  reverse. Keyed by a **numeric positional cell id** (`rowIndex·2^14 + colIndex`); positions are stable between structural rebuilds (`INV-FORMULA-REBUILD`).
- **Full recalc** — Kahn topological order over all formula cells; a cell whose
  topo-in-degree never reaches zero is in a cycle ⇒ `#CIRC!` on every cell of that
  cycle. O(V+E) + Σ eval cost.
- **Incremental recalc** — on a single-cell commit: (1) if the committed value is a
  formula, reparse it and rewrite its precedent/dependent edges; (2) collect the
  **dirty set** = the edited cell's transitive `dependents` (BFS); (3) topo-order
  **only that subset** and recompute, reading precedent results from the stored
  computed values. O(affected), **not** O(all) — the guarded property.
- **Structural rebuild** (`INV-FORMULA-REBUILD`) — a row/column insert/remove
  **rewrites** every formula's A1 references (`translateAst`): a reference at/after
  the mutation point shifts by the signed count, one inside a deleted band becomes
  `#REF!`, the source is re-serialized (`formatAst`) so the editor shows the updated
  text, then the graph fully recomputes. Sort/filter do **not** recalc (canonical
  positions unchanged).

## Design Decisions           <!-- rung: Specified → Contract-grade -->
| Decision | Rationale |
|---|---|
| Computed value in `row.data[field]`; formula in a sidecar map | Zero change to sort/filter/format/export/aggregate — they see results for free; only the edit-seed path consults the sidecar. |
| A1 addresses **canonical** row/col positions, not view positions | A formula must be stable under sort/filter (Excel semantics); the view is a projection. |
| AST interpreter, never `eval`/`new Function` | Honours `SEC-NO-EVAL` (static-scanned); untrusted cell text can never execute. |
| Recalc engine co-located with `IndexEngine` (`COMPONENT-DATA-WORKER`) | Canonical data + `rowByKey` live there; consistent with `ADR-WORKER-OPS`. |
| Incremental dirty-subgraph recalc | 300k chained formulas: a typical edit touches a small subgraph; full O(all) recalc only on load/structural change. |
| Export emits computed values | Reconciles `SEC-EXPORT-FORMULA-GUARD` — formula strings never leave via export; `.xlsx` live-formula write is `[FUTURE-SCOPE]`. |
| *(v1.5.1 opt)* **Numeric** cell-graph keys (`rowIndex·2^14 + colIndex`) | The per-reference `valueAt` hot path allocates no string id and does one numeric `Map` probe; numeric keys are smaller + faster than `"r c"` strings → recalc **−32%**, heap **−20%**. Identity is positional; a structural mutation still fully rebuilds (`INV-FORMULA-REBUILD`). |
| *(v1.5.1 opt)* Compile `COUNTIF`/`SUMIF`/`AVERAGEIF` criteria **once** | The criteria is loop-invariant; parsing it per range cell (regex + `Number`) was ~50× the arithmetic path. Compile-once + a numeric fast path → **8.6–10×** per call (32× on large ranges), byte-identical. |

## Contracts                  <!-- rung: Contract-grade -->

### `CAP-FORMULA` (Product) — capability
Opt-in (`formula` flag) Excel-like in-cell formulas: A1 references + ranges, **475
registry functions + 9 evaluator special forms** (built; from v1.5's ~70, via v1.6's 455), typed
errors, cycle-detecting incremental recalculation, reference values, a dynamic-array
spill engine, and locale-aware text formatting. Realizes `SUCCESS-FORMULA` (users
compute across cells without leaving the grid).

### `ENTITY-*` (Domain & Data)
- **`ENTITY-FORMULA-CELL`** — `cellId: number` *(positional identity `rowIndex·2^14 + colIndex`)*
  · `src: string` (raw `=…`) · `ast: FormulaNode` · `precedents: CellId[]` (resolved
  precedents) · `value: FormulaValue` (last computed result or `ENTITY-FORMULA-ERROR`).
- **`ENTITY-DEP-GRAPH`** — `formulas: Map<CellId, ENTITY-FORMULA-CELL>` ·
  `dependents: Map<CellId, Set<CellId>>` · derived `precedents` per formula.
- **`ENTITY-FORMULA-ERROR`** — one of the **nine** `#…!` codes (the seven v1.5 codes
  + `#SPILL!`/`#CALC!` from `CAP-FORMULA-ARRAY`; a tagged sentinel, never a bare
  string, so a *literal* text `"#REF!"` in data is not an error).

### `INV-*` (Domain & Data) — invariants
| ID | Checkable condition | Enforcement |
|---|---|---|
| `INV-FORMULA-DERIVED` | a formula cell's `row.data[field]` always holds its last **computed** value; its `src` lives only in the sidecar | **By-construction**: recalc writes results into `data[field]`; edit-seed reads `src` from the map. |
| `INV-FORMULA-ACYCLIC` | the evaluated graph is a DAG; any cycle yields `#CIRC!` on its members (no infinite loop) | **By-construction**: Kahn topo — unreached nodes are marked `#CIRC!`. |
| `INV-FORMULA-INCREMENTAL` | a single-cell recalc touches only the edited cell's transitive dependents | **By-construction**: BFS over `dependents`, topo-order the subset only. |
| `INV-FORMULA-REBUILD` | after a structural row/col mutation, every formula's references are **translated** (shifted / `#REF!`-ed) and the graph fully recomputed | **By-construction**: `IndexEngine.insertRows`/`removeRows` call `FormulaEngine.applyStructural` (`translateAst` + `formatAst` + re-resolve + `recalcAll`). |

### `LIB-*` (Interfaces & Contracts) — API surface
| Element | Signature | Contract |
|---|---|---|
| `LIB-FORMULA-ENTRY` | *(via `LIB-UPDATE-CELL` / interactive edit / paste)* a committed value starting with `=` is stored as a formula | parse failure → `EVT-VALIDATION-ERROR` + `FORMULA_PARSE_FAILED`, cell keeps its prior value. **Excel-like reject on both paths:** a typed/`LIB-UPDATE-CELL` commit rejects (editor stays open / promise rejects); a **paste** rejects the bad cell **per-cell** (drops just that cell + fires `EVT-VALIDATION-ERROR`, the rest of the block applies) — an invalid `=…` is **never** silently kept as literal text · `CAP-FORMULA` |
| `LIB-FORMULA-GET` | `getCellFormula(rowKey, columnId): string \| undefined` | returns the raw `=…` for a formula cell, else `undefined`; gated by `formula` |
| `LIB-FORMULA-RECALC` | `recalculate(): Promise<{ changed: number; cycles: number; elapsedMs: number }>` | forces a full recalc; resolves the summary; fires `EVT-AFTER-RECALC` |
| `LIB-FORMULA-EVAL` | `parseFormula(src): FormulaNode` + `evaluate(node, resolver): FormulaValue` | two-step, pure: parse `src` to an AST, then evaluate a node against a **caller-supplied `CellResolver`** (no store write); exported for tooling/tests |

- **Locale threading (built):** the active `COMPONENT-I18N` locale reaches the
  evaluator via `CellResolver.locale`, sourced from `EngineLoadOptions.locale` and
  carried on `MSG-LOAD`/`MSG-RECALC` (so `recalculate()` and `grid.setLocale()` push
  the current locale to the worker); `FIXED`/`DOLLAR`/`TEXT` format against it.
- **Spill query + change event (public — v1.6 delta):** `FormulaEngine.getSpillRanges()`
  (live anchors + extents) is surfaced publicly as **`LIB-FORMULA-SPILL`**
  (`grid.getSpillRanges(): { anchor:{row,col}; rows; cols }[]`, canonical positional).
  Each recalc pass **diffs** the previous vs current spill set and carries the per-anchor
  deltas on the `recalc-result` message; `COMPONENT-API` re-emits them as
  **`EVT-SPILL-CHANGE`** (`{ anchor:{row,col}; rows; cols; blocked }`, one per changed
  anchor) and sets **`EVT-AFTER-RECALC.spillChanged`**. Delta encodings: active
  (`rows≥1,cols≥1,blocked:false`) · blocked/`#SPILL!` (`blocked:true`, attempted extent)
  · cleared (`rows:0,cols:0,blocked:false`).

### `EVT-*` (Interfaces & Contracts) — events
| Event pair | Payload projection |
|---|---|
| `EVT-AFTER-RECALC` (notify) | `{ changed: number; cycles: number; elapsedMs: number; trigger: 'load'\|'edit'\|'structural'\|'manual' }` |
| `EVT-FORMULA-ERROR` (notify) | `{ cell: CellRef; code: FormulaErrorCode }` — a cell resolved to an error value this recalc *([FUTURE-SCOPE] — declared, not yet emitted; error/cycle counts surface via EVT-AFTER-RECALC's `cycles` and the in-cell `#…!` value)* |

### `ERR-*` (Interfaces & Contracts) — error catalog additions
| Code | Condition | Source | Surfaced | Forced-by (test) |
|---|---|---|---|---|
| `FORMULA_PARSE_FAILED` | committed `=…` is syntactically invalid | `validation` | `EVT-VALIDATION-ERROR` + reject commit | commit `"=1+"` |
| `FORMULA_DISABLED` | a formula-API called with the `formula` flag off | `config` | reserved — the APIs degrade gracefully (getCellFormula→undefined, recalculate→zeroed); not thrown | n/a |

*(In-cell evaluation errors are `ENTITY-FORMULA-ERROR` **values**, not thrown `ERR-*`
— they display in the cell like Excel.)*

### `PERF-*` (Performance & Scalability)
| ID | Metric | Threshold | Boundary | Load |
|---|---|---|---|---|
| `PERF-RECALC-FULL` | full recalc of ~300k chained formula cells | `[PROVISIONAL]` (demo-calibrated) | engine | `SEQ-RECALC-FULL` |
| `PERF-RECALC-INCR` | single-cell edit → dirty-subgraph recalc | `[PROVISIONAL]` — target ≤ 16ms for a small subgraph | engine | `SEQ-RECALC-INCR` |
| `PERF-RECALC-WORST` | full recalc of ~12k chained `FORECAST.ETS` cells (the slowest built-in after the v1.7 solver-opt pass) | **≈ 967 ms** (~80µs/cell over a 24-pt window; demo-calibrated) | engine | `SEQ-RECALC-WORST` |
| `PERF-FORMULA-NEUTRAL` | existing `PERF-*`/bench hot paths **unchanged** with formulas present-but-unused | **no regression** (byte-identical bench, ±noise) | all | all `SEQ-*` |

- **`SEQ-RECALC-FULL`** — load N rows where a wide+deep formula field chains
  (≥300k formula cells), measure first full recalc.
- **`SEQ-RECALC-INCR`** — edit one upstream cell, measure the incremental recalc of
  its dependents.
- **`SEQ-RECALC-WORST`** — load cells of the slowest built-in **chained** (each cell
  a `FORECAST.ETS` over a bounded window that references the cells above it in its
  column, plus a value-neutral `0*B{row}` editable dependency), measure full +
  head-of-chain recalc. Establishes the **worst-case envelope** vs the cheap-arithmetic
  `SEQ-RECALC-FULL`. Per a per-call micro-bench, `FORECAST.ETS` is **~40× the `COUNTIF`
  path** (~80µs/call over a 24-point window) because Holt-Winters runs a
  smoothing-parameter **grid-search** per call. *(`COUNTIF` was the v1.5/v1.6 worst
  case at ~2µs/call; the v1.7 catalog's iterative/optimization-heavy functions —
  after the naïve bond-yield bisection was itself replaced by Newton — moved the
  worst case here.)* The window is bounded so the dependency-graph edge count
  (cells × window) stays tractable; the demo drops to ~12k cells so a full recalc
  stays ~1s (a 300k `FORECAST.ETS` grid would take minutes).
- **Guard `PERF-FORMULA-NEUTRAL`**: the formula module is behind the flag and off
  the per-cell paint / sort / filter / paste paths; with `formula` unused, the
  Part-2 before/after benches (`engine`, `format`, `apply-batch`, scroll/paste
  e2e) show **no regression**. Proven by re-running the baseline bench set.

### `SEC-*` (Security & Privacy)
| ID | Assertion |
|---|---|
| `SEC-FORMULA-NO-EVAL` | formulas are evaluated by an **AST interpreter**; the formula code contains no `eval`/`new Function`/`Function(` — covered by the existing `SEC-NO-EVAL` static scan over the core bundle. |
| `SEC-EXPORT-FORMULA-GUARD` *(reconciled)* | export emits a formula cell's **computed value** (formula strings never cross the export seam); the existing guard still neutralizes any *literal* `= + - @`-leading text data. Unchanged control, clarified scope. |

## Acceptance criteria        <!-- rung: Contract-grade -->
- **AC-FORMULA-EVAL:** `=SUM(A1:A3)+B1*2` over known cells yields the arithmetic
  result; the nine error codes arise from their conditions; `IFERROR` traps them.
- **AC-FORMULA-CHAIN:** a chain `B2=A2+1, B3=B2+1, …` propagates: editing `A2`
  updates every downstream `B*` (incremental), asserted end-to-end.
- **AC-FORMULA-CYCLE:** `A1=B1, B1=A1` yields `#CIRC!` on both, no hang.
- **AC-FORMULA-DERIVED:** sorting/filtering by a formula column uses computed
  values; the cell editor shows the formula string; CSV export emits the result.
- **AC-FORMULA-INCREMENTAL:** an edit to a cell with K transitive dependents
  recomputes K cells (instrumented count), not all N.
- **AC-FORMULA-NEUTRAL:** the Part-2 baseline benches re-run with the formula module
  present show no regression on the existing hot paths.
- **AC-FORMULA-DEMO:** a demo mounts **≥ 300,000** interacting (chained) formula
  cells and reports full + incremental recalc timings.
- **AC-FORMULA-WORST:** a separate worst-case demo (`demo/formula-worst.html`) mounts
  a graph of chained **`FORECAST.ETS`** cells (the slowest built-in — the target is
  re-measured, not assumed) and reports its full + head-of-chain + leaf recalc timings,
  quantifying the worst-case envelope against the arithmetic `AC-FORMULA-DEMO`. The
  cell count is scaled (~12k) so a full recalc stays ~1s; the leaf edit demonstrates
  the incremental-recalc win survives even at ~80µs/cell (~967ms full → ~16ms leaf).

---

# v1.6 delta — full catalog & advanced capabilities (doc-feature)   <!-- rung: Contract-grade -->

> Adds the full Excel-comparable function catalog + three advanced capabilities on
> top of the built v1.5 engine. **BUILT** (this delta is implemented — see
> `IMPLEMENTATION.md` slices 42–45 + the locale / structural-rewrite follow-ups).
> All contracts are **additive** (new capabilities/functions/entities/invariants/
> events; two additive extensions to `ENTITY-FORMULA-CELL` + `ENTITY-FORMULA-ERROR`)
> — no v1.5 contract changes type or semantics.

## v1.6 · `CAP-FORMULA-FN` (extended) — the full pure catalog

- **Capability** (Product): extend the function library from the v1.5 ~70 to the
  **full pure scalar/range catalog (built — 455 registry functions)** — every Excel
  function that is a pure computation over scalar/range inputs and needs **no new
  engine capability**:
  the complete math/trig, **statistical**, **financial**, date/time, text,
  information, **engineering**, and **database** categories, plus the **`*IFS`
  family** (`SUMIFS`/`COUNTIFS`/`AVERAGEIFS`/`MAXIFS`/`MINIFS`). Realizes
  `SUCCESS-FORMULA-CATALOG` (users find the function they expect).
- **Named catalog:** the exhaustive list — every function, its category, arity, and
  tag (built `✅` / v1.6-pure / needs-`VOLATILE`/`REF`/`ARRAY`) — is
  [`docs/formula-functions.md`](formula-functions.md), the single source for the
  catalog. **Classification: additive.**
- **`*IFS` semantics:** generalize the v1.5 compiled-criteria path to **N**
  `(range, criteria)` pairs, AND-combined per row; all ranges must share the same
  shape (`#VALUE!` otherwise). Reuses `compileCriteria` per criterion.
- **Locale (built):** `TEXT`, `DOLLAR`, `FIXED` format via `Intl.NumberFormat(locale)`
  for the active `COMPONENT-I18N` locale (grouping/decimal separators; `DOLLAR` uses
  the locale's currency with accounting-sign negatives), not a fixed `en-US`. The
  locale is threaded to the evaluator via `CellResolver.locale` — sourced from
  `EngineLoadOptions.locale` / `MSG-LOAD` / `MSG-RECALC`, and `grid.setLocale()`
  re-recalcs formula cells so they reflow.
- **No engine change:** each function is `(args) => value` over the existing
  scalar/`RangeValue` arguments; added to the `FUNCTIONS` registry like the v1.5 set.
- **`AC-FORMULA-CATALOG`:** every "pure"-tagged function in the catalog has a unit
  test asserting a known input→output; the `*IFS` family matches Excel multi-criteria
  results.

## v1.6 · `CAP-FORMULA-VOLATILE` — volatile recalculation

- **Capability** (Product): functions whose value can change **without any precedent
  changing** recompute on **every** recalc. The volatile set: `NOW TODAY RAND
  RANDBETWEEN RANDARRAY OFFSET INDIRECT INFO CELL`. Realizes `SUCCESS-FORMULA-VOLATILE`.
- **`ENTITY-FORMULA-CELL` (extended, additive):** gains `volatile: boolean`, derived
  at parse time from whether the AST contains any volatile function.
- **`ENTITY-DEP-GRAPH` (extended):** a `volatileCells: Set<CellId>` index.
- **`INV-FORMULA-VOLATILE`** (checkable): **every** recalc pass (full or incremental)
  includes all `volatileCells` **and their transitive dependents** in the dirty set —
  so editing *any* cell re-rolls every `RAND` and re-evaluates every `NOW` (Excel
  semantics). Enforcement: **by-construction** — the incremental dirty closure is
  seeded with `edited ∪ volatileCells`.
- **PRNG:** `RAND`/`RANDBETWEEN` use `Math.random` (product code — allowed; **not**
  `eval`, `SEC-NO-EVAL` unaffected); unseeded (inherently non-deterministic).
- **`PERF-RECALC-VOLATILE`:** a recalc with `V` volatile cells is `O(V + affected)`
  — the always-dirty floor is bounded by the volatile count. `[PROVISIONAL]`.
- **`AC-FORMULA-VOLATILE`:** editing an unrelated cell re-rolls every `RAND` and
  re-evaluates `NOW`/`TODAY`; a non-volatile, non-dependent cell is untouched.

## v1.6 · `CAP-FORMULA-REFVAL` — reference values

<!-- NB: distinct from the v1.5 `CAP-FORMULA-REF` (the A1 *addressing model*); this
     capability adds a reference *value type* to the evaluator. -->
- **Capability** (Product): a **reference** value type in the evaluator (distinct
  from a materialized array) enabling functions that *return* or *transform*
  references: `OFFSET INDIRECT INDEX`(reference form)` ADDRESS` (+ `ROW`/`COLUMN`/
  `ROWS`/`COLUMNS` accept references). Realizes `SUCCESS-FORMULA-REFVAL`.
- **`ENTITY-CELL-REFERENCE`** *(built as `ReferenceValue` in `eval-types.ts`)*:
  `{ kind: 'reference'; top: number; left: number; rows: number; cols: number }` — a
  rectangular region in **canonical** (0-based) coordinates. A reference used where a
  **scalar** is expected dereferences to its top-left (1×1) or `#VALUE!` (multi-cell in
  scalar context); used by a **range consumer** (`SUM`, `COUNT`, …) dereferences to the
  region's values. `REF_AWARE_FUNCTIONS` receive the raw reference; everything else gets
  the dereferenced value/range.
- **Functions:** `OFFSET(ref, dRows, dCols, [height], [width]) → Reference`;
  `INDIRECT(a1Text, [a1]) → Reference` (parses the A1 text **at eval time**);
  `INDEX(range, rowNum, [colNum])` **reference form** → `Reference`;
  `ADDRESS(row, col, [absNum], [a1], [sheetText]) → A1 text` (pure text — needs no
  Reference type, so `ADDRESS` can ship with the pure catalog).
- **`INV-REF-INGRID`:** a reference resolving wholly/partly outside the grid → `#REF!`.
- **Dynamic precedents ⇒ volatile:** `OFFSET`/`INDIRECT` targets depend on runtime
  values, so precedents are **not** statically resolvable. **`INV-REF-DYNAMIC-DEP`:**
  any formula containing `OFFSET`/`INDIRECT` is **volatile** (`CAP-FORMULA-VOLATILE`)
  and re-resolves its region each evaluation — the graph adds a conservative
  dependency rather than a static edge. *(This binds `CAP-FORMULA-REFVAL` to
  `CAP-FORMULA-VOLATILE`.)*
- **`AC-FORMULA-REFVAL`:** `SUM(OFFSET(A1,0,0,3,1)) = SUM(A1:A3)`;
  `INDIRECT("A"&2) = A2`; an `OFFSET`/`INDIRECT` formula is flagged volatile.

## v1.6 · `CAP-FORMULA-ARRAY` — the spill engine (Excel-style dynamic arrays)

- **Capability** (Product): a formula may compute to a **rectangular array** that
  **spills** into the anchor + the cells below/right. Realizes
  `SUCCESS-FORMULA-ARRAY` (one formula, many results — `FILTER`/`SORT`/`UNIQUE`/…).
  **The largest v1.6 capability**; committed to **Excel-style spill** (operator
  choice). Functions: `FILTER SORT SORTBY UNIQUE SEQUENCE RANDARRAY XLOOKUP`
  (multi-return)` XMATCH TRANSPOSE TAKE DROP EXPAND HSTACK VSTACK TOROW TOCOL
  WRAPROWS WRAPCOLS CHOOSEROWS CHOOSECOLS TEXTSPLIT GROUPBY PIVOTBY FREQUENCY MMULT
  MINVERSE MDETERM MUNIT` + the lambda/iteration family `LAMBDA LET MAP REDUCE SCAN
  BYROW BYCOL MAKEARRAY ISOMITTED` + array-result stats `LINEST LOGEST TREND GROWTH
  MODE.MULT`.

**Design (Contract-grade):**
- **Anchor + spill range.** The formula lives in an **anchor** cell; its array
  (`rows × cols`) spills across the anchor + the cells below/right (the **spill
  range**). Model mirrors `CAP-MERGE` (anchor owns a rectangle of covered cells).
- **`ENTITY-SPILL-RANGE`:** `anchor: CellId` · `rows: number` · `cols: number` ·
  `values: FormulaValue[]` (row-major) — the materialized array.
- **Projections, not cells (`INV-SPILL-PROJECTION`):** a non-anchor spill cell
  **displays** the array element but is **not** an independent stored cell; **editing
  it is blocked / redirected to the anchor** (only the anchor holds a formula).
- **Collision → `#SPILL!` (`INV-SPILL-EMPTY`, `INV-SPILL-NONOVERLAP`):** if any target
  cell in the spill range is non-empty at spill time (literal data, another formula,
  or part of another spill/merge), the anchor shows `#SPILL!` and spills nothing.
- **`INV-SPILL-ANCHOR-OWNS`:** clearing/rewriting the anchor clears the whole spill
  range; the anchor is the single editable cell.
- **Resize + the `#` operator:** on recompute the array may resize (e.g. `FILTER`
  returns fewer rows) → the spill range grows/shrinks, vacated cells are released,
  collisions re-checked. The **spill-reference** `A1#` references the anchor's
  **current** spill range. Cells referencing any spill cell are dependents of the
  **anchor**.
- **In-formula arrays vs spill:** array functions also compose **inside** other
  functions without spilling — `SUM(FILTER(A1:A9,B1:B9>0))` — an array is a
  first-class evaluator value; **spill** happens only when an array is the anchor
  cell's **top-level** result.
- **`LET`/`LAMBDA`:** `LET(name, value, …, calc)` binds local names (an evaluator
  scoping pass — **no spill needed**, may ship ahead of the spill engine).
  `LAMBDA(params, calc)` is a first-class function value; `MAP`/`REDUCE`/`SCAN`/
  `BYROW`/`BYCOL`/`MAKEARRAY` apply a `LAMBDA` over arrays.
- **Derived-value pipeline (extends `INV-FORMULA-DERIVED`):** a spill cell's projected
  value is written into its `row.data[field]` (so sort/filter/format/export observe
  spilled values), marked spill-owned. **Decision:** a spill projection **bypasses the
  target column's `validation`** (it is a computed projection, not a user edit) and is
  display-formatted by the column's mask; a hard type conflict is tolerated (Excel
  spills freely across columns).
- **Sort/filter interaction (full support — v1.6 delta):** spill ranges are
  **canonical**-coordinate (like all refs). Under an active sort/filter the view
  reorders/hides rows, so a canonical-contiguous spill may render **non-contiguously**.
  **Built:** project values per-cell wherever the canonical cell is visible (values
  always correct); draw the spill **outline per visually-contiguous run** (each visible
  run of the range gets its own `data-mg-spill` halo). Spill display is **not** suppressed
  under a non-natural view — the per-run outline keeps it legible.
- **Rendering (`COMPONENT-RENDER`) — v1.6 delta, partially realized:** spill cells render their
  projected value (they write through `writeDisplay` into `row.data`, shown via
  `INV-CELL-DERIVED`) — **built**. The spill-range **outline halo** (`data-mg-spill`, per
  visually-contiguous run, sourced from `LIB-FORMULA-SPILL`) and the spilled-cell
  **edit-guard** (`INV-SPILL-PROJECTION`: block a typed edit / F2 / paste on a non-anchor
  spill cell and **move selection to the anchor**) are **specced, build pending**
  (`IMPLEMENTATION.md` 45d). A paste overlapping a spill
  drops the overlapping cells **per-cell** (like `LIB-FORMULA-ENTRY`).
- **Events (v1.6 delta — specced, emission pending):** each recalc pass **diffs** the previous vs current
  spill set; the per-anchor deltas cross the seam on the `recalc-result` message and
  `COMPONENT-API` re-emits **`EVT-SPILL-CHANGE`** `{ anchor:{row,col}; rows; cols; blocked }`
  (one per changed anchor, canonical positional) and sets **`EVT-AFTER-RECALC.spillChanged`**.
  The current ranges are queryable via **`LIB-FORMULA-SPILL`** (`grid.getSpillRanges()`).
  *Status:* the engine substrate (`RecalcSummary.spillChanged` + `FormulaEngine.getSpillRanges()`)
  is **built**; the per-anchor diff, the recalc-result carry, and the public
  emission/query are **build pending** (`IMPLEMENTATION.md` 45e, `bindings.yaml`).
- **Architecture:** extends `COMPONENT-DATA-WORKER` (array eval + spill
  materialization) + `COMPONENT-RENDER` (outline) via a new **`PATTERN-SPILL`**
  (anchor-owns-range projection, mirroring `CAP-MERGE`).
- **`PERF-RECALC-ARRAY`:** an array recompute is `O(array size)` + a spill-collision
  check `O(spill cells)`; a resize re-projects only the delta. `[PROVISIONAL]`.
- **Acceptance:**
  - **`AC-FORMULA-ARRAY-SPILL`:** `=SEQUENCE(3)` in empty `A1` spills `A1:A3` = `1;2;3`;
    a value in `A2` → `A1` shows `#SPILL!`; clearing `A2` re-spills; editing a spill
    cell (`A2`) is blocked/redirects to `A1`.
  - **`AC-FORMULA-ARRAY-RESIZE`:** `=FILTER(A1:A9,B1:B9>0)` grows/shrinks its spill as
    `B` changes; `A1#` references the current spill range.
  - **`AC-FORMULA-ARRAY-DERIVED`:** spilled values sort/filter/export as their
    projected values (extends `INV-FORMULA-DERIVED`).
  - **`AC-SPILL-EVENT`:** create/resize/remove/blocked spills emit `EVT-SPILL-CHANGE`
    per changed anchor with the correct positional payload; `EVT-AFTER-RECALC.spillChanged`
    tracks it; `getSpillRanges()` returns the live ranges.
  - **`AC-SPILL-OUTLINE`:** the `data-mg-spill` outline renders over a spill; a sort/filter
    that fragments the range draws one halo **per visually-contiguous run**, values correct.
  - **`AC-SPILL-GUARD`:** typing / pasting over a non-anchor spilled cell is blocked and
    selection moves to the anchor.

## v1.6 · consuming-concern references (ID web)
- **Product & Requirements:** `CAP-FORMULA-FN`(extended), `CAP-FORMULA-VOLATILE`,
  `CAP-FORMULA-REFVAL`, `CAP-FORMULA-ARRAY` + `SUCCESS-FORMULA-CATALOG`/`-VOLATILE`/
  `-REFVAL`/`-ARRAY`.
- **Domain & Data:** `ENTITY-SPILL-RANGE`, `ENTITY-CELL-REFERENCE`; `ENTITY-FORMULA-CELL`
  `volatile` field; `ENTITY-FORMULA-ERROR` `#SPILL!`/`#CALC!`; `INV-FORMULA-VOLATILE`,
  `INV-REF-INGRID`, `INV-REF-DYNAMIC-DEP`, `INV-SPILL-EMPTY`, `INV-SPILL-PROJECTION`,
  `INV-SPILL-NONOVERLAP`, `INV-SPILL-ANCHOR-OWNS`.
- **Interfaces & Contracts:** `EVT-SPILL-CHANGE` (positional per-anchor; public emission pending),
  `EVT-AFTER-RECALC.spillChanged` (additive; carry pending), **`LIB-FORMULA-SPILL`** (`getSpillRanges()`; public surface pending);
  the extended `LIB-FORMULA-*` surface (the `#`-spill ref, `A1#`); no new public `ERR-*`.
- **User Experience:** `LAYER-SPILL-OUTLINE` (the per-run `data-mg-spill` halo) + the
  spilled-cell edit-guard affordance on `SCREEN-GRID`.
- **Architecture:** `PATTERN-SPILL`; extends `COMPONENT-DATA-WORKER` (spill-set diff on
  `recalc-result`) + `COMPONENT-RENDER` (per-run outline) + `COMPONENT-EDIT` (edit-guard).
- **Performance:** `PERF-RECALC-VOLATILE`, `PERF-RECALC-ARRAY`.
- **Quality & Testing:** `AC-FORMULA-CATALOG`/`-VOLATILE`/`-REFVAL`/`-ARRAY-SPILL`/
  `-ARRAY-RESIZE`/`-ARRAY-DERIVED` + `AC-SPILL-EVENT`/`-OUTLINE`/`-GUARD`; unit for the
  catalog, component + E2E for spill (event, outline, edit-guard).

---

# v1.7 delta — catalog completion (doc-feature)   <!-- rung: Contract-grade -->

> Closes the documented `◻` catalog gaps: promotes the ~20 deferred functions +
> the implicit-intersection `@` operator from `◻`-deferred to **contract-grade** spec.
> Authored docs-first; **now BUILT** (see `IMPLEMENTATION.md` "v1.7 delta" — asserted
> by the `AC-CATALOG-V17` bucket A–D + `AC-FORMULA-INTERSECT` unit blocks in
> `formula/formula.test.ts`; `PERF-RECALC-WORST` re-baselined ≈967ms after the v1.7
> solver-opt pass, `perf/OPTIMIZATION.md`). All **additive** (new registry
> functions + one new operator capability; no v1.5/v1.6 contract changes type or
> semantics). The array-result functions reuse the built `CAP-FORMULA-ARRAY` spill
> machinery (they return a `RangeValue`; **no new engine capability** beyond `@`).
> Registry count (built): **475** (455 → +20 fns; `@` is an operator,
> not a registry entry). The named catalog (`docs/formula-functions.md`) is the tag
> source; this section is the semantics + acceptance contract.

## v1.7 · `CAP-FORMULA-FN` (completion) — the deferred functions

**Classification: additive.** Each function below is a pure `(args) => value|RangeValue`
registry entry (like the v1.6 catalog), tested by `AC-CATALOG-V17`. Grouped by bucket.

### Bucket A — quick wins *(scalar/array, existing machinery)*
| Function | Arity | Returns | Semantics / algorithm |
|---|---|---|---|
| `MODE.MULT` | `(number, …)` | **array** (spills) | all modes tied for most-frequent (vs `MODE.SNGL`'s first); `#N/A` if none repeats |
| `PROB` | `(x_range, prob_range, lower, [upper])` | number | Σ `prob` where `lower ≤ x ≤ upper`; `#NUM!` if Σprob≠1 or any p∉(0,1]; ranges must match shape |
| `AREAS` | `(reference)` | number | count of contiguous rectangles in a reference (`REF_AWARE`); a single range → `1` |
| `XLOOKUP` (array return) | `(lookup, lookup_arr, return_arr, …)` | **array** (spills) | when `return_arr` is multi-column, return the **whole matched row/block** (extends the built single-result `XLOOKUP`) |
| `ARRAYTOTEXT` | `(array, [format])` | text | `format 0` (default) concise, `format 1` Excel array-literal `{a,b;c,d}` |

### Bucket B — array math *(regression + matrix; return `RangeValue`, spill)*
| Function | Arity | Returns | Semantics / algorithm |
|---|---|---|---|
| `TREND` | `(known_y, [known_x], [new_x], [const])` | **array** | linear least-squares `y = Xb`; predict at `new_x` (defaults to `known_x`) |
| `GROWTH` | `(known_y, [known_x], [new_x], [const])` | **array** | exponential `y = b·m^x` — `TREND` on `ln(y)`, exponentiate |
| `LINEST` | `(known_y, [known_x], [const], [stats])` | **array** | regression coefficients (+ optional stats block: se, R², F, df, ss) |
| `LOGEST` | `(known_y, [known_x], [const], [stats])` | **array** | exponential-model coefficients (`LINEST` on `ln(y)`) |
| `MINVERSE` | `(square_array)` | **array** | matrix inverse via Gauss–Jordan; singular → `#NUM!` |
| `MDETERM` | `(square_array)` | number | determinant (LU); non-square → `#VALUE!` |
| `MUNIT` | `(n)` | **array** | `n×n` identity |

*(Shares a small linear-algebra core — Gaussian elimination with partial pivoting —
with the existing `MMULT`. `LINEST`/`LOGEST` stats use the normal-equations residuals.)*

### Bucket C — odd-period bonds *(needs quasi-coupon-period machinery)*
| Function | Arity (abbrev.) | Returns | Semantics |
|---|---|---|---|
| `ACCRINT` | `(iss, first_int, sett, rate, par, freq, [basis], [calc])` | number | accrued interest, periodic (vs the built maturity-only `ACCRINTM`) |
| `PRICEMAT` / `YIELDMAT` | `(sett, mat, iss, rate, {yld\|pr}, [basis])` | number | price/yield, interest-at-maturity |
| `ODDFPRICE` / `ODDFYIELD` | `(sett, mat, iss, first_coupon, …)` | number | odd **first** coupon period |
| `ODDLPRICE` / `ODDLYIELD` | `(sett, mat, last_int, …)` | number | odd **last** coupon period |

*(New shared substrate: a **quasi-coupon-period** schedule generator on top of the
built `dayCountFrac`/`couponSchedule`; `YIELD*` variants bisect the monotone price.)*

### Bucket D — big / structural
- **`GROUPBY` / `PIVOTBY`** *(array; new aggregation mini-DSL)* —
  `GROUPBY(row_fields, values, function, …)` groups rows by key column(s), applies an
  aggregation (`SUM`/`COUNT`/`AVERAGE`/`MAX`/`MIN`/`PERCENTOF`/a `LAMBDA`), and **spills**
  a labelled result; `PIVOTBY` adds a **column-field** axis (cross-tab). Returns a
  `RangeValue`; reuses the built aggregation reducers + `LAMBDA` (`CAP-FORMULA-ARRAY`).
  `#CALC!` on an empty group set or an unrecognized aggregation.
- **`INFO`** — **dropped from scope: wholly `ABSENT`.** Every Excel `INFO(type)` needs
  host/OS/workbook context mini-grid does not have; there is no in-scope carve-out. (Its
  dormant entry in `VOLATILE_FUNCTIONS` is a harmless no-op — `INFO` is unregistered.)

## v1.7 · `CAP-FORMULA-INTERSECT` — implicit-intersection `@` operator (new capability)

- **Capability** (Product): a **prefix `@` operator** (implicit intersection) that coerces
  an array/range/reference to a **single value** by intersecting it with the formula
  cell's own row/column; a 1×1 stays itself; a vector picks the element on the anchor's
  row (or column); no intersection → `#VALUE!`. Realizes `SUCCESS-FORMULA-INTERSECT`
  (Excel `@` parity — authored `=@A1:A10` picks the current row's cell). **The only v1.7
  item needing an engine change** (tokenizer + parser + AST + evaluator), not a registry fn.
- **`INV-INTERSECT-SCALAR`** (checkable): `@x` always yields a scalar (or `#VALUE!`), never
  an array — so an `@`-prefixed sub-expression never spills.
- **Architecture:** extends `COMPONENT-DATA-WORKER`'s formula parser/evaluator; `@` is a
  prefix that **applies to the range/reference that follows** (`@A1:A10` intersects the whole
  range — it binds looser than range `:`). No render/protocol change.
- **`AC-FORMULA-INTERSECT`:** `=@A1:A3` in row 2 = `A2`; `@` on a 1×1 is identity; `@` on a
  non-intersecting array → `#VALUE!`; an `@`-prefixed result never spills.

## v1.7 · acceptance & consuming-concern references (ID web)
- **`AC-CATALOG-V17`** (Quality): every function in buckets A–D has a **unit** test
  asserting a known input→output (array-return fns assert their spilled shape + values;
  `GROUPBY`/`PIVOTBY` match Excel group results; `YIELD*`/`ODDL*` round-trip against
  `PRICE*`/`ODDF*`); `AC-FORMULA-INTERSECT` covers the `@` operator.
- **Product & Requirements:** `CAP-FORMULA-FN`(completed) + `CAP-FORMULA-INTERSECT` +
  `SUCCESS-FORMULA-INTERSECT`; the catalog is now honestly closed (only the enumerated
  `✗`-ABSENT set remains).
- **Interfaces & Contracts:** no new public `LIB-*`/`ERR-*`/`EVT-*` — the bucket functions
  are registry entries; `@` is an in-`=…`-source operator (parsed by `LIB-FORMULA-EVAL`).
- **Architecture:** `CAP-FORMULA-INTERSECT` parser/evaluator extension; the aggregation
  mini-DSL for `GROUPBY`/`PIVOTBY` co-located in `COMPONENT-DATA-WORKER`.
- **Quality & Testing:** `AC-CATALOG-V17`, `AC-FORMULA-INTERSECT`; unit for every function
  + the `@` operator.

---
<!-- Status markers: [GAP] [ASSUMPTION] [REVISIT] [FUTURE-SCOPE] -->

