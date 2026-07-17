/**
 * `AC-PERF-BENCH` — micro-bench for the heavier new catalog functions, to quantify
 * the FORECAST.ETS grid-search cost + the order-statistic sort-per-call. Base-vs-after
 * for the perf pass (behavior must stay byte-identical).
 */
import { bench, describe } from 'vitest';
import { parseFormula } from './parser.js';
import { evaluate } from './evaluator.js';
import type { CellResolver, RangeValue } from './eval-types.js';
import { indexToColLetters } from './references.js';
import type { FormulaValue } from './values.js';

function makeResolver(cells: Record<string, FormulaValue>): CellResolver {
  return {
    currentRow: 1,
    currentCol: 1,
    now: () => new Date(Date.UTC(2026, 0, 1)),
    getValue: (ref) => cells[`${indexToColLetters(ref.col)}${ref.row + 1}`] ?? null,
    getRange: (range): RangeValue => {
      const values: FormulaValue[] = [];
      const top = Math.min(range.start.row, range.end.row);
      const bottom = Math.max(range.start.row, range.end.row);
      const left = Math.min(range.start.col, range.end.col);
      const right = Math.max(range.start.col, range.end.col);
      for (let r = top; r <= bottom; r++) {
        for (let c = left; c <= right; c++) values.push(cells[`${indexToColLetters(c)}${r + 1}`] ?? null);
      }
      return { kind: 'range', values, rows: bottom - top + 1, cols: right - left + 1 };
    },
  };
}

// --- FORECAST.ETS series: linear trend + a period-4 season, N points ---------
const N = 104;
const etsCells: Record<string, FormulaValue> = {};
const season = [0, 5, 0, -5];
for (let t = 1; t <= N; t++) {
  etsCells[`A${t}`] = t;
  etsCells[`B${t}`] = 10 + 2 * t + (season[(t - 1) % 4] as number);
}
const etsResolver = makeResolver(etsCells);
const etsAst = parseFormula(`=FORECAST.ETS(${N + 1},B1:B${N},A1:A${N},4)`); // m given
const etsAutoAst = parseFormula(`=FORECAST.ETS(${N + 1},B1:B${N},A1:A${N})`); // auto-detect (+O(n²))
const statAst = parseFormula(`=FORECAST.ETS.STAT(B1:B${N},A1:A${N},1,4)`);
const confAst = parseFormula(`=FORECAST.ETS.CONFINT(${N + 1},B1:B${N},A1:A${N},0.95,4)`);

// --- LARGE over a 2000-element range -----------------------------------------
const M = 2000;
const largeCells: Record<string, FormulaValue> = {};
for (let i = 1; i <= M; i++) largeCells[`A${i}`] = (i * 2654435761) % M;
const largeResolver = makeResolver(largeCells);
const largeAst = parseFormula(`=LARGE(A1:A${M},5)`);
const smallAst = parseFormula(`=SMALL(A1:A${M},5)`);

describe('FORECAST.ETS (grid-search cost)', () => {
  bench('FORECAST.ETS · m=4 given', () => {
    evaluate(etsAst, etsResolver);
  });
  bench('FORECAST.ETS · auto-seasonality (detectSeason O(n²))', () => {
    evaluate(etsAutoAst, etsResolver);
  });
  bench('ETS + STAT + CONFINT · 3 fns on the same series (no cache)', () => {
    evaluate(etsAst, etsResolver);
    evaluate(statAst, etsResolver);
    evaluate(confAst, etsResolver);
  });
});

describe('Order statistics (sort-per-call)', () => {
  bench('LARGE(A1:A2000, 5)', () => {
    evaluate(largeAst, largeResolver);
  });
  bench('SMALL(A1:A2000, 5)', () => {
    evaluate(smallAst, largeResolver);
  });
  const medianAst = parseFormula(`=MEDIAN(A1:A${M})`); // quickselect, not full sort
  bench('MEDIAN(A1:A2000)', () => {
    evaluate(medianAst, largeResolver);
  });
});

// --- The heaviest catalog functions (tracks the "slowest built-in") ----------
// After the root-finder pass, the heaviest are FORECAST.ETS + GROUPBY; the yield
// solvers are Newton-seeded (was fixed bisection). This block keeps those costs
// measured so the worst-case demo/PERF-RECALC-WORST target stays evidence-based.
const yieldAst = parseFormula('=YIELD(40000,45000,0.05,95,100,2,0)'); // Newton
const oddfyieldAst = parseFormula('=ODDFYIELD(40000,44000,39900,40100,0.05,95,100,2,1)');
const linestAst = parseFormula(`=LINEST(B1:B${N},A1:A${N})`);
const minverseCells: Record<string, FormulaValue> = {};
for (let r = 0; r < 12; r++) for (let c = 0; c < 12; c++) minverseCells[`${indexToColLetters(c)}${r + 1}`] = ((r * 7 + c * 13 + 1) % 11) + (r === c ? 12 : 0);
const minverseResolver = makeResolver(minverseCells);
const minverseAst = parseFormula('=MINVERSE(A1:L12)');
const groupCells: Record<string, FormulaValue> = {};
for (let i = 1; i <= 500; i++) { groupCells[`A${i}`] = ['x', 'y', 'z', 'w'][i % 4] as string; groupCells[`B${i}`] = i % 37; }
const groupResolver = makeResolver(groupCells);
const groupbyAst = parseFormula('=GROUPBY(A1:A500,B1:B500,"SUM")');
describe('Heaviest catalog functions', () => {
  bench('YIELD (Newton)', () => {
    evaluate(yieldAst, etsResolver);
  });
  bench('ODDFYIELD (Newton)', () => {
    evaluate(oddfyieldAst, etsResolver);
  });
  bench('LINEST (normal equations)', () => {
    evaluate(linestAst, etsResolver);
  });
  bench('MINVERSE 12x12 (Gaussian)', () => {
    evaluate(minverseAst, minverseResolver);
  });
  bench('GROUPBY 500 rows', () => {
    evaluate(groupbyAst, groupResolver);
  });
});
