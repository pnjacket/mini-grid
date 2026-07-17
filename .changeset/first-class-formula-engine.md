---
"@mini-grid/core": minor
"@mini-grid/react": minor
"@mini-grid/vue": minor
"@mini-grid/svelte": minor
---

Promote the formula engine to a first-class, fully-supported capability.

Excel-like in-cell formulas are now a first-class feature — **opt-in** via the
`formula` flag (default **off**, so a leading `=` stays literal text unless a host
enables it). Additive and behavior-neutral for existing users (`PERF-FORMULA-NEUTRAL`
holds).

- A1 references + rectangular ranges, absolute/relative addressing (stable under
  sort/filter), and structural-edit reference rewriting.
- **455 registry functions** + 8 evaluator special forms (`LET`/`LAMBDA`/`MAP`/
  `REDUCE`/`SCAN`/`BYROW`/`BYCOL`/`MAKEARRAY`) across math/trig, statistical,
  financial, date/time, text, logical, lookup/reference, information, engineering,
  and database categories (adds `SUMSQ`; documents the `AVG` alias).
- Typed error values, reference values (`OFFSET`/`INDIRECT`/`INDEX`), volatile
  recalculation, and a dynamic-array **spill** engine.
- Cycle-detecting, topologically-ordered incremental recalculation.

New public API (gated by the `formula` flag): `getCellFormula`, `recalculate`,
`parseFormula`/`evaluate`, and the `EVT-AFTER-RECALC` event.
