# Performance baseline — BEFORE formula support

Branch `poc/formula` at the clean pre-formula state. Reference machine: AMD Ryzen 5
5600G, Debian 12, Node v22, Chromium (headless). These are the "before" numbers for
the Part-2 before/after comparison. Re-run identically after the formula feature to
prove `PERF-FORMULA-NEUTRAL` (existing paths must not regress).

## Standalone engine bench (1M rows) — `packages/core/bench/index-engine.bench.ts`
| Op | Before |
|---|---|
| row generation | 179.3 ms |
| load + index build (SEQ-MOUNT data) | 251.0 ms |
| sort 1M rows (SEQ-SORT engine) | 268.9 ms |
| filter 1M rows (SEQ-FILTER engine) | 156.3 ms |

## App-level e2e perf (demo/index.html, 1M rows) — `e2e/perf/*.mjs`
| Target | Before |
|---|---|
| PERF-SCROLL median-of-5 p95 | 16.80 ms |
| PERF-SCROLL long-frame(>33ms) median | 1 |
| PERF-NODES max live gridcells | 560 |
| PERF-MOUNT mg:mount (empty construct) | 2.30 ms |
| setData 1M (load+first paint) | 1772 ms |
| PERF-PASTE median grid.paste() (~10k cells) | 76.4 ms |

## Micro-benches (`vitest bench`) — production-case throughput
Captured verbatim in `bench-before.txt`. These are the per-item hot-path guards
(P1–P14); their `production` hz is the "before" for the neutrality comparison.
Key production-case rates:
- format-mask number:2 — see file (46.7× over naive Intl-per-call)
- apply-batch (paste column resolve) — 19,291 hz
- group-outline render — 9,324 hz
- export-rows reply — 467 hz
- aggregate top-N — 1,645 hz

Raw logs: `bench-before.txt`, `engine-bench-before.txt`, `scroll-perf-before.txt`,
`paste-perf-before.txt`.
</content>
