---
artifact: product-doc
role: concern
concern-id: quality-and-testing
behavior: core
trigger: always
in-scope-subaspects: [test-pyramid-test-types, coverage-map, real-flow-e2e-standard, quality-bars-gates, test-data-strategy, specialized-testing, test-stage-fidelity-mapping, manual-exploratory]
current-rung: contract-grade
status: published
version: 1.1.0
---

# Quality & Testing — mini-grid

> One-line: unit-tested engines, **DOM-driven real-browser E2E**, a **feature-flag matrix**, and page-governed security/a11y/perf checks — with a **coverage map over every in-scope ID** and an accountability record for anything uncoverable. Toolchain: Vitest + Playwright + axe-core.

## Purpose & Scope

Owns the test strategy, quality bars, the **coverage map**, and the real-flow **E2E standard** (`E2E-STANDARD`). Delivery references `E2E-STANDARD` for proof-of-done.

## Non-goals / Out-of-scope
- None scoped out.
- **Visual-regression (pixel snapshots)** — *(deliberately excluded)*: conditional-format rendering is verified by **computed-style/attribute assertions**, not screenshots (avoids flake tension with the zero-retry policy).

## Requirements

### Test pyramid / types & toolchain
- **Unit (Vitest):** virtualization math (prefix-sum/binary-search offsets), worker index/sort/filter/aggregate (pure modules), style cascade, format masks, conditional-rule eval, validation, undo/redo history, state (de)serialization, CSV/xlsx mapping, i18n formatting, export formula-guard; *(v1.5)* **formula** parser → AST, evaluator + ~70-function library, typed error values, dependency-graph recalc (full Kahn + incremental BFS), cycle detection; *(v1.6, built)* the **full function catalog** (per-function input→output + `*IFS` multi-criteria), **volatile** recalc (`AC-FORMULA-VOLATILE`), **reference** values (`OFFSET`/`INDIRECT`/`INDEX`(ref)/`ADDRESS`), and **array** eval — with **spill** (materialize/collide/resize/derived) covered by component + E2E; *(v1.7, built)* the **catalog-completion buckets** (odd-period bonds, regression/matrix arrays, `GROUPBY`/`PIVOTBY` — the catalog now **475 registry functions + 9 special forms**, `AC-CATALOG-V17`) and the implicit-intersection **`@` operator** (`AC-FORMULA-INTERSECT`).
- **Component/integration:** editing lifecycle, selection/clipboard, freeze/merge/group, the `MSG-*` protocol (reqId/version/stale-drop), adapter bindings.
- **E2E (Playwright, real Chromium):** the `JOURNEY-*` set — scroll, edit→validate→commit, copy/paste, async sort/filter, frozen panes, conditional formatting visible, keyboard-only nav, RTL; *(v1.5)* **formula authoring** + the derived pipeline (sort/filter by a formula column uses computed values, the editor shows the formula string, CSV export emits the result).
- **Micro-benchmark (`vitest bench`):** `packages/core/src/**/*.bench.ts` — measures the hot paths (per-visible-cell decorate, scroll-only refresh, top-N aggregate, built-in filter, batch paste-apply, range coalesce) for the v1.1 optimization pass. Each records a **base benchmark before the change and a comparison after**; a retained hot-path bench guards against future regression. *(v1.5)* the `formula/*.bench.ts` tier measures **full + incremental recalc** (`PERF-RECALC-FULL`/`-INCR`) and re-runs the Part-2 baseline benches with the formula module present (`PERF-FORMULA-NEUTRAL` — no regression, byte-identical). **Not a CI gate** (like E2E/perf — runs pre-merge on the reference machine) unless trivially cheap. See `AC-PERF-BENCH`.
- **Specialized:** performance, accessibility, security (below).

### Real-flow E2E standard (`E2E-STANDARD`)
- Drives the **real DOM** + the grid's **own code paths** (real worker, real virtualization, real veto flow) — no test hatch as the primary path.
- **Operates every interactive control** on `SCREEN-GRID` + layers (header sort/filter/resize/reorder, fill handle, editors, scroll, selection, clipboard, context menu, group collapse), each ≥once, asserting a **non-error** rendered outcome.
- **Determinism:** virtualization/scroll assert **run-invariant observables** (which rows/cells are in the DOM at an offset; settled state) — never frame-by-frame trajectories.
- **Policy-liveness (security):** `SEC-ESCAPE-DEFAULT`/CSP checks observe **page-governed** behavior (a script-bearing cell value does **not** execute in the page; real CSP violation events) — never harness `eval`.
- **Pure-module pre-computation** sanctioned: import the grid's pure sort/format modules to compute expected values.
- **Where it runs (decision, 2026-07-03):** `E2E-STANDARD` (Playwright + axe) and the `PERF-*` harness run **pre-merge on the reference machine** (`pnpm e2e`), **not in GitHub Actions CI**. CI (`.github/workflows/ci.yml`) is scoped to **typecheck + build + unit** (which includes the `SEC-*` static scan over the built bundle); E2E needs real Chromium (per-run browser + system-dep install) and perf needs the calibrated reference hardware — both exceed the available Actions budget. Every merge is still gated on a green E2E run on the reference machine; this is a CI-resourcing choice, not a coverage reduction. Revisit if CI resources grow.

### Coverage map (every in-scope ID → disposition)
Coverage is provided at **whichever tier fits** (unit / integration / E2E). **Aim: 100% of in-scope testable IDs covered.** Owning-concern `AC-*` are the concrete tests; this map assigns each family and enumerates the Quality-owned mappings.

| ID family | Count | Coverage | Where |
|---|---|---|---|
| `CAP-*` | 32 | real-flow E2E via the owning `JOURNEY-*` (user-facing) + unit for engine caps; *(v1.3/v1.4)* `CAP-HEADER`/`-COLUMN-MANAGE`/`-MENU`/changed `CAP-SELECT` → real-flow E2E via `JOURNEY-HEADER`/`JOURNEY-RANGE-OPS` (`CAP-MENU`: default builder + a **custom builder** with a custom item + submenu + toggle + built-in-by-`command` id + flag-hidden built-in + programmatic `openMenu`); `CAP-ROW-HEADER`/`CAP-HEADER-MENU` **retired** (tombstones, not counted); *(v1.5)* `CAP-FORMULA` → formula unit (parser/eval/recalc) + `AC-FORMULA-*` derived-pipeline E2E + `formula/*.bench.ts`; *(v1.6, built)* `CAP-FORMULA-FN`(extended)/`CAP-FORMULA-VOLATILE`/`CAP-FORMULA-REFVAL` → **unit** (per-function catalog / volatile re-roll / reference eval) + `CAP-FORMULA-ARRAY` (spill) → **component + E2E** (`AC-FORMULA-CATALOG`/`-VOLATILE`/`-REFVAL`/`-ARRAY-*`); *(v1.7, built)* `CAP-FORMULA-FN`(completed, 475) → **unit** (`AC-CATALOG-V17`) + `CAP-FORMULA-INTERSECT` → **unit** (`AC-FORMULA-INTERSECT`); the spill **event + outline + edit-guard** delta → `AC-SPILL-EVENT`/`-OUTLINE`/`-GUARD` (unit + component + E2E; **specced, build pending**) | E2E + unit |
| `INV-*` | 28 | **one assertion per invariant** — the 16 core-model invariants are enumerated in the assertion list below; the **12 formula-family invariants** (v1.5–v1.7) ride the named `AC-FORMULA-*`/`AC-SPILL-*` rows per the routing note below the list | unit/component |
| `LIB-*` | ~50 | contract/integration test per element + **edge/default inputs** (absent, empty, one malformed) → contracted result or `ERR-*` | unit/component; Interfaces `AC-RESULT`/`-VETO`/`-EMPTY`/`-BOUND`/`-STATE-VERSION` |
| `EVT-*` | ~25 | **veto + payload projection** per event (vetoed before aborts, no after) | component; Interfaces `AC-VETO` |
| `MSG-*` | 20 | protocol tests: reqId present, superseded-version reply dropped | component; Interfaces `AC-MSG` |
| `ERR-*` | 14 | **forced-by + proving tier** already specified in Interfaces `ERR-*` catalog (14 codes over 13 catalog rows — `INVALID_OPTIONS`/`INVALID_COLUMN_DEF` share one) | per row (unit/component/E2E) |
| `SEC-*` | 12 | static scan (no fetch/storage/eval) + runtime (escape/paste/export-guard); *(v1.4)* `SEC-MENU-CUSTOM-RENDER` — the developer-trust-boundary **contrast** to `SEC-RENDERER-DOM-ONLY` (type/factual + a mount-as-is runtime check); the factual `SEC-TRUST-BOUNDARY` is an accountability `n/a` (below) | Security `AC-*`; static + E2E |
| `LICENSE-TIER`/`LEGAL-*` | 3 | `LEGAL-ATTRIBUTION` = LICENSE-file release-gate lint; `LICENSE-TIER-OSS` + `LEGAL-NAME` = accountability `n/a` (below) | lint/static; n/a |
| `PERF-*` / `SEQ-*` | 14 / 11 | perf tier runs each `SEQ-*` script, asserts the `PERF-*` budget on the reference machine (the 8 v1 targets + the 6 v1.5/v1.6 formula `PERF-RECALC-*`/`PERF-FORMULA-NEUTRAL` targets; `SEQ-SORT`/`SEQ-FILTER` share a bullet) | perf (Playwright) |
| **hot-path guards** (`PERF-CELL-PATH`/`PERF-FRAME-STEADY`/`SCALE-AGG-TOPN`/`-FILTER-CTX`/`-PASTE-APPLY`/`-SELECT-COALESCE`) | 6 | *(v1.1 optimization pass)* **micro-benchmark tier** (`vitest bench` over `*.bench.ts`, base-vs-after per P1–P14) **+** the **shipped** structural/behavioral assertion each contract names (0 `Intl.*Format`/frame, Map-based cascade lookup, reused group nodes, single window pass, row-scoped merge resolve, single export-rows pass, O(n·count) top-N, no per-row filter ctx on built-ins, O(1) paste column resolve, coalesce short-circuit k≤1) — output byte-identical. **NB:** P8 (emit snapshot) + P7 map-reuse were **benchmark-rejected** and the O(k log k) coalesce / single-projection **deferred** — those clauses are **not** asserted (see Performance `[DEFERRED]`) | micro-bench + unit/component (`AC-PERF-BENCH`) |
| `A11Y-*` | 6 | axe (zero violations) + keyboard-only journey + programmatic live-region assertions; `A11Y-I18N` → the i18n tier (externalization swap + RTL axe) | a11y tier |
| `SCREEN-GRID` / `LAYER-*` / `JOURNEY-*` | 1/6/7 | real-flow E2E operating every control *(v1.3: +`LAYER-HEADER-MENU`, +`JOURNEY-HEADER`; v1.4: both `LAYER-CONTEXT-MENU`+`LAYER-HEADER-MENU` builder-driven, `CAP-MENU`; v1.6 delta: +`LAYER-SPILL-OUTLINE` — specced, build pending, → `AC-SPILL-OUTLINE`)* | E2E |
| `COMPONENT-*` / `PATTERN-*` | 15 / 7 | Architecture fitness checks (`AC-BOUNDARY`/`-ACYCLIC`/`-VIRT-BOUND`/`-FLAG-COST`/`-WORKER-CRASH`); patterns via behavior | fitness + behavior |
| `SUCCESS-*` | 24 | **one demonstration per criterion** (pointers → PERF/A11y tiers; `SUCCESS-DX` → demo-page E2E + docs-compile; *(v1.3/v1.4)* `SUCCESS-HEADER`/`-COLUMN-MANAGE`/`-MENU` → `JOURNEY-HEADER` E2E; *(v1.5–v1.7)* `SUCCESS-FORMULA`/`-CATALOG`/`-VOLATILE`/`-REFVAL`/`-ARRAY`/`-INTERSECT` → their `AC-FORMULA-*`/`AC-CATALOG-V17` checks (P&R observable-check table); `SUCCESS-ROW-HEADER` retired → `SUCCESS-HEADER`, `SUCCESS-HEADER-MENU` retired → `SUCCESS-MENU`) | E2E/perf/a11y |
| `DEP-*` | 4 | adapter-mount integration tests; xlsx faked/absent path | integration |
| `POLICY-DATA-HANDLING` | 1 | the `SEC-*` static scan (no egress/persist/log) | static |

**`INV-*` assertions (one each):** `INV-COLKEY-UNIQUE` (dup id throws) · `INV-ROWKEY-UNIQUE` (dup key throws / last-wins) · `INV-CELL-DERIVED` (updateCell reflects in row.data) · `INV-MERGE-NONOVERLAP` (overlap rejected) · `INV-MERGE-MIN2` (delete-to-1 dissolves) · `INV-RANGE-BOUNDS` (post-CRUD clamp) · `INV-FREEZE-PREFIX` (clamp) · `INV-GROUP-NEST` (partial-overlap rejected) · `INV-SELECTION-ACTIVE` · `INV-EDIT-SINGLE` · `INV-HISTORY-LINEAR` (redo cleared; maxDepth bound) · `INV-ROWSTATE` (transitions + getChanges) · *(v1.3)* `INV-SELECTION-WELLFORMED` (disjoint, non-empty ranges) · `INV-SELECTION-LINE` (line range spans full axis) · `INV-COLUMN-HIDDEN-EXCLUDED` (hidden column absent from projection) · `INV-COLUMN-PIN-LEADING` (leading contiguous pinned block, RTL-aware).

**Formula-family `INV-*` routing (the 12 v1.5–v1.7 invariants → their covering `AC-*` rows, making `AC-MAP-TOTAL` enumerable):** `INV-FORMULA-DERIVED` → `AC-FORMULA-DERIVED` · `INV-FORMULA-ACYCLIC` → `AC-FORMULA-CYCLE` · `INV-FORMULA-INCREMENTAL` → `AC-FORMULA-INCREMENTAL` · `INV-FORMULA-REBUILD` → its own named unit blocks (`INV-FORMULA-REBUILD` in `formula/formula.test.ts` + `engine/index-engine.test.ts`, under the `AC-FORMULA-*` family) · `INV-FORMULA-VOLATILE` → `AC-FORMULA-VOLATILE` · `INV-REF-INGRID` / `INV-REF-DYNAMIC-DEP` → `AC-FORMULA-REFVAL` · `INV-SPILL-EMPTY` / `INV-SPILL-NONOVERLAP` / `INV-SPILL-ANCHOR-OWNS` → `AC-FORMULA-ARRAY-SPILL`/`-RESIZE` (unit, spill materialization) · `INV-SPILL-PROJECTION` → `AC-SPILL-GUARD` (spill-surface delta — **specced, build pending**; until the guard lands, the projection half is covered by `AC-FORMULA-ARRAY-SPILL`'s anchor-owns assertions) · `INV-INTERSECT-SCALAR` → `AC-FORMULA-INTERSECT`.

**`SUCCESS-*` demonstrations:** each maps to a `JOURNEY-*`/tier — e.g. `SUCCESS-EDIT-ROUNDTRIP`→`JOURNEY-EDIT` (edit→validate→commit→serialize→restore→undo); `SUCCESS-STYLE-API`→programmatic style + computed-style assertion; `SUCCESS-LARGE-DATA`→`PERF-SCROLL`/`-SORT`; `SUCCESS-A11Y`→a11y tier; `SUCCESS-FEATURE-TOGGLE`→the flag matrix; `SUCCESS-FRAMEWORK-AGNOSTIC`→adapter integration tests.

**Accountability rows (`n/a — why` + what was tried):**
| ID | Disposition | What was tried / residual |
|---|---|---|
| `PERSONA-DEV`/`PERSONA-USER` | **n/a** — audience definitions, no runtime behavior | traced into `JOURNEY-*`/`CAP-*` coverage instead |
| `ADR-*` | **n/a** — decisions; their *consequences* are tested via realizing contracts | e.g. `ADR-WORKER-OPS` → `AC-MSG`/`AC-WORKER-CRASH` |
| `LEGAL-NAME` (trademark clearance) | **n/a — manual** | pre-publish name/trademark check; not automatable |
| `SEC-TRUST-BOUNDARY` | **n/a — factual** | a trust-boundary statement, no runtime behavior; asserted in the Security doc, exercised indirectly by the other `SEC-*` checks |
| `LICENSE-TIER-OSS` | **n/a — factual** | single free MIT tier; no entitlement gating exists to test (the *absence* is the contract) |
| Screen-reader announcement fidelity | **partial** | automated live-region content assertions cover eligibility/politeness; full NVDA/JAWS/VoiceOver behavior = **manual smoke** (documented) |
| `forced-colors` rendering | **partial** | emulate `forced-colors` media in E2E for borders/focus; OS-level high-contrast fidelity = manual smoke |

Silent omission of an in-scope testable ID fails the gate; the tables above make the map total.

### Feature-flag matrix
Every capability tested **ON** (works) and **OFF** (no affordance, tree-shakeable, no cost). Full cross-product is infeasible → a **representative pairwise matrix** over interacting features: freeze×sort · merge×edit · merge×delete-row · group×scroll · RTL×selection · conditional-format×scroll(virtualization) · filter×edit · undo×structural-op · clipboard×validation · touch×multi-range · *(v1.3)* pin×scroll · hide×sort · multi-range-select×clipboard · header-bands×freeze · autofit×wrap · header-menu×RTL · *(v1.4)* custom-menu-builder×feature-flags (a flag-off built-in auto-hides) · menu×clipboard (built-in-by-`command`). Each pair tested with both on, and each feature toggled off in isolation.

### Quality bars & gates
- **Coverage gate:** (a) **every in-scope testable ID** has a mapped, passing test at unit, integration, **or** E2E; (b) **all tiers green**. **No line-% floor** — but **aim for 100% ID coverage**; any ID that cannot attain coverage records an **accountability row** (why + what was tried). Silent omission fails the gate.
- **Flake / re-run policy (confirmed):** zero retries, no quarantine for functional tiers; a red run → investigate → re-run whole; an investigated genuine transient is **recorded (incident + both runs)**, never quarantined. Measurement-tier re-runs co-defined with Performance.
- **Required per slice:** the touched capability's real-flow E2E + affected unit/component + axe (touched surface) + perf budget not regressed (Delivery DoD references this).

### Test-data strategy
- **Synthetic, deterministic seeded generators** producing up to 1M rows; fixtures for merged/frozen/grouped layouts, variable row heights (wrap), locale + RTL, validation/edge cases, and duplicate-key/rebind scenarios.
- Fakes for the optional xlsx lib; a mock-crash harness for the worker (`AC-WORKER-CRASH`).

### Test-stage / fidelity mapping
- **Pure logic** → Node/Vitest, fast. **Anything touching real layout/virtualization/scroll/worker** → **real browser** (Playwright / Vitest browser mode) — jsdom can't render real layout (confirmed). Perf/a11y/security E2E → real Chromium on the reference machine.

### Manual / exploratory
- The **kitchen-sink demo page** (Delivery slice 12) is the **manual-exploratory + real-flow E2E harness surface** — `E2E-STANDARD` journeys run against it; it exercises every `CAP-*` (capability showcase, `SUCCESS-DX`).
- Cross-browser (Safari/Firefox) + **touch/tablet** smoke; **screen-reader smoke** (NVDA/JAWS/VoiceOver) for the announcement residual; forced-colors visual check.
- **Docs checks:** README/getting-started example + TypeDoc API reference build clean; **docs code examples typecheck/compile** (a stale example is a failing check).

## Open Questions
- None blocking Contract-grade. (Built-in `FilterPredicate` operator set is an Interfaces open item, not a Quality gap.)

## Dependencies & Cross-references
- **Traces:** `CAP-*`/`SUCCESS-*` (P&R), `INV-*` (Domain), `LIB-*`/`EVT-*`/`MSG-*`/`ERR-*` (Interfaces), `SEC-*` (Security), `A11Y-*` (Accessibility), `COMPONENT-*`/`PATTERN-*` (Architecture).
- **Consumes as pass/fail targets:** `PERF-*` over `SEQ-*` (Performance); the v1.1 hot-path guard contracts (`PERF-CELL-PATH`/`PERF-FRAME-STEADY`/`SCALE-*`) via the micro-benchmark tier + `AC-PERF-BENCH`.
- **Referenced by:** Delivery (DoD → `E2E-STANDARD` + coverage gate).

## Examples / Worked scenarios
- *Invariant:* `INV-MERGE-NONOVERLAP` → a unit test asserting an overlapping merge is rejected.
- *Security liveness:* set a cell to `"<img src=x onerror=…>"`; E2E asserts no execution **in the page** (`SEC-ESCAPE-DEFAULT`).
- *Flag matrix:* `merge×edit` — with both on, editing a merged region edits the anchor; with merge off, the merge API is absent.

## Design Decisions
| Decision | Rationale |
|---|---|
| Coverage map over every in-scope ID; aim 100%; accountability rows for gaps | Makes "tested?" objective; the `n/a — why + what-was-tried` row keeps the map total without theater. |
| No line-% floor | Percentages reward the wrong thing; ID coverage + green CI is the real gate (operator-chosen). |
| DOM-driven real-browser E2E as the real-flow standard | Enabled by virtualized-DOM; jsdom can't render layout. |
| Visual-regression excluded; computed-style assertions | Deterministic, avoids flake tension with zero-retry. |
| Feature-flag ON/OFF pairwise matrix | The breadth of toggles is the biggest combinatorial risk. |

## Contracts
The **coverage map** (with accountability rows), the **`E2E-STANDARD`**, the **feature-flag matrix**, and the **quality gates + flake policy** above are the contracts. Per-element forcings live in the Interfaces `ERR-*` catalog (single-sourced).

## Acceptance criteria
- **AC-MAP-TOTAL:** every in-scope testable ID resolves to a passing test or an accountability row; a missing/omitted ID fails CI.
- **AC-FLAGS:** each capability passes ON and OFF; the pairwise matrix is green.
- **AC-REALFLOW:** every `JOURNEY-*` runs against the real DOM + real worker, operating every `SCREEN-GRID`/layer control, asserting non-error outcomes.
- **AC-SEC-LIVE:** the XSS-in-cell check is page-governed (no execution in the page), not harness-eval.
- **AC-FLAKE:** CI runs with zero retries; a transient is recorded (incident + both runs), never quarantined.
- **AC-FORMULA:** *(v1.5)* the formula acceptance criteria hold, each at its tier — **AC-FORMULA-EVAL** (`=SUM(A1:A3)+B1*2` arithmetic + the seven error codes + `IFERROR` trap; unit), **AC-FORMULA-CHAIN** (editing `A2` propagates to every downstream `B*` incrementally; E2E), **AC-FORMULA-CYCLE** (`A1=B1, B1=A1` → `#CIRC!` on both, no hang; unit), **AC-FORMULA-DERIVED** (sort/filter by a formula column use computed values, the cell editor shows the formula string, CSV export emits the result; E2E), **AC-FORMULA-INCREMENTAL** (an edit with K transitive dependents recomputes K cells — instrumented count — not all N; unit), **AC-FORMULA-NEUTRAL** (the Part-2 baseline benches re-run with the module present show **no regression** on existing hot paths — `PERF-FORMULA-NEUTRAL`), **AC-FORMULA-DEMO** (a demo mounts **≥ 300,000** chained formula cells and reports full + incremental recalc timings). Gated by the `formula` flag (default off); `FORMULA_DISABLED` is **reserved** — a formula API called with the flag off degrades gracefully (`getCellFormula` → `undefined`, `recalculate` → zeroed summary) rather than throwing.
- **AC-FORMULA-V16:** *(v1.6, built — slices 42–45)* the v1.6 catalog & advanced-capability acceptance criteria hold, each at its tier — **AC-FORMULA-CATALOG** (every "pure"-tagged function in `docs/formula-functions.md` has a **unit** test asserting a known input→output; the `*IFS` family matches Excel multi-criteria results — the full 455-function catalog is verified by **unit tests**), **AC-FORMULA-VOLATILE** (editing an unrelated cell re-rolls every `RAND` + re-evaluates `NOW`/`TODAY`, a non-volatile non-dependent cell untouched; unit), **AC-FORMULA-REFVAL** (`SUM(OFFSET(A1,0,0,3,1))=SUM(A1:A3)`, `INDIRECT("A"&2)=A2`, an OFFSET/INDIRECT formula flagged volatile; unit), and the spill trio — **AC-FORMULA-ARRAY-SPILL** (`=SEQUENCE(3)` in empty `A1` spills `A1:A3`; a value in `A2` → `#SPILL!`; clearing `A2` re-spills; editing a spill cell blocked/redirected), **AC-FORMULA-ARRAY-RESIZE** (`=FILTER(A1:A9,B1:B9>0)` grows/shrinks its spill, `A1#` references the current range), **AC-FORMULA-ARRAY-DERIVED** (spilled values sort/filter/export as their projected values, extends `INV-FORMULA-DERIVED`) — where **spill is covered by component + E2E** (materialize/collide/resize + the derived pipeline). Built and asserted (slices 42–45).
- **AC-SPILL-SURFACE:** *(v1.6 delta — the spill event + outline + edit-guard; **specced, build pending** — the engine substrate is built, the host-facing surface is not)* the host-facing spill contracts hold, each at its tier —
  - **AC-SPILL-EVENT** (unit + component): a recalc that creates / resizes / removes a spill emits one `EVT-SPILL-CHANGE` per changed anchor with the correct **canonical positional** payload (`{anchor:{row,col}, rows, cols, blocked}`) — active `rows≥1,cols≥1,blocked:false`; a blocked (`#SPILL!`) anchor → `blocked:true` with the attempted extent; a cleared anchor → `rows:0,cols:0,blocked:false`; and `EVT-AFTER-RECALC.spillChanged` is `true` exactly when ≥1 fired. `LIB-FORMULA-SPILL` (`getSpillRanges()`) returns the live ranges (`[]` when the flag is off).
  - **AC-SPILL-OUTLINE** (component + E2E): a live spill renders a `data-mg-spill` outline over its range; under an active **sort/filter** that fragments the canonical-contiguous range, an outline is drawn **per visually-contiguous run** and every projected value remains correct in its canonical cell.
  - **AC-SPILL-GUARD** (E2E): typing / F2 / pasting over a **non-anchor** spilled cell is **blocked** and selection **moves to the anchor** (which shows the array formula); the projected data is unchanged.
- **AC-CATALOG-V17:** *(v1.7 delta — catalog completion; **built**, asserted by the bucket A–D unit blocks in `formula/formula.test.ts`)* every function in buckets A–D of `formula-support.md` "v1.7" has a **unit** test asserting a known input→output — the array-return functions (`TREND`/`GROWTH`/`LINEST`/`LOGEST`, `MINVERSE`/`MUNIT`, array-`XLOOKUP`, `MODE.MULT`, `GROUPBY`/`PIVOTBY`) assert their **spilled shape + values**; `GROUPBY`/`PIVOTBY` match Excel group results; the odd-period bonds (`ODDF*`/`ODDL*`/`ACCRINT`/`PRICEMAT`/`YIELDMAT`) round-trip yield↔price. (`INFO` is **wholly ABSENT** — dropped from scope, unregistered → `#NAME?`; the earlier `INFO("release")` clause is superseded.)
- **AC-FORMULA-INTERSECT:** *(v1.7 delta — `CAP-FORMULA-INTERSECT`; unit; **built**, asserted by the `CAP-FORMULA-INTERSECT` block in `formula/formula.test.ts`)* `=@A1:A3` in row 2 = `A2`; `@` on a 1×1 is identity; `@` on a non-intersecting array → `#VALUE!`; an `@`-prefixed sub-expression never spills (`INV-INTERSECT-SCALAR`).
- **AC-PERF-BENCH:** *(v1.1 optimization pass)* each item (P1–P14) records a **base benchmark before the change and a comparison after** via `vitest bench` — the benchmark is a **gate, not a stamp**: a **shipped** item shows an improvement and retains its `*.bench.ts` (guarding against future regression) with the shipped structural/behavioral condition of its guard contract asserted; a **rejected** item (P8, P7 map-reuse) records the measurement that **justified rejecting** it (in `IMPLEMENTATION.md`; no code change, no retained bench), and its guard clause is **not** asserted (`[DEFERRED]`). The bench tier runs **pre-merge on the reference machine** (not a CI gate, like E2E/perf) unless trivially cheap. Because the pass is **internal/additive**, every touched area's existing unit + E2E stay green with **output byte-identical** (no behavior regression).

