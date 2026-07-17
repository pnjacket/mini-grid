# Formula optimization pass — time/space analysis + improvements

Triggered by the worst-case profile (`PERF-RECALC-WORST`): a per-call micro-bench
across the whole function library flagged `COUNTIF`/`SUMIF`/`AVERAGEIF` as the
slowest built-ins by ~50×. This pass fixes the two root causes — a function-level
one and an engine-level one — with byte-identical output (locked by
`formula.test.ts`) and base-vs-after benches (`countif.bench.ts`,
`formula.bench.ts`). Reference machine: Ryzen 5 5600G, Node v22, headless Chromium.

## Per-call function cost (20-cell range) — `fn-bench`
| Function | Before | After | Speedup |
|---|---|---|---|
| COUNTIF | 1512 ns | **176 ns** | **8.6×** |
| SUMIF | 1604 ns | **160 ns** | **10.0×** |
| AVERAGEIF | 1903 ns | **191 ns** | **10.0×** |

Over a larger 5000-cell range the committed guard bench (`countif.bench.ts`) shows
**32.6×** (the per-cell parse cost fully dominates there, so hoisting it wins big).

## Improvement 1 — compile the criteria ONCE (`functions.ts`)
**Analysis.** `matchCriteria` re-parsed the *loop-invariant* criteria — a regex
`.exec` + `Number()` + `.trim()` — for **every cell** of the range, and
`compareValues` did two `typeRank` calls per cell.
**Fix.** `compileCriteria(criteria)` parses once and returns a per-cell predicate;
a **numeric** right-hand side takes a fast path that skips `compareValues`/`typeRank`
entirely (comparing numbers directly, blanks as `0`, and preserving Excel's
type-rank quirk that a text cell ranks above a number). Space: no per-cell
allocation (was a regex match object + coerced value per cell).

## Improvement 2 — numeric cell keys in the recalc graph (`engine.ts`)
**Analysis.** The dependency graph keyed cells by a **string** id
(`"n0 A"`). The per-reference hot path `valueAt` built that string on **every**
cell read (~10 reads/cell × 300k = 3M string allocs per recalc) plus two
`keyAt`/`columnIdAt` access calls, and every graph `Map`/`Set` stored string keys.
**Fix.** `CellId` is now a **number** — `rowIndex * 2^14 + colIndex`. `valueAt`
allocates nothing (numeric id, one `Map` probe, direct `readLiteral`);
`resolvePrecedents` drops the two access calls; and numeric `Map`/`Set` keys are
smaller + faster. Time **and** space win. Identity is by canonical position; a
structural row/col mutation still triggers a full rebuild (`INV-FORMULA-REBUILD`).

## End-to-end: worst-case demo (300k chained COUNTIF) — `formula-worst.html`
> **Historical (v1.6).** `formula-worst.html` was retargeted to chained `FORECAST.ETS` in
> v1.7 (COUNTIF is no longer the slowest built-in). Numbers below are the v1.6 record.

| Metric | Original | +compile criteria | **+numeric keys (shipped)** | Total |
|---|---|---|---|---|
| setData (scan + first recalc) | 2992 ms | 2869 ms | **2096 ms** | **−30%** |
| full recalc (`PERF-RECALC-WORST`) | 1292 ms | 1184 ms | **755 ms** | **−42% (1.7×)** |
| head edit (cascade whole graph) | 1366 ms | 1212 ms | **723 ms** | **−47% (1.9×)** |
| leaf edit (tiny subgraph) | 17 ms | 16 ms | **17 ms** | ~1× |
| engine heap (node proto) | 700 MB | 700 MB | **558 MB** | **−20%** |

## End-to-end: arithmetic demo (300k chained) — `formula-stress.html`
The numeric-key change benefits **all** recalc, not just the worst case:
| Metric | Before | After | Δ |
|---|---|---|---|
| setData | 1382 ms | **1020 ms** | −26% |
| full recalc | 454 ms | **307 ms** | −32% |
| head edit | 114 ms | **75 ms** | −34% |

## Correctness + neutrality
- Byte-identical output: 29 formula unit tests (incl. 5 new criteria tests locking
  numeric ops, text equality, the type-rank quirk, blanks-as-0) + 8 grid + 7 E2E,
  all green. 460 unit total.
- `PERF-FORMULA-NEUTRAL` still holds: only `formula/*` and the formula branches of
  `index-engine` changed; the P1–P14 hot-path guards and scroll/paste/sort/filter
  are untouched.

## Verdict
COUNTIF is **8.6× faster** per call (32.6× on large ranges); the worst-case 300k
recalc is **1.7× faster** end-to-end and uses **20% less memory**. Combined with the
opt-in isolation and incremental recalc, the formula engine is now performant enough
that the POC is a credible **real feature**.

---

## Second pass — new-catalog functions (v1.6, FORECAST.ETS + order statistics)

A time/space audit of the ~380 functions added in v1.6 flagged two real issues
(the rest are already optimal). Both fixes are **byte-identical** (locked by
`formula.test.ts`) with base-vs-after benches (`formula-fn.bench.ts`). Same
reference machine (Ryzen 5 5600G, Node v22).

| Case (bench) | Before | After | Speedup | Fix |
|---|---|---|---|---|
| `FORECAST.ETS` (n=104, m given) | 0.769 ms | 0.359 ms | **2.15×** | reuse one seasonal buffer across the 81/729-combo grid search (was allocating 2 length-n arrays per combo, all discarded) + fold the SSE into the HW pass (was a second O(n) loop) |
| `FORECAST.ETS` auto-seasonality | 0.783 ms | 0.360 ms | 2.17× | (same; `detectSeason` O(n²) is only ~1% at n=104) |
| `ETS + STAT + CONFINT` (3 fns, 1 series) | 2.32 ms | 1.06 ms | 2.18× | per-call win; the 3× no-cache overhead remains (a cross-call model cache is deferred to keep the evaluator stateless) |
| `LARGE(A1:A2000, 5)` | 0.489 ms | 0.227 ms | **2.15×** | quickselect (O(n), median-of-three) instead of a full O(n log n) sort + a redundant copy |
| `SMALL(A1:A2000, 5)` | 0.484 ms | 0.218 ms | 2.21× | (same) |

**Not changed (with rationale):**
- `MEDIAN`/`PERCENTILE.*`/`QUARTILE.*`/`AGGREGATE` still use the full sort — they need
  the whole order or an interpolated pair, so the sort isn't wasted.
- Repeated `LARGE`/`MEDIAN` calls over the *same* range still re-select/re-sort — a
  recalc-scoped range cache would fix it but needs architectural support (functions
  receive materialized values, not range identity).
- `XLOOKUP`/`XMATCH` `search_mode` ±2 (binary) still scan linearly — a real binary
  search changes duplicate-match semantics vs the current linear first-match, so it is
  **not** a byte-identical perf change; deferred as a separate correctness decision.
