# Performance comparison — before vs after formula support

**Question (POC part 2):** does adding Excel-like formula support slow the grid's
existing features down? **Answer: no measurable regression.** The formula engine is
behind an **opt-in** `formula` feature flag (default **off**) and lives off the
per-cell paint / sort / filter / paste hot paths, so a grid that doesn't use
formulas pays nothing. When formulas ARE used, recalculation is incremental.

Reference machine: AMD Ryzen 5 5600G, Debian 12, Node v22, headless Chromium.
Raw logs under `perf/baseline/` (before) and `perf/after/` (after).

## Part A — existing features are unchanged (`PERF-FORMULA-NEUTRAL`)

### Engine (1M rows) — `packages/core/bench/index-engine.bench.ts`
| Op | Before | After | Δ |
|---|---|---|---|
| load + index build | 251.0 ms | 244.6 ms | −2.5% (noise) |
| sort 1M rows | 268.9 ms | 267.9 ms | −0.4% |
| filter 1M rows | 156.3 ms | 159.5 ms | +2.0% (noise) |

### App-level e2e (1M-row demo) — `e2e/perf/*.mjs`
| Target | Before | After | Δ |
|---|---|---|---|
| PERF-SCROLL median-of-5 p95 | 16.80 ms | 16.80 ms | 0% |
| PERF-SCROLL long-frame(>33ms) median | 1 | 1 | 0 |
| PERF-NODES max live gridcells | 560 | 560 | 0 |
| PERF-PASTE median grid.paste() (~10k cells) | 76.4 ms | 70.9 ms | −7% (noise) |

### Hot-path micro-benches (`vitest bench`, P1–P14 guards)
Every optimization guard's speedup is preserved within noise — e.g. P1
formatValue **46.7× → 47.0×**, P3 column lookup **7.97× → 7.74×**, P11 top-N
**58.8× → 58.2×**, P13 paste apply **5.54× → 5.25×**. No guard regressed.

**Conclusion:** the existing sort/filter/scroll/paste/format paths are byte- and
speed-identical with the formula module present (unused). The differences are all
within run-to-run noise; none exceeds the P-item guard thresholds.

## Part B — new capability cost (`PERF-RECALC-*`)

The formula engine's own cost, measured two ways.

### App-level (300,000 chained formula cells) — `e2e/perf/formula-perf.mjs`
50,000 rows × 6 formula columns = **300,000 interacting formula cells**, including a
single **50,000-deep** running-sum dependency chain (column G).

| Metric | Value |
|---|---|
| Row generation | 20.9 ms |
| setData (load scan + first full recalc of 300k cells) | 1382 ms |
| **PERF-RECALC-FULL** — clean full recalc of 300k cells | **454 ms** |
| **PERF-RECALC-INCR** — head edit (cascades the 50k-deep chain, ~50k cells) | **114 ms** |
| **PERF-RECALC-INCR** — leaf edit (tiny subgraph) | **17 ms** |

The leaf edit (17 ms, incl. async grid refresh + DOM repaint) vs the head edit
(114 ms) demonstrates `INV-FORMULA-INCREMENTAL`: a single edit recomputes only its
transitive dependents, not the whole sheet.

### Pure recalc micro-bench (`formula/formula.bench.ts`, 100k cells, no DOM)
| Case | Result |
|---|---|
| Full recalc, 100k cells | ~199 ms (5.0 ops/s) |
| Head edit (cascade 20k-deep chain) | ~49 ms |
| **Leaf edit (tiny subgraph)** | **~0.003 ms** — **64,507× faster than full recalc**, **15,996× faster than the head cascade** |

Stripped of the grid refresh, the incremental win is stark: a leaf edit is **3
microseconds** because the dirty-subgraph BFS + topological recompute touch only
the handful of cells that actually depend on the edited cell.

### Worst case (`PERF-RECALC-WORST`) — 300k chained COUNTIF — `demo/formula-worst.html`
> **Historical (v1.6).** As of v1.7 the slowest built-in is no longer `COUNTIF` — the
> larger catalog (bonds, regression, `FORECAST.ETS`, …) is far heavier, so
> `formula-worst.html` was **retargeted to chained `FORECAST.ETS`** (~967 ms / ~12k cells;
> see `docs/formula-support.md` `PERF-RECALC-WORST`). The COUNTIF numbers below remain the
> accurate record of the v1.6 pass.

A per-call micro-bench over the whole library found the **slowest built-in** is
`COUNTIF` (with `SUMIF`/`AVERAGEIF`): ~**1638 ns/call** over a 20-cell range vs
~30–100 ns for arithmetic/lookup — **~50×** — because `matchCriteria` runs a regex
`.exec` **per range cell**. The worst-case demo makes every one of 300,000 cells a
`COUNTIF` over a sliding window, chained vertically (criteria → cell above) **and**
cross-linked horizontally (each column adds the column to its left), so a single
edit to `A1` forces a recompute of the **entire** graph.

| Metric | Arithmetic (300k) | **Worst case: COUNTIF (300k)** | Ratio |
|---|---|---|---|
| setData (scan + first recalc) | 1382 ms | 2992 ms | 2.2× |
| full recalc (`PERF-RECALC-*`) | 454 ms | **1292 ms** | **2.8×** |
| head edit (cascade) | 114 ms (50k-deep chain) | **1366 ms** (whole cross-linked graph) | **12×** |
| leaf edit (tiny subgraph) | 17 ms | **16.8 ms** | ~1× |

Two things stand out: (1) the slowest function chained 300k-deep costs ~1.3 s to
recompute in full and ~1.4 s when one upstream edit invalidates the entire graph —
the true worst case; (2) **the incremental win survives the worst function** — a
leaf edit is still ~17 ms because the dirty-subgraph recalc isolates it regardless
of how expensive each cell is. Per-call function costs (20-cell range): COUNTIF 1638
ns, SUMIF 1608, AVERAGEIF 1463, VLOOKUP(exact) 180, SUMPRODUCT 137, SUM 106,
VLOOKUP(approx) 82, MATCH 33, INDEX 28.

## Takeaway

Formula support is **additive and isolated**: opt-in, off the existing hot paths,
and incrementally recalculated. A grid without formulas is unaffected; a grid with
300k chained formulas recalculates the full graph in ~0.45 s and a typical edit in
microseconds-to-milliseconds.
