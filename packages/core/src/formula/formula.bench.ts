/**
 * `PERF-RECALC-FULL` / `PERF-RECALC-INCR` micro-bench (`AC-PERF-BENCH`). Measures
 * the recalc engine over a synthetic grid: a full recalc of N formula cells, a
 * head-edit cascade down a deep chain (worst case), and a leaf edit (best case,
 * the incremental win). Pure engine — no DOM/worker.
 */
import { bench, describe } from 'vitest';
import { FormulaEngine, encodeCellId } from './engine.js';
import type { GridAccess } from './engine.js';
import type { FormulaValue } from './values.js';
import { indexToColLetters, colLettersToIndex } from './references.js';

const ROWS = 20_000;
const FORMULA_COLS = 5; // 20k × 5 = 100k formula cells in the bench (demo runs 300k)

function buildGrid(): { engine: FormulaEngine; cells: FormulaValue[][] } {
  const cols = FORMULA_COLS + 1; // col A = literal base, B..F formulas
  const cells: FormulaValue[][] = Array.from({ length: ROWS }, () =>
    Array.from({ length: cols }, () => null as FormulaValue),
  );
  const access: GridAccess = {
    colCount: () => cols,
    rowCount: () => ROWS,
    columnIdAt: (ci) => (ci >= 0 && ci < cols ? indexToColLetters(ci) : undefined),
    keyAt: (ri) => (ri >= 0 && ri < ROWS ? ri : undefined),
    rowIndexOfKey: (rk) => rk as number,
    colIndexOfId: (cid) => colLettersToIndex(cid),
    readLiteral: (ci, ri) => cells[ri]?.[ci] ?? null,
    writeDisplay: (rowKey, columnId, value) => {
      (cells[rowKey as number] as FormulaValue[])[colLettersToIndex(columnId)] = value;
    },
    now: () => new Date(Date.UTC(2026, 6, 4)),
  };
  const engine = new FormulaEngine(access);
  for (let r = 0; r < ROWS; r++) {
    (cells[r] as FormulaValue[])[0] = r + 1; // literal base in column A
    // B = A*2 ; C = B+A ; D = C*1.5 ; E = D-1 ; F = running sum down the column (deep chain)
    engine.setFormula(r, 'B', 1, r, `=A${r + 1}*2`);
    engine.setFormula(r, 'C', 2, r, `=B${r + 1}+A${r + 1}`);
    engine.setFormula(r, 'D', 3, r, `=C${r + 1}*1.5`);
    engine.setFormula(r, 'E', 4, r, `=D${r + 1}-1`);
    engine.setFormula(r, 'F', 5, r, r === 0 ? `=E1` : `=F${r}+E${r + 1}`); // 20k-deep chain
  }
  return { engine, cells };
}

describe('PERF-RECALC — dependency-graph recalculation', () => {
  const { engine, cells } = buildGrid();

  bench('PERF-RECALC-FULL · full recalc of 100k formula cells', () => {
    engine.recalcAll();
  });

  bench('PERF-RECALC-INCR · leaf edit (tiny subgraph)', () => {
    // Editing A of the LAST row only touches that row's B..F + the F tail (1 cell of F).
    const r = ROWS - 1;
    (cells[r] as FormulaValue[])[0] = ((cells[r] as FormulaValue[])[0] as number) + 1;
    engine.recalcFrom([encodeCellId(r, 0)]); // col A = index 0
  });

  bench('PERF-RECALC-INCR · head edit (cascade down the 20k-deep chain)', () => {
    // Editing A of the FIRST row cascades through the whole F running-sum chain.
    (cells[0] as FormulaValue[])[0] = ((cells[0] as FormulaValue[])[0] as number) + 1;
    engine.recalcFrom([encodeCellId(0, 0)]); // col A = index 0
  });
});
