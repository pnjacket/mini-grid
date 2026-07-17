/**
 * `AC-PERF-BENCH` — base-vs-after guard for the `COUNTIF`/`SUMIF`/`AVERAGEIF`
 * criteria path. The `baseline` case is the pre-optimization `matchCriteria`
 * (regex `.exec` + `Number` coercion **per range cell**); the `production` case is
 * the shipped `FUNCTIONS.COUNTIF`, which compiles the loop-invariant criteria
 * ONCE and takes a numeric fast path. Output is byte-identical (locked by
 * `formula.test.ts`). One run shows the win.
 */
import { bench, describe } from 'vitest';
import { FUNCTIONS } from './functions.js';
import { compareValues, isError, type FormulaValue } from './values.js';
import type { FnContext, RangeValue } from './eval-types.js';

const R = 5000;
const range: RangeValue = {
  kind: 'range',
  values: Array.from({ length: R }, (_, i) => (i * 7) % 50),
  rows: R,
  cols: 1,
};

// Minimal FnContext — COUNTIF never touches the resolver.
const ctx: FnContext = {
  resolver: {
    currentRow: 1,
    currentCol: 1,
    now: () => new Date(0),
    getValue: () => 0,
    getRange: () => ({ kind: 'range', values: [], rows: 0, cols: 0 }),
  },
};

// --- Baseline: the pre-optimization per-cell criteria parse -----------------
function oldMatch(value: FormulaValue, criteria: FormulaValue): boolean {
  if (isError(value)) return false;
  if (typeof criteria === 'string') {
    const m = /^(>=|<=|<>|>|<|=)?(.*)$/.exec(criteria);
    const op = (m?.[1] ?? '') as string;
    const rhsText = (m?.[2] ?? '').trim();
    const rhsNum = Number(rhsText);
    const rhs: FormulaValue = rhsText !== '' && Number.isFinite(rhsNum) ? rhsNum : rhsText;
    const c = compareValues(value, rhs);
    switch (op) {
      case '>': return c > 0;
      case '<': return c < 0;
      case '>=': return c >= 0;
      case '<=': return c <= 0;
      case '<>': return c !== 0;
      default: return c === 0;
    }
  }
  return compareValues(value, criteria) === 0;
}
function baselineCountif(r: RangeValue, criteria: FormulaValue): number {
  let n = 0;
  for (const v of r.values) if (oldMatch(v, criteria)) n++;
  return n;
}

describe('COUNTIF criteria — compile-once + numeric fast path', () => {
  bench('baseline · regex parse per range cell', () => {
    baselineCountif(range, '>10');
  });
  bench('production · compiled criteria (hoisted)', () => {
    FUNCTIONS.COUNTIF!([range, '>10'], ctx);
  });
});
