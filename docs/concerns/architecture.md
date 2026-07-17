---
artifact: product-doc
role: concern
concern-id: architecture
behavior: core
trigger: always
in-scope-subaspects: [component-decomposition-responsibilities, boundaries-isolation-model, component-interactions-data-flow, cross-cutting-patterns, technology-choices, adr-register, scalability-resilience-patterns]
current-rung: contract-grade
status: published
version: 1.1.0
---

# Architecture — mini-grid

> One-line: a framework-agnostic TypeScript core split across a **main thread** (render/interaction/styling/editing) and a **web worker** (canonical data + sort/filter/CRUD/aggregate), joined by a typed async `MSG-*` seam — plus optional per-framework adapters. Variable-height virtualization; ESM + standalone UMD.

## Purpose & Scope

Owns the logical component model (`COMPONENT-*`) with per-component **owned interfaces + dependencies**, the cross-cutting patterns (`PATTERN-*`) specified concretely enough to implement uniformly, the decision record (`ADR-*`), and the boundary contracts. Physical deployment is N/A (client library).

## Non-goals / Out-of-scope
- `logical-deployment-topology` — *(absent)* client-side library; thread placement (in scope) is decomposition, not topology.

## Requirements

### Component model (`COMPONENT-*`) — responsibility · owned interfaces · dependencies
Thread: **M** main / **W** worker. "Owns" = the `LIB-*`/`EVT-*`/`MSG-*` it realizes.

| Component | Thr | Responsibility · owned interfaces | Depends on |
|---|---|---|---|
| `COMPONENT-API` | M | Public `Grid` facade + feature-flag registry + event emitter. Owns `LIB-CREATE`/`-DESTROY`/`-UPDATE-OPTIONS`/`-OPTIONS`/`-COLUMN-DEF`, emits all `EVT-*`. | STORE, HISTORY, all main components |
| `COMPONENT-DATA-WORKER` | W | Canonical row store + ordered/filtered index + sort/filter/search/CRUD/aggregate. Owns the worker side of `LIB-SET-DATA`/`-GET-ROWS`/`-GET-COUNT`/`-UPDATE-CELL`/`-INSERT-ROWS`/`-REMOVE-ROWS`/`-COLUMN-CRUD`/`-GET-CHANGES`/`-SORT`/`-FILTER`; owns **all `MSG-*` handlers**. *(v1.5)* **co-locates the formula recalc engine** (`CAP-FORMULA`, `LIB-FORMULA-*`, `PATTERN-DEP-GRAPH`): the dependency graph + AST evaluator live next to the canonical row store + `rowByKey` (consistent with `ADR-WORKER-OPS`/`ADR-CONDFMT-AGG`), gated by the `formula` flag (`PATTERN-FEATURE-FLAGS`), AST-interpreted — never `eval` (`SEC-NO-EVAL`/`SEC-FORMULA-NO-EVAL`); recalc writes computed values into `row.data[field]` and fires `EVT-AFTER-RECALC` (`EVT-FORMULA-ERROR` is `[FUTURE-SCOPE]` — declared, not yet emitted). *(v1.6, additive)* the evaluator/engine gains **volatile recalc** (`CAP-FORMULA-VOLATILE` — a `volatileCells` index, dirty set seeded `edited ∪ volatileCells`) and **reference values** (`CAP-FORMULA-REFVAL` — a `Reference` value type for `OFFSET`/`INDIRECT`/`INDEX`(ref)/`ADDRESS`), both pure engine extensions; plus **array eval + spill materialization** (`CAP-FORMULA-ARRAY` — `ENTITY-SPILL-RANGE`, the `#SPILL!` collision check) via `PATTERN-SPILL`, diffing the spill set each recalc and carrying the per-anchor deltas + current ranges on the `recalc-result` message (surfaced as `EVT-SPILL-CHANGE` / `LIB-FORMULA-SPILL`). | — (leaf; only the `MSG-*` seam) |
| `COMPONENT-STORE` | M | Structural entities (`ENTITY-COLUMN` incl. *(v1.3)* `hidden`/`pinned` + the visible-column projection · `-SELECTION` as the *(v1.3)* multi-range set · `-CELL-STYLE`/`-MERGE-REGION`/`-FREEZE-PANE`/`-GROUP-NODE`/`-CONDITIONAL-RULE`) + reactive store. Owns `LIB-SELECTION`/`-COLUMN-MANAGE`/`-SET-STYLE`/`-COND-FMT`/`-MERGE`/`-FREEZE`/`-GROUP`/`-RESIZE`/`-REORDER`; emits `EVT-SELECTION-CHANGE`/`-STATE-CHANGE`/`-COLUMN-HIDDEN`/`-PINNED`/`-AUTOFIT` + structural before/after events. | HISTORY |
| `COMPONENT-VIEWPORT` | M | Variable-height virtualization windowing. Owns `LIB-SCROLL`, emits `EVT-SCROLL`/`-VIEWPORT-CHANGE`; issues `MSG-QUERY-WINDOW`. | DATA-WORKER, RENDER |
| `COMPONENT-RENDER` | M | DOM render + node recycling; owns `DOM-ROOT`/`-CELL`/`-HEADER`, `LIB-THEME`. *(v1.3)* renders the **multi-band header region** (N column-header bands + M row-header gutter bands with `data-band`/`aria-colspan`/`-rowspan` spans), the **corner** (`DOM-CORNER`), and the frozen gutter + **leading-pinned columns** (reusing the freeze-prefix layout). *(v1.6)* renders the **spill outline** for a dynamic-array anchor (a `data-mg-spill` marker across the spill range from `LIB-FORMULA-SPILL`, mirroring the merge outline — `CAP-FORMULA-ARRAY`/`PATTERN-SPILL`) — drawn **per visually-contiguous run** so a spill fragmented by an active sort/filter outlines each visible run separately. | FORMAT, CONDFMT, STORE, VIEWPORT |
| `COMPONENT-INTERACTION` | M | Pointer/keyboard/touch + ARIA. Owns `BIND-KEYS`/`BIND-POINTER`, `DOM-EDITOR` focus. *(v1.3)* handles **header click → row/column line-select** + corner select-all + Ctrl+click disjoint range, **band-resize / autofit** (double-click handle; autofit runs a **bounded measure pass over visible/sampled cells only** — no full-column scan), and the **builder-driven context menus** *(v1.4)* — both the cell `LAYER-CONTEXT-MENU` and the dedicated header `DOM-HEADER-MENU`/`LAYER-HEADER-MENU` — rendering a `MenuBuilder`'s `MenuItem[]` (resolving `builtinItems`/`command` ids + dropping flag-off built-ins), owning `LIB-MENU` (`openMenu`/`closeMenu`) and emitting `EVT-MENU-OPEN` (`CAP-MENU`). | STORE, EDIT, RENDER |
| `COMPONENT-EDIT` | M | Editor lifecycle + validation. Owns `LIB-EDIT-CONTROL`, `EVT-EDIT-*`/`-VALIDATION-ERROR`; issues `MSG-APPLY-EDIT`. | DATA-WORKER, STORE |
| `COMPONENT-FORMAT` | M | Style cascade + value-format masks. | I18N, STORE |
| `COMPONENT-CONDFMT` | M | Conditional-rule evaluation; requests full-dataset aggregates via `MSG-AGGREGATE`. | DATA-WORKER, STORE |
| `COMPONENT-CLIPBOARD` | M | Owns `LIB-CLIPBOARD`; large paste via `MSG-PASTE-APPLY`. | DATA-WORKER, STORE |
| `COMPONENT-EXPORT` | M | Owns `LIB-EXPORT`; reads via worker; uses `DEP-XLSX`. | DATA-WORKER |
| `COMPONENT-STATE-SERDE` | M | Owns `LIB-STATE`. | STORE |
| `COMPONENT-I18N` | M | Owns `LIB-LOCALE`, `Intl` formatters, string bundles, RTL. | — |
| `COMPONENT-HISTORY` | M | Owns `LIB-UNDO`/`-REDO` + the command stack; reverts dispatch to worker (data) or store (structural). | DATA-WORKER, STORE |
| `COMPONENT-ADAPTER-*` | M | `@mini-grid/{react,vue,svelte}` bind framework reactivity/lifecycle to API/STORE. | API, STORE |

The dependency graph is **acyclic** (`DATA-WORKER` is a leaf; UI components depend downward toward STORE/WORKER).

### Boundaries & isolation model (boundary contracts)
- **Thread boundary:** main ↔ worker communicate **only** via the typed `MSG-*` protocol (Interfaces). No shared mutable state; data crosses as structured-clone payloads. *(Fitness check: no main module imports worker internals except the protocol client.)*
- **Package boundary:** `@mini-grid/core` (framework-agnostic, zero required runtime deps) vs `@mini-grid/{react,vue,svelte}` (peer-dep their framework). Adapters import core's public API only.
- **Trust boundary:** cell content + paste + files are untrusted (`SEC-TRUST-BOUNDARY`); `PATTERN-ESCAPE-DEFAULT`.

### Cross-cutting patterns (`PATTERN-*`) — concrete
| ID | Concrete mechanism |
|---|---|
| `PATTERN-WORKER-PROTOCOL` | The `MSG-*` schemas (Interfaces) are the wire contract. **Rules:** every message carries `reqId`; the worker index has a monotonic `version`; **viewport queries are debounced/coalesced** (latest window wins; superseded `MSG-WINDOW` replies dropped by `version`); **mutations serialize FIFO** in the worker; a mutation bumps `version` and replies `MSG-INDEX-SUMMARY`. *(v1.1)* only **serializable** payloads cross the seam — `MSG-SORT`/`MSG-FILTER` carry `BuiltinFilter`/declarative `SortSpec` descriptors, never functions (`ADR-SORT-FILTER-SEAM`). |
| `PATTERN-VIRTUALIZATION` | **Variable-height** windowing: a per-row **height cache** (estimated from a default until measured on first render, then exact) with a **prefix-sum / binary-search** index↔offset lookup; render only `[firstVisible-overscan, lastVisible+overscan]` rows × visible cols; **recycle** DOM nodes from a pool keyed by position. Live node count bounded by viewport+overscan (realizes `PERF-NODES`). |
| `PATTERN-REACTIVE-STORE` | An observable store emits **microtask-coalesced batched** change events; `subscribe(fn)` returns an unsubscribe. Imperative `LIB-*` mutate via commands; the reactive/adapter path subscribes — both converge on one render-diff pass. |
| `PATTERN-STYLE-CASCADE` | Resolved style = **column default → cell overlay → conditional rule** (per property; conditional wins), computed lazily per visible cell and memoized; conditional aggregates (color-scale min/max, data-bar range, top-N) come from the worker (`MSG-AGGREGATE`, full-dataset) and recompute on data change. |
| `PATTERN-FEATURE-FLAGS` | Each feature is a module registered in a registry keyed by flag; disabled → not registered → **no affordance and (tree-shaken) no bundle cost**. |
| `PATTERN-ERROR` | **Total + never console-only.** Config/programmer → `throw GridError`; validation → `EVT-VALIDATION-ERROR` + inline UI; async/worker/export → `Promise` reject + `EVT-ERROR`. Every path yields a catalog `ERR-*` code (Interfaces). |
| `PATTERN-ESCAPE-DEFAULT` | Cell content via `textContent`; custom renderers return DOM/components only — no HTML-string sink (`SEC-RENDERER-DOM-ONLY`). |
| `PATTERN-DEP-GRAPH` *(v1.5)* | Formula recalculation as a **directed dependency graph** keyed by a **numeric positional cell id** (`rowIndex·2^14 + colIndex`, v1.5.1 opt): `precedents`/`dependents` edges, **Kahn topological order** for a full recalc (a node never reaching in-degree 0 is in a cycle → `#CIRC!`, `INV-FORMULA-ACYCLIC`), and a **BFS dirty-subgraph** incremental recalc on a single-cell commit (`INV-FORMULA-INCREMENTAL`) — **O(affected), not O(all)**. Co-located in `COMPONENT-DATA-WORKER`; structural row/col edits **translate** A1 refs (`translateAst`/`formatAst`) + full recalc (`INV-FORMULA-REBUILD`). *(v1.6)* the dirty set is seeded with `edited ∪ volatileCells` (`INV-FORMULA-VOLATILE`, `CAP-FORMULA-VOLATILE`). |
| `PATTERN-SPILL` *(v1.6)* | Dynamic-array **spill** as an **anchor-owns-range projection**, mirroring `CAP-MERGE` (`PATTERN-*`-parity with the merge-region model): an array-valued formula lives in an **anchor** cell and its `rows × cols` result spills across the anchor + the cells below/right (the `ENTITY-SPILL-RANGE`). Non-anchor spill cells are **projections** (display the array element, not stored/editable — edits redirect to the anchor, `INV-SPILL-PROJECTION`/`-ANCHOR-OWNS`); a spill-time **collision check** over the target rectangle blocks an obstructed spill with `#SPILL!` (`INV-SPILL-EMPTY`/`-NONOVERLAP`); on recompute the range grows/shrinks + re-checks. Materialized in `COMPONENT-DATA-WORKER` (array eval). **Spill deltas cross the seam on the `recalc-result` message** (the worker diffs the previous vs current spill set per pass); `COMPONENT-API` re-emits them as per-anchor **`EVT-SPILL-CHANGE`** (canonical positional coords) and exposes the current ranges via **`LIB-FORMULA-SPILL`** (`getSpillRanges()`). `COMPONENT-RENDER` draws the `data-mg-spill` outline (the blue-box analogue) from those ranges — **per visually-contiguous run** when an active sort/filter fragments a canonical-contiguous range (values stay per-cell correct; only the halo is run-split). The **edit-guard** (`COMPONENT-EDIT`/`-INTERACTION`) blocks a typed edit/paste on a non-anchor spill cell and moves selection to the anchor (`INV-SPILL-PROJECTION`). Projected values flow through the derived pipeline (extends `INV-FORMULA-DERIVED`). |

### Technology choices
- **TypeScript**; ship JS + `.d.ts`.
- **Build targets:** tree-shakeable **ESM** (bundler users) **AND** a standalone **UMD/IIFE** bundle with the **worker inlined** (blob) for plain `<script>`/pure-HTML. *(CSP note: the blob-worker UMD build is blocked under strict `blob:`-forbidding CSP; such hosts use the ESM build with a **configurable worker URL** — `SEC-CSP-COMPAT`.)*
- **Zero required runtime deps** in core; platform APIs: **Web Workers**, **DOM**, **`Intl`**. Optional `.xlsx` lib is peer/optional (`DEP-XLSX`).
- **Monorepo** (`ADR-MONOREPO`); frameworks are peer deps.

### ADR register (`ADR-*`)
| ID | Decision · status | Consequence |
|---|---|---|
| `ADR-RENDER-DOM` | Virtualized DOM over Canvas · accepted | Native styling/editing/a11y + testable E2E. |
| `ADR-CORE-ADAPTERS` | Framework-agnostic core + adapters · accepted | Plain HTML or any framework. |
| `ADR-TYPESCRIPT` | TypeScript, ship `.d.ts` · accepted | Strong DX. |
| `ADR-WORKER-OPS` | Canonical data + heavy ops in a worker from v1 · accepted | Data reads/mutations async; jank-resistant at 1M rows. *(v1.1: real `WorkerTransport` becomes the default, realizing off-thread sort/filter — see `ADR-SORT-FILTER-SEAM`.)* |
| `ADR-SORT-FILTER-SEAM` | **Built-in sort/filter run in the worker via serializable specs; custom comparator/predicate functions run on the main thread** · accepted (v1.1) | Functions can't cross `postMessage`. Fully-built-in specs → worker (off-thread, the `ADR-WORKER-OPS` benefit realized). A spec containing **any** custom function → **whole op main-thread**: the worker sends the needed column values to the main thread, the fn runs there, and the resulting ordered/filtered index is installed. Trade-off: custom-fn ops on large data pay a transfer + main-thread cost (built-ins don't). |
| `ADR-CLIENT-OPS-V1` | Client-side ops v1; server delegation deferred v2 · accepted | Async DataSource designed now. |
| `ADR-DUAL-UPDATE` | Imperative + reactive, converge on store · accepted | One render-diff path. |
| `ADR-MONOREPO` | Monorepo core + per-framework adapters · accepted | Clean peer-dep boundaries. |
| `ADR-ESCAPE-DEFAULT` | Escape-by-default; renderers DOM/components only · accepted | XSS structurally prevented, zero-dep. |
| `ADR-ROW-HEIGHT` | **Variable per-row height** (measured cache + binary-search offsets) · accepted | Supports wrap + row resize; costlier virtualization than uniform. |
| `ADR-CONDFMT-AGG` | Conditional-format aggregates **worker-computed over the full dataset** · accepted | Stable, correct scales/bars; adds `MSG-AGGREGATE` round-trip + recompute on change. |
| `ADR-BUILD-TARGETS` | **ESM + standalone UMD/IIFE (worker inlined)** · accepted | Pure-HTML support; UMD blob-worker unusable under strict CSP → ESM+worker-URL fallback. |

### Scalability / resilience patterns
- **Scaling:** `PATTERN-VIRTUALIZATION` + worker offload (`ADR-WORKER-OPS`); budgets owned by Performance (`PERF-*`).
- **Worker resilience:** the worker owns the canonical dataset, so a worker crash loses in-worker state. **Policy (confirmed for v1):** a worker crash/termination is a **fatal error** — the grid emits `EVT-ERROR` with `GridError{ code:'WORKER_CRASHED', source:'data-op' }`, rejects in-flight ops, and enters a degraded read-only state; **recovery = host re-invokes `setData`** (edits since the last bind are lost). **[REVISIT] — v1 accepts data loss on crash; a later version should preserve edits by replaying the `COMPONENT-HISTORY` command journal onto a re-seeded worker (auto-recovery). Flagged for revisit before GA.**

## Open Questions
- Height-cache eviction for very tall sheets (keep all measured heights, or LRU + re-estimate)? — Performance tuning item.
- SSR/hydration support for the adapters — deferred? [REVISIT]

## Dependencies & Cross-references
- **Realizes:** `CAP-*` (P&R); **owns data placement of** `ENTITY-*` (Domain). **Anchors:** `MSG-*` (Interfaces owns the schemas; Architecture owns the protocol rules).
- **References:** `PERF-*` (budgets), `SEC-CSP-COMPAT`/`-ESCAPE-DEFAULT`/`-RENDERER-DOM-ONLY` (Security).

## Examples / Worked scenarios
- *Sort under load:* header click → `INTERACTION` → `API` → `MSG-SORT` → `DATA-WORKER` rebuilds the index off-thread → `MSG-INDEX-SUMMARY(version++)` → `VIEWPORT` re-queries → `RENDER` repaints; main never blocks.
- *Variable height:* a wrapped cell measured at 44px updates the height cache; the prefix-sum recomputes so scroll offsets stay correct (`PATTERN-VIRTUALIZATION`).

## Design Decisions
Cross-cutting decisions live in the `ADR-*` register. Component-local:
| Decision | Rationale |
|---|---|
| Worker owns canonical data (not a mirror) | Avoids duplicating 1M rows + sync bugs; trade-off = async data API + crash-recovery via re-bind. |
| Structural state main-thread & sync | Small, interaction-latency-sensitive; no worker round-trip. |
| Variable-height cache + binary search | Enables wrap/row-resize while keeping O(log n) offset lookup. |
| *(v1.3)* Multi-range selection = a **disjoint range-set** in `COMPONENT-STORE` (not per-key flags); header line-select materializes a full-axis range | One representation drives paint (`aria-selected` per cell) + clipboard; avoids a parallel selected-keys structure. No new ADR — a store-model refinement. |
| *(v1.3)* Autofit measures **visible/sampled cells only** (bounded pass) | A full-column scan over 1M rows would violate the frame budget; sampling visible content keeps autofit within an interaction frame (Performance). |
| *(v1.3)* Header region rendered by `COMPONENT-RENDER`, no imposed hierarchy; leading-pin reuses the freeze-prefix layout | Bands + spans are pure layout the renderer already models (rows × cols); pin is the existing count-based freeze prefix, RTL-aware — no new frozen-pane machinery. |
| *(v1.4)* Both context menus become one **builder-driven** surface in `COMPONENT-INTERACTION` (renders `MenuItem[]`, resolves built-ins, honors flags) | One `MenuBuilder` target-branched over cell/header/row/corner reuses a single menu renderer + command router; the existing interaction menu becomes data-driven — no new component and no new ADR (a controller refinement). |

## Contracts
The `COMPONENT-*` table (responsibility + owned interfaces + dependencies), the concrete `PATTERN-*` mechanisms, the boundary contracts, and the `ADR-*` register above **are** the contracts.

## Acceptance criteria
- **AC-BOUNDARY:** no main-thread module imports worker internals except the `MSG-*` protocol client (static/fitness check).
- **AC-ACYCLIC:** the `COMPONENT-*` dependency graph is acyclic and matches the documented edges.
- **AC-VIRT-BOUND:** under sustained scroll, live cell nodes ≤ viewport+overscan (ties to `PERF-NODES`).
- **AC-FLAG-COST:** a disabled feature registers no DOM affordance (and is tree-shakeable from the bundle).
- **AC-WORKER-CRASH:** a simulated worker termination emits `EVT-ERROR{ code:'WORKER_CRASHED' }`, rejects in-flight ops, and recovers on `setData`.

