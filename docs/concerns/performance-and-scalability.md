---
artifact: product-doc
role: concern
concern-id: performance-and-scalability
behavior: module
trigger: perf_scale_needs
in-scope-subaspects: [perf-targets, load-profiles, scaling-strategy-capacity-model, bottleneck-analysis, resource-budgets]
current-rung: contract-grade
status: published
version: 1.1.0
---

# Performance & Scalability — mini-grid

> One-line: the central NFR — render and interact with ~1M rows smoothly via **DOM virtualization + a data worker**, within a bounded frame/memory budget. Client/frame-budget profile: targets carry a main-thread/worker-seam/compositor boundary; load conditions are workload scripts (`SEQ-*`).

## Purpose & Scope

Owns performance **targets** (`PERF-*`), **load profiles** (`SEQ-*` workload scripts), the **scaling strategy + capacity model**, and — because **Observability (11.11) is absent** — the **measurement-hooks contract** (the marks/probes the grid must expose for its targets to be measurable). Architecture provides the enabling patterns (`PATTERN-VIRTUALIZATION`, `ADR-WORKER-OPS`); Quality's perf tier asserts these targets.

## Non-goals / Out-of-scope
- None scoped out. (Scaling *beyond host memory* — remote/paged data — is **[FUTURE-SCOPE] v2** via the async DataSource adapter; v1 targets client-side, in-memory scale.)

## Requirements

### Measurement method
- **Scroll frame time** — a `requestAnimationFrame` timestamp collector over a scripted scroll → **p95 frame time** + long-frame (>33ms) count. Headless Playwright.
- **Interaction latency** — `PerformanceObserver` (event/INP) action→next-paint.
- **DOM node count** — sampled during scroll (virtualization proxy).
- **Deep dives** — Chrome tracing / CDP when a budget fails.

**Key insight:** with virtualization, per-frame *scroll* cost is ~independent of row count (only ~viewport-worth of nodes are live). What scales with 1M rows is **worker sort/filter** and **memory**. Per `ADR-WORKER-OPS`, heavy ops run **in a web worker**, so the main-thread frame budget is protected; the spike calibrates the worker op time + seam round-trip.

### Performance targets (`PERF-*`) — **calibrated** (Slice 0 spike, reference machine)
Threshold = measured baseline + headroom; **frozen** where a measurement exists. `[PROVISIONAL]` marks the three whose feature isn't built yet (re-baselined when it lands); the formula targets (`PERF-RECALC-FULL`/`-RECALC-INCR`/`PERF-FORMULA-NEUTRAL` and the *(v1.6)* `PERF-RECALC-VOLATILE`/`PERF-RECALC-ARRAY`) are **built** but their thresholds remain **`[PROVISIONAL]` (demo-calibrated)** pending the perf-calibration spike (Delivery step 0); `PERF-RECALC-WORST` is already re-baselined post-optimization.
| ID | Metric | Threshold | Measured (5600G) | Boundary | Load |
|---|---|---|---|---|---|
| `PERF-SCROLL` | p95 frame time, sustained scroll | **≤ 33ms**; target p50 ≤ 16.7ms (60fps); **long-frame(>33ms) fraction ≤ 10%** *(the finer signal — see method)* | p50 16.7ms; **p95 16.8ms**; long-frame ≈2% after the slice-11b dirty-diff (was p95 33.4ms / ≈38% under fast fling) ✅ | main-thread + compositor | `SEQ-SCROLL` |
| `PERF-NODES` | live cell DOM nodes during scroll | **≤ 512** (≈2× viewport) | **480, bounded** ✅ | main-thread (DOM) | `SEQ-SCROLL` |
| `PERF-SORT` | sort 1M rows | **≤ 400ms** engine; **≤ 500ms** worker-seam incl. transfer | engine **267ms** ✅; **seam ≈190ms** ✅ (real `WorkerTransport`, Chromium; `mg:sort` round-trip **≈171ms**; **off-thread — 12 rAF frames painted during the sort, maxGap ≈20ms, main thread never blocked**) | *(v1.1)* **worker off-thread** for built-in specs (`ADR-SORT-FILTER-SEAM`); only the index summary crosses back (no rows), so the seam is *cheaper* than the pure engine time | `SEQ-SORT` |
| `PERF-FILTER` | filter 1M rows | **≤ 300ms** engine; **≤ 400ms** worker-seam | engine **158ms** ✅; **seam ≈65ms** ✅ (real `WorkerTransport`, Chromium; `mg:filter` round-trip **≈12ms**; built-in `id > 500000` off-thread — only the row-count summary crosses back) | *(v1.1)* worker off-thread for built-in specs; custom-fn filter runs main-thread | `SEQ-FILTER` |
| `PERF-MOUNT` | grid mount + first paint, 1M rows | **≤ 300ms** (grid work; excludes host row-gen) | **~161ms** ✅ | end-to-end (grid portion) | `SEQ-MOUNT` |
| `PERF-EDIT-OPEN` | open editor → paint | ≤ 100ms `[PROVISIONAL]` | built (slice 4); not yet calibrated | main-thread | `SEQ-EDIT` |
| `PERF-COMMIT` | single-cell commit round-trip | ≤ 50ms `[PROVISIONAL]` | built (slice 4); not yet calibrated | worker-seam | `SEQ-EDIT` |
| `PERF-PASTE` | apply large paste (~10k cells) | **≤ 150ms** | **~67ms** ✅ (slice 7, 5600G) | worker-seam | `SEQ-PASTE` |
| `PERF-RECALC-FULL` *(v1.5)* | full recalc of ~300k chained formula cells | `[PROVISIONAL]` (demo-calibrated) | engine (built) | engine | `SEQ-RECALC-FULL` |
| `PERF-RECALC-INCR` *(v1.5)* | single-cell edit → dirty-subgraph recalc | ≤ 16ms for a small subgraph `[PROVISIONAL]` | engine (built) | engine | `SEQ-RECALC-INCR` |
| `PERF-RECALC-WORST` *(v1.5; retargeted v1.7)* | full recalc of ~12k chained `FORECAST.ETS` cells (the slowest built-in after the v1.7 solver-opt pass; was ~300k `COUNTIF`) | **≈ 967 ms** (~80µs/cell over a 24-pt window; demo-calibrated) | engine | `SEQ-RECALC-WORST` |
| `PERF-RECALC-VOLATILE` *(v1.6)* | a recalc with `V` volatile cells is `O(V + affected)` — the always-dirty floor bounded by the volatile count | `[PROVISIONAL]` (demo-calibrated) | engine (built) | engine | `SEQ-RECALC-VOLATILE` |
| `PERF-RECALC-ARRAY` *(v1.6)* | an array recompute is `O(array size)` + a spill-collision check `O(spill cells)`; a resize re-projects only the delta | `[PROVISIONAL]` (demo-calibrated) | engine (built) | engine | `SEQ-RECALC-ARRAY` |
| `PERF-FORMULA-NEUTRAL` *(v1.5)* | existing `PERF-*`/bench hot paths **unchanged** with formulas present-but-unused | **no regression** — byte-identical bench, ±noise `[PROVISIONAL]` | all (built) | all | all `SEQ-*` |

> **Calibration status (Slice 0 done).** Six of the eight v1 targets are **frozen from measurement** on the reference machine (`AC-BASELINE` satisfied for the built surface): SORT/FILTER/MOUNT pass comfortably (engine optimized 7–8×); NODES is bounded; **`PERF-SCROLL` now passes** after the slice-11b renderer dirty-diff (p95 16.8ms, long-frame ≈2%) — see the resolved note below; and **`PERF-PASTE` is frozen** (~67ms, slice 7). The remaining two — `EDIT-OPEN`/`COMMIT` — are **built** (slice 4) but stay `[PROVISIONAL]`: no measurement has been taken yet, so their thresholds await a calibration pass. The SORT/FILTER *worker-seam round-trip* (structured-clone transfer) has since been **re-verified with the real `WorkerTransport`** (see the measured seam figures above; the Slice-0 spike had measured the engine via the in-process transport). *(The formula `PERF-RECALC-*` targets are additional to these eight v1 baselines — built, demo-calibrated, thresholds provisional.)*

> **[RESOLVED slice 11b] renderer dirty-diffing.** The Slice-1 renderer re-rendered the full visible window on every scroll event (no per-cell dirty-diff), so ≈38% of frames dropped one vsync under scripted fast fling → `PERF-SCROLL` p95 sat at the 33.4ms boundary. Slice 11b added a **keyed dirty-diff over the row pool** (`renderKeyed`/`paintRow` in `render/renderer.ts`, driven by a `scrollOnly` refresh from `api/grid.ts`): a scroll-only refresh **retains** the pool nodes of rows still visible (matched by rowIndex + rowKey + visible-column signature) untouched — because a row is absolutely positioned by its logical index, a retained row needs no DOM write — and repaints only the rows that newly entered the window. Content-changing refreshes (edit/sort/filter/style/structural/cond-fmt/locale/theme) and any freeze/merge/group-collapse layout fall back to the full sequential repaint. Re-measured on the reference machine: **p95 16.8ms, long-frame ≈2%** (median-of-5), `PERF-NODES` still 480. Note: headless Chromium quantizes frame deltas to vsync multiples, so sub-frame timing isn't observable headless — the **long-frame fraction** is the contracted finer signal.

**`PERF-SCROLL` percentile method (finalized; co-owned with Quality 11.5):**
- **Sample source:** **5 fresh page contexts** (separate Playwright pages), each runs `SEQ-SCROLL` **once**, collecting every inter-frame `rAF` delta.
- **Per-run metric:** p95 of that run's frame-time samples over the **single window** = the whole scripted scroll (no sub-bucketing → **no trailing-partial-bucket ambiguity**).
- **Reported figure:** the **median of the 5 per-run p95 values**; **pass** iff ≤ the budget.
- **Re-run rule (measurement tier):** a failing aggregate → investigate + **one full re-run** (all 5 contexts); **record the incident + both aggregates** (never quarantine) — the Quality/Perf co-defined measurement-tier exception to zero-retry.

**Reference machine:** AMD Ryzen 5 5600G, 6 logical CPUs, ~8 GB RAM, Debian 12, Chromium 141, Node v22; no CPU throttling. [REVISIT] if the dev machine changes.

### Load profiles — workload scripts (`SEQ-*`)
Each `SEQ-*` is the contracted input sequence standing where "requests/sec" would; feasibility is trivially met (dataset ≥ viewport) or delegated to pure-module precompute (Quality 11.5).
- `SEQ-SCROLL` — load 1M rows; programmatically fling/scroll top→fixed offset in page increments, sampling frame times.
- `SEQ-SORT` / `SEQ-FILTER` — load 1M; issue sort on a numeric column / filter matching a set fraction; await settle.
- `SEQ-EDIT` — open an editor on a visible cell, type, commit.
- `SEQ-MOUNT` — construct the grid over a 1M-row array; measure to first paint.
- `SEQ-PASTE` — select a range; paste a large TSV block.
- `SEQ-RECALC-FULL` *(v1.5)* — load N rows where a wide+deep formula field chains (≥300k formula cells); measure the first **full** recalc.
- `SEQ-RECALC-INCR` *(v1.5)* — edit one upstream cell; measure the **incremental** recalc of its dependents.
- `SEQ-RECALC-WORST` *(v1.5)* — load ≥300k cells of the slowest built-in (`COUNTIF`) **chained** (each a `COUNTIF` over a bounded window whose criteria references the previous chain cell); measure full + head-of-chain recalc → the **worst-case envelope** vs `SEQ-RECALC-FULL` at equal cell count.
- `SEQ-RECALC-VOLATILE` *(v1.6)* — load a sheet with `V` volatile cells (`RAND`/`NOW`/`OFFSET`/…) among N formula cells; edit one unrelated cell and measure the recalc — asserting the always-dirty floor is `O(V + affected)`, not `O(all)`.
- `SEQ-RECALC-ARRAY` *(v1.6)* — mount an array-formula anchor spilling a large rectangle (e.g. `SEQUENCE`/`FILTER`); measure the array recompute + spill-collision check, and a resize (grow/shrink) that re-projects only the delta.

**Profiles:** *expected* = ~1M rows × moderate columns (~10–30); *peak* = 1M × **wide** (many columns, horizontal virtualization) + heavy conditional-format rule set + fast fling-scroll; *growth* = beyond host memory → v2 async adapter.

### Scaling strategy + capacity model
- **Strategy:** DOM virtualization (live nodes bounded to viewport + overscan) **+ worker offload** of data + heavy ops. No infra scaling (client-side).
- **Capacity:** **no built-in row cap** — bounded by **host memory**; the dataset lives in the **worker heap**. A practical max-rows figure is documented from the spike; beyond it, the **v2 async adapter** is the path.
- **Memory model:** worker heap ≈ rows × per-row size (host objects) + index arrays (ordered/filtered ≈ rows × ~4–8 bytes). Main-thread ≈ visible-window nodes + sparse style overlays + structural state.

### Bottleneck analysis
- **Worker sort/filter** over 1M rows — the primary CPU cost (the one to spike; possible index/precompute strategies).
- **Seam transfer** — initial dataset → worker (structured-clone / transferable); window replies are small.
- **Main-thread** — style recalc / layout thrash, per-cell node cost, conditional-format evaluation over the visible window, large-paste application, GC from node churn (mitigated by recycling).
- *(v1.3)* **Autofit** measures a **bounded set — visible/sampled cells only** (no full-column scan over 1M rows), so a fit stays within an interaction frame; **fit-all** iterates columns over the same bounded per-column measure. **Multi-range selection** paint applies `aria-selected`/highlight only to cells **in the visible window** (the range-set is logical; virtualization bounds the DOM writes), so it stays within the existing scroll-frame budget (`PERF-SCROLL`). No new hard target — folded under `PERF-SCROLL`/`PERF-NODES`; a dedicated autofit budget is `[PROVISIONAL]` (re-baseline when the feature lands).

### Micro-bottleneck register (v1.1 optimization pass)
A function-level micro-analysis of the **built** paths flagged **14** candidate hot-path items (P1–P14). All are **internal — observable behavior/output is UNCHANGED** (no `LIB-*`/`ENTITY-*`/`CAP-*` shape change). Each carries a **base-vs-after** benchmark per Quality `AC-PERF-BENCH` — **but the benchmark is a gate, not a rubber stamp: 11 shipped as real wins; P8 and P7's map-reuse were benchmark-REJECTED (no code change), and P14 shipped PARTIAL** (see the outcome notes in the `Target` column and the `[DEFERRED]` clauses under the guard contracts below). Tiers: **T1** = per-visible-cell × per-frame paint (hottest), **T2** = per-frame refresh/scroll, **T3** = per-operation over N rows / bulk.

| ID | Location | Current cost | Target | Tier / hotness | Guard · CE / slice |
|---|---|---|---|---|---|
| **P1** | `format/format-mask.ts` `applyMask` | builds `new Intl.NumberFormat`/`Intl.DateTimeFormat` per cell per frame | memoize formatters by `(locale, mask)` | T1 · per-cell×frame | `PERF-CELL-PATH` · CE-PERF-1 / s22 |
| **P2** | `format/conditional.ts` `evaluate` | `.filter` + O(rules) scan + `.sort` per cell | pre-sort rules by priority at add/remove, index by column, short-circuit 0/1-match | T1 · per-cell×frame | `PERF-CELL-PATH` · CE-PERF-2 / s23 |
| **P3** | `api/grid.ts:693` `columnDefaultStyle` (cascade base-style) | O(cols) `Array.find` per cell | O(1) `Map<ColumnId,ColumnDef>` | T1 · per-cell×frame | `PERF-CELL-PATH` · CE-PERF-3 / s24 |
| **P4** | `format/style-cascade.ts` `resolve`/`compute`; `conditional.ts` `applyColorScale`/`applyDataBar` | per-cell memo-key string alloc + duplicate rebuild on miss; re-parse static hex per cell | pass computed key through; cache parsed `Rgb` per rule | T1 · per-cell×frame | `PERF-CELL-PATH` · CE-PERF-4 / s25 |
| **P5** | `api/grid.ts:1828` `renderGroupOutline` | full DOM teardown/recreate of group toggles every refresh (incl. scroll-only) | reuse nodes keyed by group id, reposition on scroll | T2 · per-frame refresh | `PERF-FRAME-STEADY` · CE-PERF-5 / s26 |
| **P6** | `render/renderer.ts:931,1280` `paintRow`/`mergeAt` | O(merges) scan per cell + merges disable the keyed fast path (full sequential repaint/frame) | **SHIPPED: resolve the row's merges once per row** (column-only scan per cell), not O(merges) per cell. *(Re-enabling the keyed fast path under merges — the bigger repaint win — deferred.)* | T2 · per-frame refresh | `PERF-FRAME-STEADY` · CE-PERF-6 / s27 |
| **P7** | `api/grid.ts:969,959,378` `refresh` | 3 `new Map()`/refresh; `mergeModel.list()` twice; `frozenColExtent`/`pinnedColCount` O(cols) reduce/frame | **SHIPPED: single `list()` only.** Map-reuse `.clear()` **REJECTED** (bench: `new Map` faster for the small window maps); pinned-count cache **skipped** (O(cols)≈30, negligible) | T2 · per-frame refresh | `PERF-FRAME-STEADY` · CE-PERF-7 / s28 |
| **P8** | `api/event-bus.ts:92,113` `emit`/`emitVetoable` | `[...set]` listener-snapshot per dispatch (scroll = per-frame) | **REJECTED — no code change.** The `[...set]` copy is a deliberate self-unsubscribe snapshot; the safe variant benched 1.18× on an op already >14M dispatches/s | T2 · per-frame refresh | `PERF-FRAME-STEADY` · CE-PERF-8 / s29 |
| **P9** | `api/grid.ts:1046` `onScroll` | visible windows computed twice per scroll | compute once, thread into `refresh` | T2 · per-frame refresh | `PERF-FRAME-STEADY` · CE-PERF-9 / s30 |
| **P10** | `engine/index-engine.ts:453` `buildFilteredIndex` | allocates per-row `{rowKey,columnId,field,data}` context over n even for built-in predicates that ignore it | build context only for custom predicates | T3 · per-op / bulk | `SCALE-FILTER-CTX` · CE-PERF-10 / s31 |
| **P11** | `engine/index-engine.ts:220` `aggregate` topN | full O(n log n) sort + full-size `.slice()` clone for top-10 | bounded partial-selection / min-heap **O(n log N)**, sort in place | T3 · per-op / bulk | `SCALE-AGG-TOPN` · CE-PERF-11 / s32 |
| **P12** | `protocol/engine-host.ts:70` + `data-client.ts:548` + `index-engine.ts:158` | export-rows path re-wraps the whole row set with `.map` up to 3× over n | collapse to one pass | T3 · per-op / bulk | `PERF-FRAME-STEADY` (single-pass clause) · CE-PERF-12 / s33 |
| **P13** | `editing/edit-session.ts:469` `applyBatch` | `columns.find` per write in paste/fill → O(N×C) | build `Map<id,ColumnDef>` once → O(N) | T3 · per-op / bulk | `SCALE-PASTE-APPLY` · CE-PERF-13 / s34 |
| **P14** | `interaction/interaction.ts:412` drag update; `selection.ts:116` `coalesceAll` | projects the range-set twice per cell-crossing; `coalesceAll` O(k²)/O(k³) over range count | **PARTIAL: `length ≤ 1` short-circuit only** (the common single-range drag). Sort-sweep O(k log k) coalesce is **order-dependent** (would change reported ranges) + single-projection needs risky memoization → **deferred** (k = user ranges, tiny) | T3 · per-op / bulk | `SCALE-SELECT-COALESCE` · CE-PERF-14 / s35 |

### Hot-path target contracts (`PERF-*` / `SCALE-*`) — regression guards (v1.1)
These are **regression guards, not new budgets** — the win is measured **per item** by the base-vs-after `*.bench.ts` (Quality `AC-PERF-BENCH`). Each is a Contract-grade, **checkable** structural/behavioral condition that keeps the optimized path from silently regressing; each adds **no** observable behavior (output byte-identical). Six contracts cover all 14 items.

- **`PERF-CELL-PATH`** — the per-visible-cell decorate path (`decorateCell` → `formatValue` / style-cascade / conditional) **(a)** constructs **no** `Intl.NumberFormat`/`Intl.DateTimeFormat` per cell (formatters memoized by `(locale, mask)`), **(b)** does **no** O(columns) lookup (column resolved via an O(1) `Map`), **(c)** adds **no** unnecessary per-cell allocation (memo-key threaded through; parsed rule colors cached). *Covers P1–P4.* **Proven by:** a `format/*.bench.ts` decorate-path benchmark (base-vs-after) **+** a structural assertion — a spy/counter records **0** `Intl.*Format` constructions across a full-window paint and confirms Map-based (not `Array.find`) column resolution on the per-cell path.
- **`PERF-FRAME-STEADY`** — a **scroll-only** refresh **(b)** **reuses** group-outline nodes (keyed by group id, repositioned — no teardown/recreate; P5), **(c)** computes the visible window **once** per scroll and threads it into `refresh` (P9), **(e′)** resolves the merges covering a row **once per row** in `paintRow` (a column-only scan per cell, not O(merges) per cell; P6), and **(f)** the `MSG-EXPORT-ROWS` reply projects the row set with **no redundant full-n re-wrap** (P12; the custom-fn `computeOrderedKeys` extra passes are the documented slow lane, out of scope). Also: `refresh` calls `mergeModel.list()` **once** per frame (P7). *Covers P5, P6, P9, P12, P7 (partial).* **[DEFERRED — benchmark-rejected / assessed]:** *(a)* per-row `Map` reuse (`.clear()`) — **rejected**: `new Map` benched faster for the small window maps; the pinned-count cache was skipped (negligible O(cols)); *(d)* dropping the per-`emit` `[...set]` listener snapshot — **rejected**: it is a deliberate self-unsubscribe guard on an op already >14M dispatches/s; the merge-aware **keyed fast path stays disabled under merges** (re-enabling it is a heavier separate follow-up). **Proven by:** `api/group-outline.bench.ts` + `render/merge-lookup.bench.ts` + `api/scroll-window.bench.ts` + `protocol/export-rows.bench.ts` (base-vs-after) **+** the group/merge/scroll behavior tests (byte-identical output).
- **`SCALE-AGG-TOPN`** — top-N aggregate is **O(n log N)** (bounded partial-selection / min-heap), **not** O(n log n) full-sort + full-size clone. *Covers P11.* **Proven by:** an `engine/*.bench.ts` top-N benchmark over 1M rows (base-vs-after) **+** an output-equivalence unit test (identical top-N result/order to the sort-based reference) and an allocation check (no full-size clone).
- **`SCALE-FILTER-CTX`** — the **built-in** filter path allocates **no** per-row-per-predicate context object (O(1) per row on the built-in path; the `{rowKey,columnId,field,data}` context is built **only** for a custom predicate). *Covers P10.* **Proven by:** an `engine/*.bench.ts` built-in-filter benchmark over 1M rows (base-vs-after) **+** a structural assertion (context-factory call count = 0 for a built-in spec; > 0 only on the custom-fn path).
- **`SCALE-PASTE-APPLY`** — batch apply resolves columns in **O(1)** (a `Map<id,ColumnDef>` built once), total **O(N)** not O(N·C). *Covers P13.* **Proven by:** an `editing/*.bench.ts` large-paste `applyBatch` benchmark (base-vs-after) **+** a structural assertion (no per-write `columns.find`) and output-equivalence with the pre-change apply.
- **`SCALE-SELECT-COALESCE`** *(partial)* — range-set coalesce **short-circuits k ≤ 1** (the common single-range drag), skipping the pairwise loop; byte-identical for k ≥ 2. **[DEFERRED — assessed, not worth it]:** the O(k log k) sort-sweep is **order-dependent** (bounding-box merges can change the reported disjoint ranges) and single-projection needs wide-surface `getRanges` memoization — so for **k ≥ 2** the coalesce is still O(k²)/O(k³) and a drag update still projects the range-set **twice** per cell-crossing (k = user-created ranges, tiny in practice; the fuller win did not justify the behaviour/invalidation risk). *Covers P14 (partial).* **Proven by:** `selection/selection-coalesce.bench.ts` (base-vs-after — the short-circuit is ~1.04×, since coalesce is already ~14M ops/s for k ≤ 1) **+** the `INV-SELECTION-WELLFORMED` disjointness tests.

### Resource budgets
- **No hard memory cap** (operator decision) — bounded by host memory. **Envelopes:** live cell DOM nodes ≤ **viewport + overscan (~2×)**; main-thread work per frame ≤ **frame budget (16ms target)**; worker heap ≈ `rows × per-row-size (host objects)` + index arrays `≈ rows × ~8 bytes`. **Practical max-rows** figure documented from the spike (`[REVISIT]`). These envelopes are contract-grade; the practical-max number is spike-set.

### Measurement-hooks contract (Performance owns — Observability absent)
The grid exposes (opt-in via `options.perf: true`) **User-Timing marks/measures** so the harness and consumers measure `PERF-*` **without internal patching**: `mg:mount`, `mg:window-query`, `mg:sort`, `mg:filter`, `mg:commit`, `mg:paste` (each a `performance.measure` with start/end marks; the async ones tagged with the `reqId`). Plus `grid.getPerfMarks(): PerfEntry[]` and an opt-in `EVT-PERF` event carrying the latest measure. The Quality rAF frame-time collector consumes these + `PerformanceObserver`. This is the finalized measurement-hooks surface.

## Open Questions
All remaining items are **spike calibration outputs**, not doc gaps (structure is contract-grade):
- Do worker sort/filter + seam round-trip stay ≤ the budget on the reference machine? (spike settles the number)
- Overscan/buffer size vs scroll smoothness trade-off (spike-tuned).
- Practical max-rows figure and whether wide-column peak needs its own budget row.

## Dependencies & Cross-references
- **Realizes:** `SUCCESS-LARGE-DATA` (P&R pointer resolves here). **Enabled by:** `PATTERN-VIRTUALIZATION`, `ADR-WORKER-OPS` (Architecture).
- **Referenced by:** Quality & Testing (perf tier asserts `PERF-*` over `SEQ-*`; percentile re-run co-owned; the **micro-benchmark tier** + `AC-PERF-BENCH` measure/guard the v1.1 hot-path contracts `PERF-CELL-PATH`/`PERF-FRAME-STEADY`/`SCALE-*`).

## Examples / Worked scenarios
- `PERF-SORT` under `SEQ-SORT`: `await grid.sort([{columnId:'value',direction:'desc'}])` over 1M rows completes ≤ 500ms end-to-end (worker rebuilds index off-thread; visible window repaints) — main thread never blocks.

## Design Decisions
| Decision | Rationale |
|---|---|
| Virtualization + worker offload is the scaling strategy | Bounds live nodes to viewport; keeps heavy CPU off the render thread. |
| No built-in row cap; bounded by host memory | Operator-chosen; avoids an arbitrary limit — v2 adapter handles beyond-memory. |
| Targets carry a client measurement boundary; load = `SEQ-*` scripts | Client/frame-budget product has no requests to count; boundary + script make targets testable (spec client profile). |
| Performance owns the measurement-hooks contract | Observability is absent, so the marks/probes needed to measure `PERF-*` are homed here. |

## Contracts
The `PERF-*` targets (metric + measurement boundary + load `SEQ-*`; numbers **provisional, spike-re-baselined**), the finalized **`PERF-SCROLL` percentile method**, the `SEQ-*` workload scripts, the **measurement-hooks surface** (`options.perf` marks + `getPerfMarks()` + `EVT-PERF`), and the **resource envelopes** above are the contracts. Only the numeric thresholds carry `[REVISIT]` (spike); the structure is frozen. The **v1.1 hot-path guard contracts** (`PERF-CELL-PATH`, `PERF-FRAME-STEADY`, `SCALE-AGG-TOPN`, `SCALE-FILTER-CTX`, `SCALE-PASTE-APPLY`, `SCALE-SELECT-COALESCE`) are Contract-grade regression guards — each a measurable structural/behavioral condition (above) bound to a `*.bench.ts` + behavior test when its slice lands. They are **additive/internal**: no observable behavior changes, so no `PERF-SCROLL`/`-SORT`/`-FILTER` budget number is re-baselined by the optimization pass (the wins buy headroom, not a new threshold).

## Acceptance criteria
- **AC-SCROLL:** under `SEQ-SCROLL`, the median-of-5 p95 frame time ≤ the (spike-set) budget and live cell nodes ≤ viewport+overscan.
- **AC-SORT/-FILTER:** `SEQ-SORT`/`SEQ-FILTER` over 1M rows complete ≤ the (spike-set) end-to-end budget at the worker-seam boundary.
- **AC-MARKS:** with `options.perf`, `mg:sort`/`mg:commit`/`mg:window-query` measures are emitted and readable via `getPerfMarks()`.
- **AC-BASELINE:** the perf-calibration spike (Delivery step 0) records baselines on the reference machine and **replaces every provisional number**, after which the thresholds are frozen (no `[REVISIT]`).
- **AC-HOTPATH-GUARD:** each **shipped** `PERF-CELL-PATH` / `PERF-FRAME-STEADY` / `SCALE-*` structural/behavioral condition holds (asserted in unit/bench per the "Proven by" above) — the clauses marked **[DEFERRED]** (P7 map-reuse, P8, P14 sort-sweep/single-projection, the keyed-fast-path-under-merges) were benchmark-rejected or assessed-not-worth-it and are **NOT** asserted; and every P1–P14 item records a **base-vs-after** benchmark — a win for the 11 shipped items, or the measurement that **justified rejecting** it (per Quality `AC-PERF-BENCH`); output stays byte-identical to pre-change (no `LIB-*`/`ENTITY-*`/`CAP-*` behavior contract touched).

