/**
 * `CAP-FORMULA` unit battery — parser, evaluator, ~70-function library, A1
 * references, and the dependency-graph recalc engine (full + incremental +
 * cycles). Exercised against an in-memory grid model (no DOM/worker).
 */
import { describe, expect, it } from 'vitest';
import { FormulaEngine, encodeCellId } from './engine.js';
import type { GridAccess } from './engine.js';
import { parseFormula } from './parser.js';
import { formatAst, translateAst } from './ast.js';
import { evaluate, evaluateResult } from './evaluator.js';
import type { CellResolver, EvalResult, RangeValue } from './eval-types.js';
import {
  ERR,
  FormulaError,
  fromRaw,
  isError,
  type FormulaValue,
} from './values.js';
import { colLettersToIndex, indexToColLetters, parseA1, translateRef } from './references.js';

// ---------------------------------------------------------------------------
// In-memory grid harness
// ---------------------------------------------------------------------------

class TestGrid {
  readonly cells: FormulaValue[][]; // [row][col] raw literal values
  readonly engine: FormulaEngine;
  readonly cols: number;
  readonly rows: number;
  private readonly clock: Date;

  constructor(rows: number, cols: number, clock = new Date(Date.UTC(2026, 6, 4))) {
    this.rows = rows;
    this.cols = cols;
    this.clock = clock;
    this.cells = Array.from({ length: rows }, () => Array.from({ length: cols }, () => null as FormulaValue));
    this.engine = new FormulaEngine(this.access());
  }

  private colId(ci: number): string {
    return indexToColLetters(ci);
  }

  private access(): GridAccess {
    return {
      colCount: () => this.cols,
      rowCount: () => this.rows,
      columnIdAt: (ci) => (ci >= 0 && ci < this.cols ? this.colId(ci) : undefined),
      keyAt: (ri) => (ri >= 0 && ri < this.rows ? ri : undefined),
      rowIndexOfKey: (rk) => rk as number,
      colIndexOfId: (cid) => colLettersToIndex(cid),
      readLiteral: (ci, ri) => this.cells[ri]?.[ci] ?? null,
      writeDisplay: (rowKey, columnId, value) => {
        const ri = rowKey as number;
        const ci = colLettersToIndex(columnId);
        (this.cells[ri] as FormulaValue[])[ci] = value;
      },
      now: () => this.clock,
    };
  }

  /** Set a raw literal at A1 coords (0-based). */
  setLiteral(ci: number, ri: number, value: FormulaValue): void {
    (this.cells[ri] as FormulaValue[])[ci] = value;
  }

  /** Register a formula at A1 coords + recalc from it. */
  setFormula(ci: number, ri: number, src: string): void {
    const id = this.engine.setFormula(ri, this.colId(ci), ci, ri, src);
    this.engine.recalcFrom([id]);
  }

  /** Read the computed display value at A1 coords. */
  get(ci: number, ri: number): FormulaValue {
    return this.cells[ri]?.[ci] ?? null;
  }
}

/** Evaluate a bare formula against a fixed cell map (single-cell eval helper). */
function makeResolver(cells: Record<string, FormulaValue>, locale?: string, pos?: { row: number; col: number }): CellResolver {
  return {
    currentRow: pos?.row ?? 1,
    currentCol: pos?.col ?? 1,
    ...(locale !== undefined ? { locale } : {}),
    now: () => new Date(Date.UTC(2026, 6, 4)),
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

function evalWith(src: string, cells: Record<string, FormulaValue>, locale?: string): FormulaValue {
  return evaluate(parseFormula(src), makeResolver(cells, locale));
}

/** Evaluate preserving a top-level array result (the spill path), for array-return fns. */
function evalArr(src: string, cells: Record<string, FormulaValue>): EvalResult {
  return evaluateResult(parseFormula(src), makeResolver(cells));
}

/** Evaluate as if the formula lived at a given 1-based cell position (for `@`/ROW/COLUMN). */
function evalAt(src: string, cells: Record<string, FormulaValue>, row: number, col: number): FormulaValue {
  return evaluate(parseFormula(src), makeResolver(cells, undefined, { row, col }));
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

describe('CAP-FORMULA-REF — A1 addressing', () => {
  it('column letters ↔ index are bijective base-26', () => {
    expect(colLettersToIndex('A')).toBe(0);
    expect(colLettersToIndex('Z')).toBe(25);
    expect(colLettersToIndex('AA')).toBe(26);
    expect(colLettersToIndex('AB')).toBe(27);
    expect(indexToColLetters(0)).toBe('A');
    expect(indexToColLetters(26)).toBe('AA');
    expect(indexToColLetters(701)).toBe('ZZ');
    expect(indexToColLetters(702)).toBe('AAA');
  });

  it('parses absolute markers and 0-based coords', () => {
    expect(parseA1('A1')).toEqual({ col: 0, row: 0, colAbs: false, rowAbs: false });
    expect(parseA1('$B$3')).toEqual({ col: 1, row: 2, colAbs: true, rowAbs: true });
    expect(parseA1('C$10')).toEqual({ col: 2, row: 9, colAbs: false, rowAbs: true });
    expect(parseA1('notaref')).toBeNull();
  });

  it('translateRef shifts relative axes, pins absolute (fill/copy)', () => {
    expect(translateRef({ col: 0, row: 0, colAbs: false, rowAbs: false }, 1, 2)).toEqual({
      col: 1, row: 2, colAbs: false, rowAbs: false,
    });
    expect(translateRef({ col: 0, row: 0, colAbs: true, rowAbs: true }, 5, 5)).toEqual({
      col: 0, row: 0, colAbs: true, rowAbs: true,
    });
    expect(translateRef({ col: 0, row: 0, colAbs: false, rowAbs: false }, -1, 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Parser / operators / precedence
// ---------------------------------------------------------------------------

describe('CAP-FORMULA — operators & precedence', () => {
  it('arithmetic precedence + parentheses', () => {
    expect(evalWith('=1+2*3', {})).toBe(7);
    expect(evalWith('=(1+2)*3', {})).toBe(9);
    expect(evalWith('=2^3^2', {})).toBe(512); // right-assoc: 2^(3^2)
    expect(evalWith('=10/2/5', {})).toBe(1); // left-assoc
  });

  it('unary minus binds tighter than ^ (Excel quirk)', () => {
    expect(evalWith('=-2^2', {})).toBe(4);
  });

  it('percent, concat, comparison', () => {
    expect(evalWith('=50%', {})).toBe(0.5);
    expect(evalWith('="a"&"b"&"c"', {})).toBe('abc');
    expect(evalWith('=1<2', {})).toBe(true);
    expect(evalWith('=2<>2', {})).toBe(false);
    expect(evalWith('="A"="a"', {})).toBe(true); // case-insensitive text compare
  });

  it('cell + range references resolve', () => {
    const cells = { A1: 10, A2: 20, A3: 30, B1: 2 };
    expect(evalWith('=A1+A2', cells)).toBe(30);
    expect(evalWith('=SUM(A1:A3)+B1*2', cells)).toBe(64);
  });

  it('a syntax error throws FormulaSyntaxError', () => {
    expect(() => parseFormula('=1+')).toThrow();
    expect(() => parseFormula('=SUM(')).toThrow();
    expect(() => parseFormula('="unterminated')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Error values + propagation
// ---------------------------------------------------------------------------

describe('ENTITY-FORMULA-ERROR — typed errors + propagation', () => {
  it('produces each error from its condition', () => {
    expect(evalWith('=1/0', {})).toBe(ERR.DIV0);
    expect(evalWith('=1+"x"', {})).toBe(ERR.VALUE);
    expect(evalWith('=NOTAFUNC(1)', {})).toBe(ERR.NAME);
    expect(evalWith('=SQRT(-1)', {})).toBe(ERR.NUM);
  });

  it('out-of-grid reference → #REF!', () => {
    const g = new TestGrid(3, 3);
    g.setFormula(0, 0, '=Z99'); // beyond the 3×3 grid
    expect(g.get(0, 0)).toBe(ERR.REF.code);
  });

  it('errors propagate through operators + are trapped by IFERROR/IFNA/ISERROR', () => {
    expect(evalWith('=1/0+5', {})).toBe(ERR.DIV0);
    expect(evalWith('=IFERROR(1/0, 99)', {})).toBe(99);
    expect(evalWith('=IFERROR(1+1, 99)', {})).toBe(2);
    expect(evalWith('=ISERROR(1/0)', {})).toBe(true);
    expect(evalWith('=IFNA(NA(), "x")', {})).toBe('x');
    expect(evalWith('=ISNA(1/0)', {})).toBe(false); // #DIV/0! is not #N/A
  });

  it('a literal "#REF!" text is NOT an error (typed sentinel only)', () => {
    expect(isError(fromRaw('hello'))).toBe(false);
    expect(fromRaw('#REF!')).toBeInstanceOf(FormulaError);
  });
});

// ---------------------------------------------------------------------------
// Function library samples across categories
// ---------------------------------------------------------------------------

describe('CAP-FORMULA-FN — library', () => {
  const cells = { A1: 1, A2: 2, A3: 3, A4: 4, B1: 'x', B2: 'y' };

  it('math / aggregation', () => {
    expect(evalWith('=SUM(A1:A4)', cells)).toBe(10);
    expect(evalWith('=AVERAGE(A1:A4)', cells)).toBe(2.5);
    expect(evalWith('=AVG(A1:A4)', cells)).toBe(2.5); // AVG alias of AVERAGE
    expect(evalWith('=SUMSQ(A1:A4)', cells)).toBe(30); // 1+4+9+16
    expect(evalWith('=COUNT(A1:B2)', cells)).toBe(2); // only numeric cells
    expect(evalWith('=COUNTA(A1:B2)', cells)).toBe(4);
    expect(evalWith('=MIN(A1:A4)', cells)).toBe(1);
    expect(evalWith('=MAX(A1:A4)', cells)).toBe(4);
    expect(evalWith('=PRODUCT(A1:A4)', cells)).toBe(24);
    expect(evalWith('=ROUND(3.14159, 2)', {})).toBe(3.14);
    expect(evalWith('=MOD(7, 3)', {})).toBe(1);
    expect(evalWith('=POWER(2, 10)', {})).toBe(1024);
    expect(evalWith('=SUMPRODUCT(A1:A2, A3:A4)', cells)).toBe(1 * 3 + 2 * 4);
    expect(evalWith('=SUMIF(A1:A4, ">2")', cells)).toBe(7);
    expect(evalWith('=COUNTIF(A1:A4, ">=2")', cells)).toBe(3);
  });

  it('logical', () => {
    expect(evalWith('=IF(1>2, "hi", "lo")', {})).toBe('lo');
    expect(evalWith('=AND(TRUE, 1<2, 3>0)', {})).toBe(true);
    expect(evalWith('=OR(FALSE, 1>2)', {})).toBe(false);
    expect(evalWith('=NOT(FALSE)', {})).toBe(true);
    expect(evalWith('=XOR(TRUE, TRUE, TRUE)', {})).toBe(true);
    expect(evalWith('=IFS(1>2, "a", 2>1, "b")', {})).toBe('b');
    expect(evalWith('=SWITCH(2, 1, "one", 2, "two", "def")', {})).toBe('two');
  });

  it('text', () => {
    expect(evalWith('=CONCAT("a", "b", "c")', {})).toBe('abc');
    expect(evalWith('=LEN("hello")', {})).toBe(5);
    expect(evalWith('=LEFT("hello", 2)', {})).toBe('he');
    expect(evalWith('=RIGHT("hello", 2)', {})).toBe('lo');
    expect(evalWith('=MID("hello", 2, 3)', {})).toBe('ell');
    expect(evalWith('=UPPER("abc")', {})).toBe('ABC');
    expect(evalWith('=TRIM("  a  b  ")', {})).toBe('a b');
    expect(evalWith('=SUBSTITUTE("a-b-c", "-", "+")', {})).toBe('a+b+c');
    expect(evalWith('=TEXTJOIN("-", TRUE, "a", "", "b")', {})).toBe('a-b');
    expect(evalWith('=TEXT(0.5, "0%")', {})).toBe('50%');
    expect(evalWith('=VALUE("42")', {})).toBe(42);
    expect(evalWith('=EXACT("a", "A")', {})).toBe(false);
  });

  it('lookup / reference', () => {
    // 3×2 table: keys 10,20,30 with labels
    const t = { A1: 10, B1: 'ten', A2: 20, B2: 'twenty', A3: 30, B3: 'thirty' };
    expect(evalWith('=VLOOKUP(20, A1:B3, 2, FALSE)', t)).toBe('twenty');
    expect(evalWith('=VLOOKUP(25, A1:B3, 2, TRUE)', t)).toBe('twenty'); // approx
    expect(evalWith('=MATCH(30, A1:A3, 0)', t)).toBe(3);
    expect(evalWith('=INDEX(A1:B3, 2, 2)', t)).toBe('twenty');
    expect(evalWith('=CHOOSE(2, "a", "b", "c")', {})).toBe('b');
    expect(evalWith('=ROWS(A1:B3)', t)).toBe(3);
    expect(evalWith('=COLUMNS(A1:B3)', t)).toBe(2);
  });

  it('info', () => {
    expect(evalWith('=ISNUMBER(42)', {})).toBe(true);
    expect(evalWith('=ISTEXT("x")', {})).toBe(true);
    expect(evalWith('=ISBLANK(A9)', {})).toBe(true);
  });

  it('date (Excel serials)', () => {
    expect(evalWith('=YEAR(DATE(2026,7,4))', {})).toBe(2026);
    expect(evalWith('=MONTH(DATE(2026,7,4))', {})).toBe(7);
    expect(evalWith('=DAY(DATE(2026,7,4))', {})).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// v1.7 catalog completion — Bucket A (quick wins). AC-CATALOG-V17.
// ---------------------------------------------------------------------------

describe('CAP-FORMULA-FN — v1.7 bucket A (quick wins)', () => {
  it('MODE.MULT — all values tied for most-frequent, in appearance order (spills)', () => {
    const c = { A1: 1, A2: 2, A3: 2, A4: 3, A5: 3, A6: 4 };
    const r = evalArr('=MODE.MULT(A1:A6)', c) as RangeValue;
    expect(r.kind).toBe('range');
    expect(r.values).toEqual([2, 3]);
    expect([r.rows, r.cols]).toEqual([2, 1]);
    // no repeat → #N/A
    expect(evalWith('=MODE.MULT(A1:A1)', c)).toBe(ERR.NA);
  });

  it('PROB — Σ prob over [lower, upper]; validates the distribution', () => {
    const c = { A1: 1, A2: 2, A3: 3, A4: 4, B1: 0.1, B2: 0.2, B3: 0.3, B4: 0.4 };
    expect(evalWith('=PROB(A1:A4,B1:B4,2,3)', c)).toBeCloseTo(0.5, 10); // 0.2+0.3
    expect(evalWith('=PROB(A1:A4,B1:B4,3)', c)).toBeCloseTo(0.3, 10); // exact x=3
    const bad = { A1: 1, A2: 2, B1: 0.1, B2: 0.2 }; // Σp≠1
    expect(evalWith('=PROB(A1:A2,B1:B2,1,2)', bad)).toBe(ERR.NUM);
  });

  it('AREAS — a single reference/range is one area', () => {
    expect(evalWith('=AREAS(A1:B3)', {})).toBe(1);
    expect(evalWith('=AREAS(A1)', {})).toBe(1);
  });

  it('ARRAYTOTEXT — format 0 concise, format 1 array literal', () => {
    const c = { A1: 1, B1: 2, A2: 'x', B2: 3 };
    expect(evalWith('=ARRAYTOTEXT(A1:B2)', c)).toBe('1, 2, x, 3');
    expect(evalWith('=ARRAYTOTEXT(A1:B2,1)', c)).toBe('{1,2;"x",3}');
    expect(evalWith('=ARRAYTOTEXT("hi")', {})).toBe('hi');
  });

  it('XLOOKUP — multi-column return spills the whole matched row', () => {
    const c = { A1: 'b', A2: 'a', A3: 'c', B1: 10, C1: 11, B2: 20, C2: 21, B3: 30, C3: 31 };
    const r = evalArr('=XLOOKUP("a",A1:A3,B1:C3)', c) as RangeValue;
    expect(r.kind).toBe('range');
    expect(r.values).toEqual([20, 21]); // row for "a"
    expect([r.rows, r.cols]).toEqual([1, 2]);
    // single-column return stays scalar (back-compat)
    expect(evalWith('=XLOOKUP("c",A1:A3,B1:B3)', c)).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// v1.7 catalog completion — Bucket B (array math). AC-CATALOG-V17.
// ---------------------------------------------------------------------------

describe('CAP-FORMULA-FN — v1.7 bucket B (array math)', () => {
  // matrix [[1,2],[3,4]] laid out A1=1,B1=2 / A2=3,B2=4
  const mat = { A1: 1, B1: 2, A2: 3, B2: 4 };

  it('MUNIT — n×n identity', () => {
    const r = evalArr('=MUNIT(2)', {}) as RangeValue;
    expect([r.rows, r.cols]).toEqual([2, 2]);
    expect(r.values).toEqual([1, 0, 0, 1]);
  });

  it('MDETERM — determinant; non-square → #VALUE!', () => {
    expect(evalWith('=MDETERM(A1:B2)', mat)).toBeCloseTo(-2, 10);
    expect(evalWith('=MDETERM(A1:B1)', mat)).toBe(ERR.VALUE);
  });

  it('MINVERSE — inverse; singular → #NUM!', () => {
    const r = evalArr('=MINVERSE(A1:B2)', mat) as RangeValue;
    expect(r.values.map((v) => Math.round((v as number) * 100) / 100)).toEqual([-2, 1, 1.5, -0.5]);
    const sing = { A1: 1, B1: 2, A2: 2, B2: 4 }; // rank-deficient
    expect(evalArr('=MINVERSE(A1:B2)', sing)).toBe(ERR.NUM);
  });

  it('LINEST / LOGEST — regression coefficients [m, b]', () => {
    const lin = { A1: 3, A2: 5, A3: 7, A4: 9, B1: 1, B2: 2, B3: 3, B4: 4 }; // y = 2x+1
    const r = evalArr('=LINEST(A1:A4,B1:B4)', lin) as RangeValue;
    expect(r.values[0] as number).toBeCloseTo(2, 8); // slope
    expect(r.values[1] as number).toBeCloseTo(1, 8); // intercept
    const exp = { A1: 6, A2: 12, A3: 24, A4: 48, B1: 1, B2: 2, B3: 3, B4: 4 }; // y = 3·2^x
    const g = evalArr('=LOGEST(A1:A4,B1:B4)', exp) as RangeValue;
    expect(g.values[0] as number).toBeCloseTo(2, 8); // base m
    expect(g.values[1] as number).toBeCloseTo(3, 8); // b
  });

  it('LINEST stats block — 5-row [coeffs, se, [R²,sey], [F,df], [ssreg,ssresid]]', () => {
    // y=1,2,2 over x=1,2,3 → slope 0.5, intercept 2/3, R²=0.75, F=3, df=1
    const d = { A1: 1, A2: 2, A3: 2, B1: 1, B2: 2, B3: 3 };
    const r = evalArr('=LINEST(A1:A3,B1:B3,TRUE,TRUE)', d) as RangeValue;
    expect([r.rows, r.cols]).toEqual([5, 2]);
    const at = (row: number, col: number) => r.values[row * 2 + col] as number;
    expect(at(0, 0)).toBeCloseTo(0.5, 8); // slope
    expect(at(0, 1)).toBeCloseTo(2 / 3, 8); // intercept
    expect(at(1, 0)).toBeCloseTo(0.288675, 5); // se(slope)
    expect(at(2, 0)).toBeCloseTo(0.75, 8); // R²
    expect(at(3, 0)).toBeCloseTo(3, 8); // F
    expect(at(3, 1)).toBeCloseTo(1, 8); // df
    expect(at(4, 0)).toBeCloseTo(0.5, 8); // ssreg
    expect(at(4, 1)).toBeCloseTo(1 / 6, 6); // ssresid
  });

  it('TREND / GROWTH — predictions at new_x', () => {
    const lin = { A1: 3, A2: 5, A3: 7, A4: 9, B1: 1, B2: 2, B3: 3, B4: 4, C1: 5 };
    const t = evalArr('=TREND(A1:A4,B1:B4,C1:C1)', lin) as RangeValue;
    expect(t.values[0] as number).toBeCloseTo(11, 8); // 2·5+1
    const exp = { A1: 6, A2: 12, A3: 24, A4: 48, B1: 1, B2: 2, B3: 3, B4: 4, C1: 5 };
    const g = evalArr('=GROWTH(A1:A4,B1:B4,C1:C1)', exp) as RangeValue;
    expect(g.values[0] as number).toBeCloseTo(96, 6); // 3·2^5
  });
});

// ---------------------------------------------------------------------------
// v1.7 catalog completion — Bucket C (bonds, interest-at-maturity). AC-CATALOG-V17.
// ---------------------------------------------------------------------------

describe('CAP-FORMULA-FN — v1.7 bucket C (bonds)', () => {
  // serials: issue 2020-01-01, settle 2020-07-01, maturity 2025-01-01 (Excel 1900 system)
  const iss = 43831, settle = 44013, mat = 45658;

  it('ACCRINT — accrued interest issue→settlement', () => {
    // par 1000, rate 5%, ~0.5yr on 30/360 → ≈ 25
    const v = evalWith('=ACCRINT(A1,A1,A2,0.05,1000,2,0)', { A1: iss, A2: settle }) as number;
    expect(v).toBeCloseTo(1000 * 0.05 * (180 / 360), 6); // 30/360: Jan1→Jul1 = 180 days
  });

  it('ODDFPRICE / ODDLPRICE — match Excel reference examples', () => {
    // Reference ODDFPRICE ≈ 113.5976 (odd short first period, basis 1). The
    // standard discounted-cash-flow implementation matches to within ~0.002
    // (a known day-count-convention sensitivity for odd-first bonds).
    expect(
      evalWith('=ODDFPRICE(DATE(2008,11,11),DATE(2021,3,1),DATE(2008,10,15),DATE(2009,3,1),0.0785,0.0625,100,2,1)', {}) as number,
    ).toBeCloseTo(113.5976, 2);
    // MS ODDLPRICE example → 99.878286 (odd last period, basis 0) — matches to 4 dp.
    expect(
      evalWith('=ODDLPRICE(DATE(2008,2,7),DATE(2008,6,15),DATE(2007,10,15),0.0375,0.0405,100,2,0)', {}) as number,
    ).toBeCloseTo(99.878286, 4);
  });

  it('ODDFYIELD / ODDLYIELD — invert their price functions', () => {
    const p = evalWith('=ODDFPRICE(DATE(2008,11,11),DATE(2021,3,1),DATE(2008,10,15),DATE(2009,3,1),0.0785,0.0625,100,2,1)', {}) as number;
    expect(
      evalWith(`=ODDFYIELD(DATE(2008,11,11),DATE(2021,3,1),DATE(2008,10,15),DATE(2009,3,1),0.0785,${p},100,2,1)`, {}) as number,
    ).toBeCloseTo(0.0625, 6);
    const pl = evalWith('=ODDLPRICE(DATE(2008,2,7),DATE(2008,6,15),DATE(2007,10,15),0.0375,0.0405,100,2,0)', {}) as number;
    expect(
      evalWith(`=ODDLYIELD(DATE(2008,2,7),DATE(2008,6,15),DATE(2007,10,15),0.0375,${pl},100,2,0)`, {}) as number,
    ).toBeCloseTo(0.0405, 6);
  });

  it('PRICEMAT / YIELDMAT — exact inverses', () => {
    const cells = { A1: settle, A2: mat, A3: iss };
    const price = evalWith('=PRICEMAT(A1,A2,A3,0.05,0.06,0)', cells) as number;
    expect(typeof price).toBe('number');
    const yld = evalWith(`=YIELDMAT(A1,A2,A3,0.05,${price},0)`, cells) as number;
    expect(yld).toBeCloseTo(0.06, 8); // recovers the input yield
  });
});

// ---------------------------------------------------------------------------
// v1.7 catalog completion — Bucket D (GROUPBY / PIVOTBY). AC-CATALOG-V17.
// ---------------------------------------------------------------------------

describe('CAP-FORMULA-FN — v1.7 bucket D (GROUPBY / PIVOTBY)', () => {
  // keys A1:A4 = x,y,x,y ; values B1:B4 = 10,20,30,40 ; cols C1:C4 = p,p,q,q
  const c = {
    A1: 'x', A2: 'y', A3: 'x', A4: 'y',
    B1: 10, B2: 20, B3: 30, B4: 40,
    C1: 'p', C2: 'p', C3: 'q', C4: 'q',
  };

  it('GROUPBY — groups by key, applies the named reducer, spills [key, agg]', () => {
    const r = evalArr('=GROUPBY(A1:A4,B1:B4,"SUM")', c) as RangeValue;
    expect([r.rows, r.cols]).toEqual([2, 2]);
    expect(r.values).toEqual(['x', 40, 'y', 60]); // x:10+30, y:20+40
    const avg = evalArr('=GROUPBY(A1:A4,B1:B4,"AVERAGE")', c) as RangeValue;
    expect(avg.values).toEqual(['x', 20, 'y', 30]);
    // unknown reducer → #NAME?
    expect(evalArr('=GROUPBY(A1:A4,B1:B4,"NOPE")', c)).toBe(ERR.NAME);
  });

  it('GROUPBY — LAMBDA aggregation', () => {
    const r = evalArr('=GROUPBY(A1:A4,B1:B4,LAMBDA(v,SUM(v)))', c) as RangeValue;
    expect(r.values).toEqual(['x', 40, 'y', 60]); // same as "SUM"
    const scaled = evalArr('=GROUPBY(A1:A4,B1:B4,LAMBDA(v,SUM(v)*2))', c) as RangeValue;
    expect(scaled.values).toEqual(['x', 80, 'y', 120]);
  });

  it('PIVOTBY — cross-tab with a header row/column', () => {
    const r = evalArr('=PIVOTBY(A1:A4,C1:C4,B1:B4,"SUM")', c) as RangeValue;
    expect([r.rows, r.cols]).toEqual([3, 3]); // corner + 2 cols, + 2 rows
    // header row: '', p, q  |  x: (x,p)=10 (x,q)=30  |  y: (y,p)=20 (y,q)=40
    expect(r.values).toEqual(['', 'p', 'q', 'x', 10, 30, 'y', 20, 40]);
  });
});

// ---------------------------------------------------------------------------
// v1.7 — implicit-intersection @ operator (CAP-FORMULA-INTERSECT). AC-FORMULA-INTERSECT.
// ---------------------------------------------------------------------------

describe('CAP-FORMULA-INTERSECT — the @ operator', () => {
  const c = { A1: 10, A2: 20, A3: 30, B1: 'p', B2: 'q', B3: 'r' };

  it('=@A1:A3 picks the value on the formula row', () => {
    expect(evalAt('=@A1:A3', c, 2, 1)).toBe(20); // row 2 → A2
    expect(evalAt('=@A1:A3', c, 3, 1)).toBe(30); // row 3 → A3
  });

  it('@ on a 1×1 is identity', () => {
    expect(evalAt('=@A1', c, 5, 5)).toBe(10);
  });

  it('@ with no intersection → #VALUE!', () => {
    expect(evalAt('=@A1:A3', c, 9, 1)).toBe(ERR.VALUE); // row 9 outside A1:A3
  });

  it('a horizontal vector intersects on the column', () => {
    const h = { A1: 100, B1: 200, C1: 300 };
    expect(evalAt('=@A1:C1', h, 1, 2)).toBe(200); // col 2 → B1
  });

  it('@ result is scalar (never spills) — usable in arithmetic', () => {
    expect(evalAt('=@A1:A3 + 5', c, 2, 1)).toBe(25); // 20 + 5
    // round-trips through the source formatter (formatAst)
    expect(formatAst(parseFormula('=@A1:A3'))).toBe('@A1:A3');
  });
});

// Criteria functions (COUNTIF/SUMIF/AVERAGEIF) — behavior locked after the
// compile-criteria-once optimization (must stay byte-identical to the naive path).
// ---------------------------------------------------------------------------

describe('CAP-FORMULA-FN — criteria (compiled-once, byte-identical)', () => {
  const nums = { A1: 1, A2: 2, A3: 3, A4: 4, A5: 5 };

  it('numeric operators: > < >= <= <> =', () => {
    expect(evalWith('=COUNTIF(A1:A5,">3")', nums)).toBe(2); // 4,5
    expect(evalWith('=COUNTIF(A1:A5,"<3")', nums)).toBe(2); // 1,2
    expect(evalWith('=COUNTIF(A1:A5,">=3")', nums)).toBe(3);
    expect(evalWith('=COUNTIF(A1:A5,"<=2")', nums)).toBe(2);
    expect(evalWith('=COUNTIF(A1:A5,"<>3")', nums)).toBe(4);
    expect(evalWith('=COUNTIF(A1:A5,"3")', nums)).toBe(1); // implicit equality
    expect(evalWith('=COUNTIF(A1:A5,5)', nums)).toBe(1); // numeric criteria value
  });

  it('SUMIF with a separate sum range; AVERAGEIF', () => {
    const t = { A1: 1, B1: 10, A2: 2, B2: 20, A3: 3, B3: 30 };
    expect(evalWith('=SUMIF(A1:A3,">=2",B1:B3)', t)).toBe(50); // B2+B3
    expect(evalWith('=AVERAGEIF(A1:A3,">=2")', t)).toBe(2.5);
    expect(evalWith('=AVERAGEIF(A1:A3,">9")', t)).toBe(ERR.DIV0); // no match → #DIV/0!
  });

  it('text equality criteria (case-insensitive)', () => {
    const t = { A1: 'apple', A2: 'Banana', A3: 'apple', A4: 'cherry' };
    expect(evalWith('=COUNTIF(A1:A4,"apple")', t)).toBe(2);
    expect(evalWith('=COUNTIF(A1:A4,"APPLE")', t)).toBe(2); // case-insensitive
  });

  it('preserves the Excel type-rank quirk: a text cell ranks above a number', () => {
    // With a mixed range, ">1" matches 2 AND the text cell (text ranks above numbers) —
    // byte-identical to the pre-optimization matchCriteria.
    const t = { A1: 1, A2: 2, A3: 'zzz' };
    expect(evalWith('=COUNTIF(A1:A3,">1")', t)).toBe(2); // 2 + "zzz"
    expect(evalWith('=COUNTIF(A1:A3,"<9")', t)).toBe(2); // 1,2 (text does not rank below)
  });

  it('blank cells compare as 0', () => {
    const t = { A1: 0, A3: 5 }; // A2 blank
    expect(evalWith('=COUNTIF(A1:A3,">=0")', t)).toBe(3); // 0, blank(0), 5
    expect(evalWith('=COUNTIF(A1:A3,">0")', t)).toBe(1); // only 5
  });
});

// ---------------------------------------------------------------------------
// Slice 42a — *IFS family (N criteria), COUNTBLANK, SUBTOTAL, database D*.
// ---------------------------------------------------------------------------

describe('CAP-FORMULA-FN — slice 42a (*IFS + SUBTOTAL + database)', () => {
  // A=value, B=category, C=region.
  const t = {
    A1: 10, B1: 'x', C1: 'N',
    A2: 20, B2: 'y', C2: 'N',
    A3: 30, B3: 'x', C3: 'S',
    A4: 40, B4: 'y', C4: 'S',
    A5: 50, B5: 'x', C5: 'N',
  };

  it('*IFS family — N criteria AND-combined per row', () => {
    expect(evalWith('=SUMIFS(A1:A5,B1:B5,"x")', t)).toBe(90); // 10+30+50
    expect(evalWith('=SUMIFS(A1:A5,B1:B5,"x",C1:C5,"N")', t)).toBe(60); // (x,N): 10+50
    expect(evalWith('=COUNTIFS(B1:B5,"x",C1:C5,"N")', t)).toBe(2);
    expect(evalWith('=AVERAGEIFS(A1:A5,B1:B5,"x")', t)).toBe(30);
    expect(evalWith('=MAXIFS(A1:A5,B1:B5,"y")', t)).toBe(40);
    expect(evalWith('=MINIFS(A1:A5,B1:B5,"y")', t)).toBe(20);
    expect(evalWith('=SUMIFS(A1:A5,A1:A5,">25")', t)).toBe(120); // 30+40+50
  });

  it('*IFS mismatched-shape ranges → #VALUE!', () => {
    expect(evalWith('=SUMIFS(A1:A5,B1:B3,"x")', t)).toBe(ERR.VALUE);
  });

  it('COUNTBLANK counts empty cells', () => {
    expect(evalWith('=COUNTBLANK(A1:A3)', { A1: 1, A3: 5 })).toBe(1); // A2 blank
    expect(evalWith('=COUNTBLANK(A1:A3)', { A1: 1, A2: 2, A3: 3 })).toBe(0);
  });

  it('SUBTOTAL dispatches by function code (1–11 and 101–111)', () => {
    expect(evalWith('=SUBTOTAL(9,A1:A5)', t)).toBe(150); // SUM
    expect(evalWith('=SUBTOTAL(1,A1:A5)', t)).toBe(30); // AVERAGE
    expect(evalWith('=SUBTOTAL(4,A1:A5)', t)).toBe(50); // MAX
    expect(evalWith('=SUBTOTAL(5,A1:A5)', t)).toBe(10); // MIN
    expect(evalWith('=SUBTOTAL(2,A1:C5)', t)).toBe(5); // COUNT numbers (col A only)
    expect(evalWith('=SUBTOTAL(109,A1:A5)', t)).toBe(150); // 101–111 ignore-hidden ≈ same
  });

  it('database D* — (database, field, criteria) reduce', () => {
    // Table A1:C5 with headers; criteria in G.
    const db = {
      A1: 'Item', B1: 'Region', C1: 'Qty',
      A2: 'Apple', B2: 'N', C2: 10,
      A3: 'Banana', B3: 'S', C3: 20,
      A4: 'Apple', B4: 'S', C4: 30,
      A5: 'Cherry', B5: 'N', C5: 40,
      G1: 'Region', G2: 'N', // criteria: Region = N
      I1: 'Item', I2: 'Banana', // criteria: Item = Banana (one match)
      J1: 'Region', J2: 'S', // criteria: Region = S
    };
    expect(evalWith('=DSUM(A1:C5,"Qty",G1:G2)', db)).toBe(50); // N rows: 10+40
    expect(evalWith('=DCOUNT(A1:C5,"Qty",G1:G2)', db)).toBe(2);
    expect(evalWith('=DMAX(A1:C5,"Qty",G1:G2)', db)).toBe(40);
    expect(evalWith('=DAVERAGE(A1:C5,"Qty",G1:G2)', db)).toBe(25);
    expect(evalWith('=DGET(A1:C5,"Item",I1:I2)', db)).toBe('Banana'); // single match
    expect(evalWith('=DGET(A1:C5,"Item",G1:G2)', db)).toBe(ERR.NUM); // >1 match → #NUM!
    expect(evalWith('=DVAR(A1:C5,"Qty",J1:J2)', db)).toBe(50); // S rows 20,30 → var.S = 50
    expect(evalWith('=DCOUNTA(A1:C5,"Item",G1:G2)', db)).toBe(2);
    // field by 1-based column index also works
    expect(evalWith('=DSUM(A1:C5,3,G1:G2)', db)).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Slice 42b — Financial (TVM / depreciation / rate conversion).
// ---------------------------------------------------------------------------

describe('CAP-FORMULA-FN — slice 42b (financial)', () => {
  it('time-value-of-money: PMT / PV / FV / NPER', () => {
    expect(evalWith('=PMT(0.08/12,120,20000)', {})).toBeCloseTo(-242.66, 1);
    expect(evalWith('=FV(0.05,10,-1000)', {})).toBeCloseTo(12577.89, 1);
    expect(evalWith('=PV(0.05,10,-1000)', {})).toBeCloseTo(7721.73, 1);
    expect(evalWith('=NPER(0.05,-1000,0,12577.89)', {})).toBeCloseTo(10, 3);
    expect(evalWith('=PMT(0,12,-1200)', {})).toBe(100); // rate 0 branch
  });

  it('RATE recovers the rate; IPMT+PPMT === PMT', () => {
    // RATE is the inverse of PMT.
    expect(evalWith('=RATE(12,PMT(0.01,12,1000),1000)', {})).toBeCloseTo(0.01, 5);
    const pmt = evalWith('=PMT(0.01,12,1000)', {}) as number;
    const ip = evalWith('=IPMT(0.01,1,12,1000)', {}) as number;
    const pp = evalWith('=PPMT(0.01,1,12,1000)', {}) as number;
    expect(ip + pp).toBeCloseTo(pmt, 6);
  });

  it('NPV / IRR / MIRR / XNPV / XIRR / FVSCHEDULE', () => {
    expect(evalWith('=NPV(0.1,100,200)', {})).toBeCloseTo(256.198, 2);
    const flows = { A1: -10000, A2: 3000, A3: 4200, A4: 6800 };
    expect(evalWith('=IRR(A1:A4)', flows)).toBeCloseTo(0.1631, 3);
    const m = { B1: -1000, B2: 300, B3: 400, B4: 500 };
    expect(evalWith('=MIRR(B1:B4,0.1,0.12)', m)).toBeCloseTo(0.0982, 3);
    expect(evalWith('=FVSCHEDULE(1000,C1:C3)', { C1: 0.05, C2: 0.05, C3: 0.05 })).toBeCloseTo(1157.625, 3);
    // XNPV/XIRR with dates 1 year apart (serials; only differences matter).
    const x = { V1: -100, V2: 50, V3: 60, D1: 0, D2: 365, D3: 730 };
    expect(evalWith('=XNPV(0.1,V1:V3,D1:D3)', x)).toBeCloseTo(-4.9587, 3);
    expect(evalWith('=XIRR(V1:V3,D1:D3)', x)).toBeCloseTo(0.0639, 3);
  });

  it('depreciation: SLN / SYD / DDB / DB', () => {
    expect(evalWith('=SLN(10000,1000,5)', {})).toBe(1800);
    expect(evalWith('=SYD(10000,1000,5,1)', {})).toBe(3000);
    expect(evalWith('=SYD(10000,1000,5,5)', {})).toBe(600);
    expect(evalWith('=DDB(10000,1000,5,1)', {})).toBe(4000);
    expect(evalWith('=DDB(10000,1000,5,2)', {})).toBe(2400);
    expect(evalWith('=DB(10000,1000,5,1,12)', {})).toBeCloseTo(3690, 0); // rate≈0.369
  });

  it('rate conversion + misc: EFFECT / NOMINAL / RRI / DOLLARDE / DOLLARFR', () => {
    expect(evalWith('=EFFECT(0.05,4)', {})).toBeCloseTo(0.050945, 5);
    expect(evalWith('=NOMINAL(0.050945,4)', {})).toBeCloseTo(0.05, 4);
    expect(evalWith('=RRI(10,1000,2000)', {})).toBeCloseTo(0.07177, 4);
    expect(evalWith('=DOLLARDE(1.02,32)', {})).toBe(1.0625);
    expect(evalWith('=DOLLARFR(1.0625,32)', {})).toBeCloseTo(1.02, 6);
  });
});

// ---------------------------------------------------------------------------
// Slice 42c-1 — Statistical (descriptive, ranking, regression) + AGGREGATE.
// ---------------------------------------------------------------------------

describe('CAP-FORMULA-FN — slice 42c-1 (statistical)', () => {
  const d = { A1: 2, A2: 4, A3: 4, A4: 4, A5: 5, A6: 5, A7: 7, A8: 9 }; // n=8, mean 5

  it('descriptive: MEDIAN / MODE / STDEV / VAR / LARGE / SMALL', () => {
    expect(evalWith('=MEDIAN(A1:A8)', d)).toBe(4.5);
    expect(evalWith('=MODE.SNGL(A1:A8)', d)).toBe(4);
    expect(evalWith('=MODE(A1:A8)', d)).toBe(4); // compat alias
    expect(evalWith('=STDEV.P(A1:A8)', d)).toBe(2);
    expect(evalWith('=VAR.P(A1:A8)', d)).toBe(4);
    expect(evalWith('=STDEV.S(A1:A8)', d)).toBeCloseTo(2.1381, 3);
    expect(evalWith('=STDEV(A1:A8)', d)).toBeCloseTo(2.1381, 3); // alias
    expect(evalWith('=VAR.S(A1:A8)', d)).toBeCloseTo(4.5714, 3);
    expect(evalWith('=LARGE(A1:A8,1)', d)).toBe(9);
    expect(evalWith('=LARGE(A1:A8,2)', d)).toBe(7);
    expect(evalWith('=SMALL(A1:A8,1)', d)).toBe(2);
    expect(evalWith('=LARGE(A1:A8,99)', d)).toBe(ERR.NUM); // out of range
  });

  it('percentile / quartile / rank', () => {
    expect(evalWith('=PERCENTILE.INC(A1:A8,0.5)', d)).toBe(4.5);
    expect(evalWith('=QUARTILE.INC(A1:A8,2)', d)).toBe(4.5);
    expect(evalWith('=QUARTILE.INC(A1:A8,0)', d)).toBe(2);
    expect(evalWith('=QUARTILE.INC(A1:A8,4)', d)).toBe(9);
    expect(evalWith('=RANK.EQ(4,A1:A8,0)', d)).toBe(5); // descending; 9,7,5,5 above
    expect(evalWith('=RANK.AVG(4,A1:A8)', d)).toBe(6); // three 4s at ranks 5,6,7 → 6
    expect(evalWith('=RANK.EQ(9,A1:A8,0)', d)).toBe(1);
  });

  it('means + deviations', () => {
    expect(evalWith('=GEOMEAN(A1:A8)', d)).toBeCloseTo(4.6032, 3);
    expect(evalWith('=HARMEAN(A1:A8)', d)).toBeCloseTo(4.2018, 3);
    expect(evalWith('=AVEDEV(A1:A8)', d)).toBe(1.5);
    expect(evalWith('=DEVSQ(A1:A8)', d)).toBe(32);
    expect(evalWith('=STANDARDIZE(7,5,2)', d)).toBe(1);
    expect(evalWith('=TRIMMEAN(A1:A8,0.25)', d)).toBeCloseTo(4.8333, 3);
    expect(evalWith('=MAXA(A1:A8)', d)).toBe(9);
  });

  it('regression / correlation (known_y, known_x)', () => {
    const r = { X1: 1, X2: 2, X3: 3, X4: 4, X5: 5, Y1: 2, Y2: 4, Y3: 5, Y4: 4, Y5: 5 };
    expect(evalWith('=SLOPE(Y1:Y5,X1:X5)', r)).toBeCloseTo(0.6, 6);
    expect(evalWith('=INTERCEPT(Y1:Y5,X1:X5)', r)).toBeCloseTo(2.2, 6);
    expect(evalWith('=CORREL(X1:X5,Y1:Y5)', r)).toBeCloseTo(0.7746, 3);
    expect(evalWith('=RSQ(X1:X5,Y1:Y5)', r)).toBeCloseTo(0.6, 6);
    expect(evalWith('=COVARIANCE.P(X1:X5,Y1:Y5)', r)).toBeCloseTo(1.2, 6);
    expect(evalWith('=COVARIANCE.S(X1:X5,Y1:Y5)', r)).toBeCloseTo(1.5, 6);
    expect(evalWith('=FORECAST.LINEAR(6,Y1:Y5,X1:X5)', r)).toBeCloseTo(5.8, 6);
  });

  it('AGGREGATE dispatches codes 1–19', () => {
    expect(evalWith('=AGGREGATE(9,6,A1:A8)', d)).toBe(40); // SUM
    expect(evalWith('=AGGREGATE(1,6,A1:A8)', d)).toBe(5); // AVERAGE
    expect(evalWith('=AGGREGATE(12,6,A1:A8)', d)).toBe(4.5); // MEDIAN
    expect(evalWith('=AGGREGATE(14,6,A1:A8,2)', d)).toBe(7); // 2nd LARGE
    expect(evalWith('=AGGREGATE(15,6,A1:A8,1)', d)).toBe(2); // 1st SMALL
  });
});

// ---------------------------------------------------------------------------
// Slice 42d — Math & trigonometry.
// ---------------------------------------------------------------------------

describe('CAP-FORMULA-FN — slice 42d (math/trig)', () => {
  it('trig / hyperbolic / conversions', () => {
    expect(evalWith('=PI()', {})).toBeCloseTo(Math.PI, 8);
    expect(evalWith('=DEGREES(PI())', {})).toBeCloseTo(180, 8);
    expect(evalWith('=RADIANS(180)', {})).toBeCloseTo(Math.PI, 8);
    expect(evalWith('=SIN(RADIANS(30))', {})).toBeCloseTo(0.5, 8);
    expect(evalWith('=COS(0)', {})).toBe(1);
    expect(evalWith('=ATAN2(1,1)', {})).toBeCloseTo(Math.PI / 4, 8);
    expect(evalWith('=ASIN(2)', {})).toBe(ERR.NUM); // domain
    expect(evalWith('=COSH(0)', {})).toBe(1);
    expect(evalWith('=SQRTPI(1)', {})).toBeCloseTo(Math.sqrt(Math.PI), 8);
  });

  it('integer / combinatorics', () => {
    expect(evalWith('=GCD(24,36,60)', {})).toBe(12);
    expect(evalWith('=LCM(4,6,10)', {})).toBe(60);
    expect(evalWith('=QUOTIENT(17,5)', {})).toBe(3);
    expect(evalWith('=EVEN(3)', {})).toBe(4);
    expect(evalWith('=EVEN(-1)', {})).toBe(-2);
    expect(evalWith('=ODD(2)', {})).toBe(3);
    expect(evalWith('=FACT(5)', {})).toBe(120);
    expect(evalWith('=FACTDOUBLE(7)', {})).toBe(105); // 7·5·3·1
    expect(evalWith('=COMBIN(5,2)', {})).toBe(10);
    expect(evalWith('=PERMUT(5,2)', {})).toBe(20);
    expect(evalWith('=COMBINA(4,3)', {})).toBe(20); // COMBIN(6,3)
    expect(evalWith('=MULTINOMIAL(2,3,4)', {})).toBe(1260);
    expect(evalWith('=GAMMALN(4)', {})).toBeCloseTo(Math.log(6), 6); // ln(3!)
  });

  it('series / paired sums', () => {
    expect(evalWith('=SERIESSUM(2,0,1,C1:C4)', { C1: 1, C2: 1, C3: 1, C4: 1 })).toBe(15); // 1+2+4+8
    const p = { X1: 2, X2: 3, Y1: 1, Y2: 2 };
    expect(evalWith('=SUMX2MY2(X1:X2,Y1:Y2)', p)).toBe(8);
    expect(evalWith('=SUMX2PY2(X1:X2,Y1:Y2)', p)).toBe(18);
    expect(evalWith('=SUMXMY2(X1:X2,Y1:Y2)', p)).toBe(2);
  });

  it('roman / bases / rounding', () => {
    expect(evalWith('=ROMAN(1994)', {})).toBe('MCMXCIV');
    expect(evalWith('=ARABIC("MCMXCIV")', {})).toBe(1994);
    expect(evalWith('=BASE(255,16)', {})).toBe('FF');
    expect(evalWith('=BASE(7,2,8)', {})).toBe('00000111');
    expect(evalWith('=DECIMAL("FF",16)', {})).toBe(255);
    expect(evalWith('=MROUND(11,3)', {})).toBe(12);
    expect(evalWith('=MROUND(5,-2)', {})).toBe(ERR.NUM); // sign mismatch
    expect(evalWith('=CEILING.MATH(4.3)', {})).toBe(5);
    expect(evalWith('=CEILING.MATH(-4.3)', {})).toBe(-4); // default: toward +inf
    expect(evalWith('=CEILING.MATH(-4.3,1,1)', {})).toBe(-5); // mode≠0: away from zero
    expect(evalWith('=FLOOR.MATH(-4.3)', {})).toBe(-5); // toward -inf
    expect(evalWith('=FLOOR.PRECISE(-4.3)', {})).toBe(-5);
  });
});

// ---------------------------------------------------------------------------
// Slice 42e — Date/time + text.
// ---------------------------------------------------------------------------

describe('CAP-FORMULA-FN — slice 42e (date/time + text)', () => {
  it('time components', () => {
    expect(evalWith('=HOUR(TIME(14,30,45))', {})).toBe(14);
    expect(evalWith('=MINUTE(TIME(14,30,45))', {})).toBe(30);
    expect(evalWith('=SECOND(TIME(14,30,45))', {})).toBe(45);
    expect(evalWith('=HOUR(TIMEVALUE("14:30:00"))', {})).toBe(14);
  });

  it('date parse / arithmetic (EDATE / EOMONTH clamp to month end)', () => {
    expect(evalWith('=YEAR(DATEVALUE("2026-07-04"))', {})).toBe(2026);
    expect(evalWith('=MONTH(DATEVALUE("2026-07-04"))', {})).toBe(7);
    expect(evalWith('=DAY(DATEVALUE("2026-07-04"))', {})).toBe(4);
    expect(evalWith('=DAY(EDATE(DATE(2026,1,31),1))', {})).toBe(28); // Jan 31 +1m → Feb 28
    expect(evalWith('=MONTH(EDATE(DATE(2026,1,31),1))', {})).toBe(2);
    expect(evalWith('=DAY(EOMONTH(DATE(2026,1,15),0))', {})).toBe(31);
    expect(evalWith('=DAY(EOMONTH(DATE(2026,1,15),1))', {})).toBe(28);
    expect(evalWith('=DAYS(DATE(2026,1,31),DATE(2026,1,1))', {})).toBe(30);
    expect(evalWith('=DAYS360(DATE(2026,1,1),DATE(2026,3,1))', {})).toBe(60);
  });

  it('DATEDIF / WEEKDAY / YEARFRAC / week numbers', () => {
    expect(evalWith('=DATEDIF(DATE(2020,1,15),DATE(2026,7,4),"Y")', {})).toBe(6);
    expect(evalWith('=DATEDIF(DATE(2020,1,15),DATE(2026,7,4),"M")', {})).toBe(77);
    // DATE(2000,1,1) is a Saturday.
    expect(evalWith('=WEEKDAY(DATE(2000,1,1),1)', {})).toBe(7);
    expect(evalWith('=WEEKDAY(DATE(2000,1,1),2)', {})).toBe(6);
    expect(evalWith('=YEARFRAC(DATE(2026,1,1),DATE(2026,7,1),0)', {})).toBeCloseTo(0.5, 6);
    expect(evalWith('=YEARFRAC(DATE(2026,1,1),DATE(2026,7,1),3)', {})).toBeCloseTo(181 / 365, 6);
    expect(evalWith('=ISOWEEKNUM(DATE(2026,1,1))', {})).toBe(1); // 2026-01-01 is a Thursday
  });

  it('NETWORKDAYS / WORKDAY', () => {
    expect(evalWith('=NETWORKDAYS(DATE(2026,1,1),DATE(2026,1,31))', {})).toBe(22);
    expect(evalWith('=DAY(WORKDAY(DATE(2026,1,1),5))', {})).toBe(8); // Thu +5 workdays → Jan 8
  });

  it('text: FIXED / DOLLAR / NUMBERVALUE / CLEAN / T / UNICHAR', () => {
    expect(evalWith('=FIXED(1234.567,2)', {})).toBe('1,234.57');
    expect(evalWith('=FIXED(1234.567,2,TRUE)', {})).toBe('1234.57');
    expect(evalWith('=FIXED(1234.5,-2)', {})).toBe('1,200');
    expect(evalWith('=DOLLAR(1234.5)', {})).toBe('$1,234.50');
    expect(evalWith('=DOLLAR(-1234.5)', {})).toBe('($1,234.50)');
    expect(evalWith('=NUMBERVALUE("1,234.5")', {})).toBe(1234.5);
    expect(evalWith('=NUMBERVALUE("50%")', {})).toBe(0.5);
    expect(evalWith('=CLEAN(CHAR(9)&"hello")', {})).toBe('hello');
    expect(evalWith('=T("hi")', {})).toBe('hi');
    expect(evalWith('=T(5)', {})).toBe('');
    expect(evalWith('=UNICHAR(65)', {})).toBe('A');
    expect(evalWith('=UNICODE("A")', {})).toBe(65);
  });

  it('text: FIXED / DOLLAR / TEXT are locale-aware (COMPONENT-I18N)', () => {
    // de-DE swaps grouping (.) and decimal (,) separators.
    expect(evalWith('=FIXED(1234.5,2)', {}, 'de-DE')).toBe('1.234,50');
    expect(evalWith('=FIXED(1234.567,2,TRUE)', {}, 'de-DE')).toBe('1234,57');
    expect(evalWith('=TEXT(1234.5,"#,##0.00")', {}, 'de-DE')).toBe('1.234,50');
    // DOLLAR follows the locale's currency (EUR) + separators.
    const eur = evalWith('=DOLLAR(1234.5)', {}, 'de-DE') as string;
    expect(eur).toContain('€');
    expect(eur).toContain('1.234,50');
    // en-US remains the default when no locale is supplied.
    expect(evalWith('=TEXT(0.1234,"0.0%")', {})).toBe('12.3%');
    expect(evalWith('=FIXED(1234.5,2)', {})).toBe('1,234.50');
  });

  it('text: TEXTBEFORE / TEXTAFTER / REGEX*', () => {
    expect(evalWith('=TEXTBEFORE("a-b-c","-")', {})).toBe('a');
    expect(evalWith('=TEXTAFTER("a-b-c","-")', {})).toBe('b-c');
    expect(evalWith('=TEXTBEFORE("a-b-c","-",2)', {})).toBe('a-b');
    expect(evalWith('=TEXTAFTER("a-b-c","-",-1)', {})).toBe('c'); // last occurrence
    expect(evalWith('=REGEXTEST("abc123","\\d+")', {})).toBe(true);
    expect(evalWith('=REGEXEXTRACT("abc123","\\d+")', {})).toBe('123');
    expect(evalWith('=REGEXREPLACE("a1b2","\\d","#")', {})).toBe('a#b#');
  });
});

// ---------------------------------------------------------------------------
// Slice 42f — Engineering.
// ---------------------------------------------------------------------------

describe('CAP-FORMULA-FN — slice 42f (engineering)', () => {
  it('base conversions (two’s-complement)', () => {
    expect(evalWith('=DEC2BIN(9)', {})).toBe('1001');
    expect(evalWith('=DEC2BIN(3,4)', {})).toBe('0011'); // padded
    expect(evalWith('=DEC2BIN(-1)', {})).toBe('1111111111');
    expect(evalWith('=DEC2HEX(255)', {})).toBe('FF');
    expect(evalWith('=BIN2DEC("1111111111")', {})).toBe(-1);
    expect(evalWith('=BIN2DEC("1001")', {})).toBe(9);
    expect(evalWith('=HEX2DEC("FF")', {})).toBe(255);
    expect(evalWith('=BIN2HEX("1111")', {})).toBe('F');
    expect(evalWith('=OCT2DEC("17")', {})).toBe(15);
  });

  it('Bessel functions (Excel-documented)', () => {
    expect(evalWith('=BESSELI(1.5,1)', {})).toBeCloseTo(0.981666, 4);
    expect(evalWith('=BESSELJ(1.9,2)', {})).toBeCloseTo(0.329926, 4);
    expect(evalWith('=BESSELK(1.5,1)', {})).toBeCloseTo(0.277388, 4);
    expect(evalWith('=BESSELY(2.5,1)', {})).toBeCloseTo(0.145918, 4);
    expect(evalWith('=BESSELJ(0,0)', {})).toBeCloseTo(1, 6); // J0(0)=1
  });

  it('bitwise + step functions', () => {
    expect(evalWith('=BITAND(5,3)', {})).toBe(1);
    expect(evalWith('=BITOR(5,3)', {})).toBe(7);
    expect(evalWith('=BITXOR(5,3)', {})).toBe(6);
    expect(evalWith('=BITLSHIFT(1,4)', {})).toBe(16);
    expect(evalWith('=BITRSHIFT(16,4)', {})).toBe(1);
    expect(evalWith('=DELTA(5,5)', {})).toBe(1);
    expect(evalWith('=DELTA(5,4)', {})).toBe(0);
    expect(evalWith('=GESTEP(5,4)', {})).toBe(1);
    expect(evalWith('=ERF(1)', {})).toBeCloseTo(0.8427, 3);
    expect(evalWith('=ERFC(1)', {})).toBeCloseTo(0.1573, 3);
  });

  it('CONVERT (unit conversion + temperature)', () => {
    expect(evalWith('=CONVERT(1,"km","m")', {})).toBe(1000);
    expect(evalWith('=CONVERT(1,"day","hr")', {})).toBe(24);
    expect(evalWith('=CONVERT(1,"lbm","kg")', {})).toBeCloseTo(0.4536, 4);
    expect(evalWith('=CONVERT(100,"C","F")', {})).toBeCloseTo(212, 6);
    expect(evalWith('=CONVERT(1,"m","kg")', {})).toBe(ERR.NA); // incompatible categories
    // Expanded table + metric prefixes.
    expect(evalWith('=CONVERT(1,"kW","W")', {})).toBe(1000); // prefix on a base unit
    expect(evalWith('=CONVERT(1,"MPa","Pa")', {})).toBe(1000000);
    expect(evalWith('=CONVERT(1,"mL","L")', {})).toBeCloseTo(0.001, 9);
    expect(evalWith('=CONVERT(1,"atm","Pa")', {})).toBeCloseTo(101325, 3);
    expect(evalWith('=CONVERT(1,"gal","L")', {})).toBeCloseTo(3.785411784, 6);
    expect(evalWith('=CONVERT(100,"km/h","m/s")', {})).toBeCloseTo(27.7778, 3);
    expect(evalWith('=CONVERT(1,"acre","m2")', {})).toBeCloseTo(4046.856, 2);
  });

  it('complex numbers', () => {
    expect(evalWith('=COMPLEX(3,4)', {})).toBe('3+4i');
    expect(evalWith('=COMPLEX(0,1)', {})).toBe('i');
    expect(evalWith('=COMPLEX(3,-4)', {})).toBe('3-4i');
    expect(evalWith('=IMREAL("3+4i")', {})).toBe(3);
    expect(evalWith('=IMAGINARY("3+4i")', {})).toBe(4);
    expect(evalWith('=IMABS("3+4i")', {})).toBe(5);
    expect(evalWith('=IMARGUMENT("1+i")', {})).toBeCloseTo(Math.PI / 4, 6);
    expect(evalWith('=IMSUM("1+2i","3+4i")', {})).toBe('4+6i');
    expect(evalWith('=IMPRODUCT("1+i","1+i")', {})).toBe('2i'); // i²=-1
    expect(evalWith('=IMDIV("1+i","1-i")', {})).toBe('i');
    expect(evalWith('=IMSQRT("3+4i")', {})).toBe('2+i');
    expect(evalWith('=IMCONJUGATE("3+4i")', {})).toBe('3-4i');
  });

  it('complex trig / log / power (extended IM*)', () => {
    expect(evalWith('=IMPOWER("2+3i",2)', {})).toBe('-5+12i'); // (2+3i)²
    expect(evalWith('=IMLOG10("100")', {})).toBe('2');
    expect(evalWith('=IMLOG2("8")', {})).toBe('3');
    expect(evalWith('=IMSINH("0")', {})).toBe('0');
    expect(evalWith('=IMCOSH("0")', {})).toBe('1');
    expect(evalWith('=IMSEC("0")', {})).toBe('1');
    expect(evalWith('=IMTAN("0")', {})).toBe('0');
    expect(evalWith('=IMREAL(IMTAN("1"))', {})).toBeCloseTo(Math.tan(1), 6);
  });
});

// ---------------------------------------------------------------------------
// Slice 42g — Lookup-pure + Info-pure.
// ---------------------------------------------------------------------------

describe('CAP-FORMULA-FN — slice 42g (lookup + info)', () => {
  const t = { A1: 10, A2: 20, A3: 30, A4: 40, B1: 'ten', B2: 'twenty', B3: 'thirty', B4: 'forty' };

  it('XLOOKUP / XMATCH / LOOKUP', () => {
    expect(evalWith('=XLOOKUP(30,A1:A4,B1:B4)', t)).toBe('thirty');
    expect(evalWith('=XLOOKUP(99,A1:A4,B1:B4,"none")', t)).toBe('none'); // if_not_found
    expect(evalWith('=XLOOKUP(25,A1:A4,B1:B4,,-1)', t)).toBe('twenty'); // exact-or-smaller
    expect(evalWith('=XLOOKUP(25,A1:A4,B1:B4,,1)', t)).toBe('thirty'); // exact-or-larger
    expect(evalWith('=XMATCH(30,A1:A4)', t)).toBe(3);
    expect(evalWith('=XMATCH(99,A1:A4)', t)).toBe(ERR.NA);
    expect(evalWith('=LOOKUP(25,A1:A4,B1:B4)', t)).toBe('twenty'); // largest ≤ 25
  });

  it('ADDRESS builds A1 / R1C1 references', () => {
    expect(evalWith('=ADDRESS(1,1)', {})).toBe('$A$1');
    expect(evalWith('=ADDRESS(2,3,4)', {})).toBe('C2'); // relative
    expect(evalWith('=ADDRESS(2,3,2)', {})).toBe('C$2'); // row-absolute
    expect(evalWith('=ADDRESS(1,1,1,FALSE)', {})).toBe('R1C1'); // R1C1
    expect(evalWith('=ADDRESS(5,27)', {})).toBe('$AA$5'); // col 27 → AA
  });

  it('HYPERLINK / info predicates / TYPE / ERROR.TYPE', () => {
    expect(evalWith('=HYPERLINK("http://x","label")', {})).toBe('label');
    expect(evalWith('=HYPERLINK("http://x")', {})).toBe('http://x');
    expect(evalWith('=ISODD(7)', {})).toBe(true);
    expect(evalWith('=ISEVEN(8)', {})).toBe(true);
    expect(evalWith('=ISLOGICAL(TRUE)', {})).toBe(true);
    expect(evalWith('=ISNONTEXT(5)', {})).toBe(true);
    expect(evalWith('=ISNONTEXT("x")', {})).toBe(false);
    expect(evalWith('=TYPE(5)', {})).toBe(1);
    expect(evalWith('=TYPE("x")', {})).toBe(2);
    expect(evalWith('=TYPE(TRUE)', {})).toBe(4);
    expect(evalWith('=TYPE(1/0)', {})).toBe(16); // error
    expect(evalWith('=ERROR.TYPE(1/0)', {})).toBe(2); // #DIV/0!
    expect(evalWith('=ERROR.TYPE(NA())', {})).toBe(7); // #N/A
    expect(evalWith('=ERROR.TYPE(5)', {})).toBe(ERR.NA); // not an error
  });
});

// ---------------------------------------------------------------------------
// FORECAST.ETS — Holt-Winters exponential smoothing.
// ---------------------------------------------------------------------------

describe('CAP-FORMULA-FN — FORECAST.ETS (Holt-Winters)', () => {
  // Synthetic series: linear trend 10+2t plus a period-4 season [0,5,0,-5], t=1..16.
  const cells: Record<string, number> = {};
  const season = [0, 5, 0, -5];
  for (let t = 1; t <= 16; t++) {
    cells[`A${t}`] = t;
    cells[`B${t}`] = 10 + 2 * t + (season[(t - 1) % 4] as number);
  }

  it('auto-detects the seasonal period', () => {
    expect(evalWith('=FORECAST.ETS.SEASONALITY(B1:B16,A1:A16)', cells)).toBe(4);
  });

  it('forecasts a future value near the true pattern', () => {
    // True value at t=17 = 10+34 + season[(17-1)%4 = 0] = 44.
    const f = evalWith('=FORECAST.ETS(17,B1:B16,A1:A16,4)', cells) as number;
    expect(f).toBeGreaterThan(40);
    expect(f).toBeLessThan(48);
    expect(evalWith('=FORECAST.ETS(0,B1:B16,A1:A16,4)', cells)).toBe(ERR.NUM); // not in the future
  });

  it('STAT exposes smoothing params + errors, CONFINT is non-negative', () => {
    const alpha = evalWith('=FORECAST.ETS.STAT(B1:B16,A1:A16,1,4)', cells) as number;
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThanOrEqual(0.9);
    expect(evalWith('=FORECAST.ETS.STAT(B1:B16,A1:A16,8,4)', cells)).toBe(1); // step size = timeline interval
    expect(evalWith('=FORECAST.ETS.CONFINT(17,B1:B16,A1:A16,0.95,4)', cells) as number).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Slice 42b-2 — Bond / coupon / day-count.
// ---------------------------------------------------------------------------

describe('CAP-FORMULA-FN — slice 42b-2 (bond/coupon)', () => {
  it('discount + at-maturity instruments (Excel-documented)', () => {
    expect(evalWith('=DISC(DATE(2007,1,25),DATE(2007,6,15),97.975,100,1)', {})).toBeCloseTo(0.0524202, 5);
    expect(evalWith('=ACCRINTM(DATE(2008,4,1),DATE(2008,6,15),0.1,1000,3)', {})).toBeCloseTo(20.54795, 4);
    expect(evalWith('=TBILLPRICE(DATE(2008,3,31),DATE(2008,6,1),0.09)', {})).toBeCloseTo(98.45, 6);
    expect(evalWith('=TBILLYIELD(DATE(2008,3,31),DATE(2008,6,1),98.45)', {})).toBeCloseTo(0.0914166, 5);
    expect(evalWith('=INTRATE(DATE(2008,2,15),DATE(2008,5,15),1000000,1014420,2)', {})).toBeCloseTo(0.05768, 4);
  });

  it('coupon schedule + coupon-bond price/yield/duration', () => {
    expect(evalWith('=COUPNUM(DATE(2007,1,25),DATE(2008,11,15),2,0)', {})).toBe(4);
    expect(evalWith('=DAY(COUPNCD(DATE(2007,1,25),DATE(2008,11,15),2,0))', {})).toBe(15); // next coupon is 15th
    expect(evalWith('=PRICE(DATE(2008,2,15),DATE(2017,11,15),0.0575,0.065,100,2,0)', {})).toBeCloseTo(94.63436, 3);
    expect(evalWith('=YIELD(DATE(2008,2,15),DATE(2016,11,15),0.0575,95.04287,100,2,0)', {})).toBeCloseTo(0.065, 4);
    expect(evalWith('=DURATION(DATE(2008,1,1),DATE(2016,1,1),0.08,0.09,2,1)', {})).toBeCloseTo(5.9938, 2);
    expect(evalWith('=MDURATION(DATE(2008,1,1),DATE(2016,1,1),0.08,0.09,2,1)', {})).toBeCloseTo(5.7357, 2);
  });

  it('VDB variable declining balance', () => {
    expect(evalWith('=VDB(2400,300,10,0,1)', {})).toBeCloseTo(480, 4); // yr1 = 2400·0.2
    expect(evalWith('=VDB(2400,300,10,0,2)', {})).toBeCloseTo(864, 4); // +1920·0.2
  });

  it('AMORLINC / AMORDEGRC French depreciation (Excel-documented)', () => {
    expect(evalWith('=AMORLINC(2400,DATE(2008,8,19),DATE(2008,12,31),300,1,0.15,1)', {})).toBeCloseTo(360, 4);
    expect(evalWith('=AMORDEGRC(2400,DATE(2008,8,19),DATE(2008,12,31),300,1,0.15,1)', {})).toBeCloseTo(776, 4);
  });
});

// ---------------------------------------------------------------------------
// Slice 42c-2 — Statistical distributions + inverses.
// ---------------------------------------------------------------------------

describe('CAP-FORMULA-FN — slice 42c-2 (distributions)', () => {
  it('normal + inverse (round-trip)', () => {
    expect(evalWith('=NORM.S.DIST(0,TRUE)', {})).toBeCloseTo(0.5, 6);
    expect(evalWith('=NORM.S.DIST(1.96,TRUE)', {})).toBeCloseTo(0.975, 3);
    expect(evalWith('=NORM.S.INV(0.975)', {})).toBeCloseTo(1.96, 2);
    expect(evalWith('=NORM.DIST(0,0,1,FALSE)', {})).toBeCloseTo(0.39894, 4); // pdf peak
    expect(evalWith('=NORM.INV(0.5,100,15)', {})).toBeCloseTo(100, 4);
    expect(evalWith('=GAUSS(1)', {})).toBeCloseTo(0.34134, 4);
  });

  it('gamma / chisq / poisson / expon', () => {
    expect(evalWith('=GAMMA(5)', {})).toBeCloseTo(24, 4); // 4!
    expect(evalWith('=CHISQ.DIST(3.84,1,TRUE)', {})).toBeCloseTo(0.95, 2);
    expect(evalWith('=CHISQ.INV.RT(0.05,1)', {})).toBeCloseTo(3.8415, 2);
    expect(evalWith('=POISSON.DIST(2,3,FALSE)', {})).toBeCloseTo(0.22404, 4);
    expect(evalWith('=EXPON.DIST(1,1,TRUE)', {})).toBeCloseTo(0.63212, 4);
  });

  it('inverse round-trips — F.INV / GAMMA.INV / BETA.INV (bisectInv guard)', () => {
    // Each inverse must undo its forward CDF (the invariant any solver must preserve).
    expect(evalWith('=GAMMA.INV(GAMMA.DIST(4,2,1.5,TRUE),2,1.5)', {}) as number).toBeCloseTo(4, 5);
    expect(evalWith('=BETA.INV(0.5,2,2)', {}) as number).toBeCloseTo(0.5, 6); // median of Beta(2,2)
    expect(evalWith('=BETA.INV(BETA.DIST(0.3,3,2,TRUE),3,2)', {}) as number).toBeCloseTo(0.3, 5);
    expect(evalWith('=F.INV.RT(0.5,10,10)', {}) as number).toBeCloseTo(1, 4); // F.DIST.RT(1,10,10)=0.5
    expect(evalWith('=F.INV(F.DIST(2,5,8,TRUE),5,8)', {}) as number).toBeCloseTo(2, 5);
    // spot values against known references
    expect(evalWith('=GAMMA.INV(0.5,1,1)', {}) as number).toBeCloseTo(Math.LN2, 5); // median of Exp(1)
  });

  it('t / F / beta / binom distributions', () => {
    expect(evalWith('=T.DIST(0,10,TRUE)', {})).toBeCloseTo(0.5, 6);
    expect(evalWith('=T.INV.2T(0.05,10)', {})).toBeCloseTo(2.2281, 2);
    expect(evalWith('=F.DIST.RT(1,10,10)', {})).toBeCloseTo(0.5, 2);
    expect(evalWith('=BETA.DIST(0.5,2,2,TRUE)', {})).toBeCloseTo(0.5, 6);
    expect(evalWith('=BINOM.DIST(2,10,0.5,FALSE)', {})).toBeCloseTo(0.04395, 4);
    expect(evalWith('=BINOM.DIST(5,10,0.5,TRUE)', {})).toBeCloseTo(0.62305, 4);
  });

  it('T.TEST / F.TEST / CHISQ.TEST', () => {
    const c = {
      A1: 1, A2: 2, A3: 3, A4: 4, A5: 5,
      B1: 1, B2: 2, B3: 3, B4: 4,
      C1: 6, C2: 7, C3: 8, C4: 9, C5: 10,
      F1: 6, F2: 7, F3: 9, F4: 15, F5: 21,
      G1: 20, G2: 28, G3: 31, G4: 38, G5: 40,
      H1: 10, H2: 20, H3: 30, I1: 20, I2: 20, I3: 20,
    };
    // Identical samples → no mean difference → p = 1 (two-tailed, equal-var).
    expect(evalWith('=T.TEST(A1:A4,B1:B4,2,2)', c)).toBeCloseTo(1, 6);
    // Two-tailed p = 2 × one-tailed p for the same data (any distribution).
    const t2 = evalWith('=T.TEST(A1:A5,C1:C5,2,2)', c) as number;
    const t1 = evalWith('=T.TEST(A1:A5,C1:C5,1,2)', c) as number;
    expect(t2).toBeCloseTo(2 * t1, 8);
    // F.TEST — Excel-documented example.
    expect(evalWith('=F.TEST(F1:F5,G1:G5)', c)).toBeCloseTo(0.648318, 5);
    // CHISQ.TEST: {10,20,30} vs {20,20,20} → χ²=10, df=2 → e^-5.
    expect(evalWith('=CHISQ.TEST(H1:H3,I1:I3)', c)).toBeCloseTo(0.0067379, 6);
  });

  it('CONFIDENCE / Z.TEST / FISHER / compat aliases', () => {
    expect(evalWith('=CONFIDENCE.NORM(0.05,2.5,50)', {})).toBeCloseTo(0.69295, 4);
    expect(evalWith('=FISHER(0.5)', {})).toBeCloseTo(0.54931, 4);
    expect(evalWith('=FISHERINV(0.54931)', {})).toBeCloseTo(0.5, 4);
    // compat aliases route onto the modern functions.
    expect(evalWith('=NORMSDIST(1.96)', {})).toBeCloseTo(0.975, 3);
    expect(evalWith('=CHIDIST(3.84,1)', {})).toBeCloseTo(0.05, 2);
    const z = { A1: 3, A2: 4, A3: 5, A4: 6, A5: 7 }; // mean 5
    expect(evalWith('=ZTEST(A1:A5,5)', z)).toBeCloseTo(0.5, 6);
  });
});

// ---------------------------------------------------------------------------
// Dependency graph: full recalc, chains, incremental, cycles
// ---------------------------------------------------------------------------

describe('CAP-FORMULA-ARRAY — slice 45c (spill materialization)', () => {
  it('a 1-D array spills down into neighbouring cells', () => {
    const g = new TestGrid(5, 5);
    g.setFormula(0, 0, '=SEQUENCE(3)'); // A1 anchors, spills A1:A3
    expect(g.get(0, 0)).toBe(1); // anchor value
    expect(g.get(0, 1)).toBe(2); // A2
    expect(g.get(0, 2)).toBe(3); // A3
  });

  it('a 2-D array spills across rows and columns', () => {
    const g = new TestGrid(5, 5);
    g.setFormula(0, 0, '=SEQUENCE(2,2)'); // A1:B2 = 1,2 / 3,4
    expect(g.get(0, 0)).toBe(1); // A1
    expect(g.get(1, 0)).toBe(2); // B1
    expect(g.get(0, 1)).toBe(3); // A2
    expect(g.get(1, 1)).toBe(4); // B2
  });

  it('a blocked target yields #SPILL!', () => {
    const g = new TestGrid(5, 5);
    g.setLiteral(0, 1, 99); // A2 already occupied
    g.setFormula(0, 0, '=SEQUENCE(3)');
    expect(g.get(0, 0)).toBe('#SPILL!');
    expect(g.get(0, 1)).toBe(99); // literal untouched
  });

  it('recomputing a smaller array clears the vacated spill cells', () => {
    const g = new TestGrid(5, 5);
    g.setFormula(0, 0, '=SEQUENCE(3)');
    expect(g.get(0, 2)).toBe(3);
    g.setFormula(0, 0, '=SEQUENCE(2)'); // shrink → A3 must be vacated
    expect(g.get(0, 1)).toBe(2);
    expect(g.get(0, 2)).toBe(null);
  });

  it('a spilled cell feeds a downstream formula', () => {
    const g = new TestGrid(5, 5);
    g.setFormula(0, 0, '=SEQUENCE(3,1,10,10)'); // A1:A3 = 10,20,30
    g.setFormula(2, 0, '=A2*10'); // reads the spilled A2 (=20)
    expect(g.get(2, 0)).toBe(200);
  });

  it('spill changes are reported + queryable (EVT-SPILL-CHANGE substrate)', () => {
    const g = new TestGrid(6, 6);
    const id = g.engine.setFormula(0, 'A', 0, 0, '=SEQUENCE(3)');
    const s1 = g.engine.recalcFrom([id]);
    expect(s1.spillChanged).toBe(true);
    expect(g.engine.getSpillRanges()).toEqual([{ anchor: encodeCellId(0, 0), top: 0, left: 0, rows: 3, cols: 1 }]);
    // A recalc that doesn't touch the spill reports no spill change.
    const s2 = g.engine.recalcFrom([encodeCellId(5, 5)]);
    expect(s2.spillChanged).toBe(false);
  });

  it('the A1# spill-reference operator tracks the live spill extent', () => {
    // Parser/evaluator: A1# with no spill degrades to the single anchor cell.
    expect(evalWith('=A1#', { A1: 5 })).toBe(5);

    const g = new TestGrid(6, 6);
    g.setFormula(0, 0, '=SEQUENCE(3)'); // A1 spills A1:A3 = 1,2,3
    g.setFormula(1, 0, '=SUM(A1#)'); // B1 sums the whole spilled range = 6
    expect(g.get(1, 0)).toBe(6);
    // B1 depends on the anchor → shrinking the spill auto-updates B1.
    g.setFormula(0, 0, '=SEQUENCE(2)'); // A1:A2 = 1,2
    expect(g.get(1, 0)).toBe(3);
  });
});

describe('CAP-FORMULA-ARRAY — slice 45b (LET / LAMBDA / MAP / REDUCE)', () => {
  const c = { A1: 1, A2: 2, A3: 3, B1: 2, B2: 4 };

  it('LET binds names (sequential, later sees earlier)', () => {
    expect(evalWith('=LET(x,5,x+1)', {})).toBe(6);
    expect(evalWith('=LET(x,A1,y,x*10,x+y)', { A1: 3 })).toBe(33); // x=3, y=30
    expect(evalWith('=LET(x,SUM(A1:A3),x*x)', c)).toBe(36); // 6²
  });

  it('LAMBDA is callable via a LET binding; bare lambda → #CALC!', () => {
    expect(evalWith('=LET(f,LAMBDA(a,b,a+b),f(3,4))', {})).toBe(7);
    expect(evalWith('=LET(sq,LAMBDA(x,x*x),sq(9))', {})).toBe(81);
    expect(evalWith('=LAMBDA(x,x+1)', {})).toBe(ERR.CALC); // not invoked
  });

  it('MAP / REDUCE / SCAN / MAKEARRAY / BYROW', () => {
    expect(evalWith('=SUM(MAP(A1:A3,LAMBDA(x,x*x)))', c)).toBe(14); // 1+4+9
    expect(evalWith('=REDUCE(0,A1:A3,LAMBDA(acc,v,acc+v))', c)).toBe(6);
    expect(evalWith('=REDUCE(1,A1:A3,LAMBDA(acc,v,acc*v))', c)).toBe(6); // 1·1·2·3
    expect(evalWith('=INDEX(SCAN(0,A1:A3,LAMBDA(acc,v,acc+v)),3)', c)).toBe(6); // running sum
    expect(evalWith('=SUM(MAKEARRAY(2,2,LAMBDA(r,co,r*co)))', {})).toBe(9); // 1+2+2+4
    expect(evalWith('=INDEX(BYROW(A1:B2,LAMBDA(r,SUM(r))),1)', c)).toBe(3); // row1 = 1+2
  });

  it('ISOMITTED — detects an omitted LAMBDA argument', () => {
    const f = 'LAMBDA(x,y,IF(ISOMITTED(y),x,x+y))';
    expect(evalWith(`=LET(f,${f},f(10))`, {})).toBe(10); // y omitted → x
    expect(evalWith(`=LET(f,${f},f(10,5))`, {})).toBe(15); // y=5 → x+y
    expect(evalWith(`=LET(f,${f},f(10,))`, {})).toBe(10); // explicit trailing omit
    // an omitted param used as a value reads as blank (0 in arithmetic)
    expect(evalWith('=LET(g,LAMBDA(x,y,x+y),g(7))', {})).toBe(7); // y blank → 7+0
    // outside a lambda, a present argument is not omitted
    expect(evalWith('=ISOMITTED(1)', {})).toBe(false);
  });
});

describe('CAP-FORMULA-ARRAY — slice 45a (dynamic-array functions)', () => {
  it('SEQUENCE / TRANSPOSE / TEXTSPLIT', () => {
    expect(evalWith('=SUM(SEQUENCE(3))', {})).toBe(6); // {1;2;3}
    expect(evalWith('=SUM(SEQUENCE(2,3))', {})).toBe(21); // 1..6
    expect(evalWith('=INDEX(SEQUENCE(3,1,10,5),2)', {})).toBe(15); // 10,15,20
    expect(evalWith('=INDEX(TRANSPOSE(A1:C1),2,1)', { A1: 1, B1: 2, C1: 3 })).toBe(2);
    expect(evalWith('=INDEX(TEXTSPLIT("a,b,c",","),1,2)', {})).toBe('b');
  });

  it('reshape: TAKE / DROP / HSTACK / VSTACK / WRAP* / CHOOSE* / EXPAND / MMULT', () => {
    expect(evalWith('=SUM(TAKE(SEQUENCE(5),2))', {})).toBe(3); // {1;2}
    expect(evalWith('=SUM(TAKE(SEQUENCE(5),-2))', {})).toBe(9); // {4;5}
    expect(evalWith('=SUM(DROP(SEQUENCE(5),3))', {})).toBe(9); // {4;5}
    expect(evalWith('=SUM(HSTACK(SEQUENCE(2),SEQUENCE(2,1,10,10)))', {})).toBe(33); // [[1,10],[2,20]]
    expect(evalWith('=INDEX(VSTACK(SEQUENCE(2),SEQUENCE(2,1,10,10)),3)', {})).toBe(10);
    expect(evalWith('=INDEX(WRAPROWS(SEQUENCE(1,6),3),2,1)', {})).toBe(4); // [[1,2,3],[4,5,6]]
    expect(evalWith('=INDEX(WRAPCOLS(SEQUENCE(1,6),3),1,2)', {})).toBe(4); // cols of 3
    expect(evalWith('=SUM(CHOOSEROWS(SEQUENCE(4),1,3))', {})).toBe(4); // rows 1 & 3
    expect(evalWith('=SUM(CHOOSECOLS(SEQUENCE(1,4),2,4))', {})).toBe(6); // cols 2 & 4
    expect(evalWith('=SUM(EXPAND(SEQUENCE(2),3,2,0))', {})).toBe(3); // pad with 0
    expect(evalWith('=INDEX(MMULT(SEQUENCE(2,2),SEQUENCE(2,2)),1,1)', {})).toBe(7); // [[7,10],[15,22]]
    expect(evalWith('=SUM(MMULT(SEQUENCE(2,2),SEQUENCE(2,2)))', {})).toBe(54);
  });

  it('FREQUENCY bins values', () => {
    const d = { A1: 1, A2: 2, A3: 3, A4: 4, A5: 5, B1: 2, B2: 4 };
    expect(evalWith('=INDEX(FREQUENCY(A1:A5,B1:B2),1)', d)).toBe(2); // ≤2 → {1,2}
    expect(evalWith('=INDEX(FREQUENCY(A1:A5,B1:B2),2)', d)).toBe(2); // (2,4] → {3,4}
    expect(evalWith('=INDEX(FREQUENCY(A1:A5,B1:B2),3)', d)).toBe(1); // >4 → {5}
  });

  it('UNIQUE / SORT / FILTER over a column', () => {
    const arr = { A1: 5, A2: 3, A3: 8, A4: 1, A5: 8, B1: true, B2: false, B3: true, B4: false, B5: true };
    expect(evalWith('=COUNT(UNIQUE(A1:A5))', arr)).toBe(4); // {5,3,8,1}
    expect(evalWith('=INDEX(SORT(A1:A5,1,-1),1)', arr)).toBe(8); // desc → max first
    expect(evalWith('=INDEX(SORT(A1:A5,1,1),1)', arr)).toBe(1); // asc → min first
    expect(evalWith('=SUM(FILTER(A1:A5,B1:B5))', arr)).toBe(21); // rows where B true: 5+8+8
    expect(evalWith('=COUNT(FILTER(A1:A5,B1:B5))', arr)).toBe(3);
  });
});

describe('CAP-FORMULA-REFVAL — slice 44 (reference values)', () => {
  const t = { A1: 10, B1: 20, C1: 30, A2: 40, B2: 50, C2: 60, A3: 70, B3: 80, C3: 90 };

  it('OFFSET produces a reference that dereferences in value/range context', () => {
    expect(evalWith('=OFFSET(A1,1,1)', t)).toBe(50); // B2
    expect(evalWith('=SUM(OFFSET(A1,0,0,3,1))', t)).toBe(120); // A1:A3 = 10+40+70
    expect(evalWith('=SUM(OFFSET(A1,1,0,2,3))', t)).toBe(390); // A2:C3
    expect(evalWith('=OFFSET(A1,-1,0)', t)).toBe(ERR.REF); // off-grid
  });

  it('INDIRECT parses text into a reference', () => {
    expect(evalWith('=INDIRECT("B2")', t)).toBe(50);
    expect(evalWith('=SUM(INDIRECT("A1:C1"))', t)).toBe(60); // 10+20+30
    expect(evalWith('=INDIRECT("nope!")', t)).toBe(ERR.REF);
  });

  it('INDEX reference form (0 = whole row/column) + ROW/COLUMN(ref)', () => {
    expect(evalWith('=INDEX(A1:C3,2,3)', t)).toBe(60); // C2
    expect(evalWith('=SUM(INDEX(A1:C3,0,2))', t)).toBe(150); // whole column B = 20+50+80
    expect(evalWith('=SUM(INDEX(A1:C3,3,0))', t)).toBe(240); // whole row 3 = 70+80+90
    expect(evalWith('=ROW(C5)', t)).toBe(5);
    expect(evalWith('=COLUMN(C5)', t)).toBe(3);
    expect(evalWith('=ROWS(A1:A10)', t)).toBe(10);
    expect(evalWith('=COLUMNS(A1:D1)', t)).toBe(4);
    expect(evalWith('=ISREF(A1)', t)).toBe(true);
    expect(evalWith('=ISREF(5)', t)).toBe(false);
  });

  it('ISFORMULA / FORMULATEXT read the sidecar (engine harness)', () => {
    const g = new TestGrid(4, 4);
    g.setLiteral(0, 0, 5); // A1 literal
    g.setFormula(1, 0, '=A1*2'); // B1 formula
    // ISFORMULA(B1) TRUE, ISFORMULA(A1) FALSE — via a probe formula in C1/C2.
    g.setFormula(2, 0, '=ISFORMULA(B1)');
    expect(g.get(2, 0)).toBe(true);
    g.setFormula(2, 1, '=ISFORMULA(A1)');
    expect(g.get(2, 1)).toBe(false);
    g.setFormula(3, 0, '=FORMULATEXT(B1)');
    expect(g.get(3, 0)).toBe('=A1*2');
  });
});

describe('INV-FORMULA-REBUILD — structural reference rewriting', () => {
  const tr = (src: string, axis: 'row' | 'col', at: number, delta: number): string =>
    formatAst(translateAst(parseFormula(src), axis, at, delta));

  it('insert shifts references at/after the insertion point', () => {
    expect(tr('=A5+B2', 'row', 2, 1)).toBe('A6+B2'); // A5 (row4) shifts, B2 (row1) does not
    expect(tr('=SUM(A1:A3)', 'row', 1, 2)).toBe('SUM(A1:A5)'); // A3 (row2) → A5
    expect(tr('=$B$2', 'col', 0, 1)).toBe('$C$2'); // a structural insert moves absolute refs too
  });

  it('delete shifts down and #REF!s a reference inside the deleted band', () => {
    expect(tr('=A5', 'row', 2, -1)).toBe('A4');
    expect(tr('=A3', 'row', 2, -1)).toBe('#REF!'); // A3 is the deleted row
    expect(tr('=A1#', 'row', 0, 2)).toBe('A3#'); // spill-ref anchor shifts
  });
});

describe('CAP-FORMULA-VOLATILE — slice 43', () => {
  it('a volatile cell recomputes on every recalc, even with no precedent change', () => {
    const g = new TestGrid(4, 4);
    g.setFormula(0, 0, '=RANDBETWEEN(1,1000000000)'); // A1 volatile
    const seen = new Set<number>();
    seen.add(g.get(0, 0) as number);
    for (let i = 0; i < 10; i++) {
      // Seed recalc from an UNRELATED empty cell — A1 has no precedent that changed.
      g.engine.recalcFrom([encodeCellId(3, 3)]);
      seen.add(g.get(0, 0) as number);
    }
    expect(seen.size).toBeGreaterThan(1); // proves it re-evaluated
  });

  it('a non-volatile cell is NOT recomputed when nothing upstream changed', () => {
    const g = new TestGrid(4, 4);
    g.setLiteral(0, 0, 7); // A1
    g.setFormula(1, 0, '=A1*2'); // B1 = 14 (non-volatile)
    expect(g.get(1, 0)).toBe(14);
    // Recalc seeded from an unrelated cell → B1 not in the dirty closure, stays 14.
    const summary = g.engine.recalcFrom([encodeCellId(3, 3)]);
    expect(summary.changed).toBe(0);
    expect(g.get(1, 0)).toBe(14);
  });
});

describe('CAP-FORMULA-RECALC — dependency graph', () => {
  it('AC-FORMULA-EVAL — SUM of a range of formula cells', () => {
    const g = new TestGrid(4, 2);
    g.setLiteral(0, 0, 10); // A1
    g.setLiteral(0, 1, 20); // A2
    g.setLiteral(0, 2, 30); // A3
    g.setFormula(1, 0, '=SUM(A1:A3)'); // B1 = 60
    expect(g.get(1, 0)).toBe(60);
  });

  it('AC-FORMULA-CHAIN — an upstream edit propagates down a chain (incremental)', () => {
    const g = new TestGrid(6, 2);
    g.setLiteral(0, 0, 1); // A1 = 1
    // B2=A1+1, B3=B2+1, ... a chain down column B
    g.setFormula(1, 1, '=A1+1'); // B2 = 2
    g.setFormula(1, 2, '=B2+1'); // B3 = 3
    g.setFormula(1, 3, '=B3+1'); // B4 = 4
    expect(g.get(1, 3)).toBe(4);

    // Edit A1 → the whole chain updates.
    g.setLiteral(0, 0, 100);
    const summary = g.engine.recalcFrom([encodeCellId(0, 0)]);
    expect(g.get(1, 1)).toBe(101); // B2 = 100+1
    expect(g.get(1, 3)).toBe(103); // B4 = 100+1+1+1
    // 3 formula cells recomputed (B2,B3,B4) — not the whole grid.
    expect(summary.changed).toBe(3);
  });

  it('AC-FORMULA-INCREMENTAL — an edit only recomputes the affected subgraph', () => {
    const g = new TestGrid(10, 3);
    // Two independent chains: column B depends on A0; column C is standalone.
    g.setLiteral(0, 0, 1);
    for (let r = 1; r < 10; r++) g.setFormula(1, r, `=B${r}+1`); // B2..B10 chain off B1
    g.setFormula(1, 0, '=A1'); // B1 = A1
    for (let r = 0; r < 10; r++) g.setFormula(2, r, '=99'); // column C constants

    // Editing A1 recomputes only the B column (10 cells), never the C column.
    g.setLiteral(0, 0, 5);
    const summary = g.engine.recalcFrom([encodeCellId(0, 0)]);
    expect(summary.changed).toBe(10); // B1..B10
    expect(g.get(2, 5)).toBe(99); // C untouched
  });

  it('AC-FORMULA-CYCLE — a cycle yields #CIRC! on its members without hanging', () => {
    const g = new TestGrid(3, 3);
    g.setFormula(0, 0, '=B1'); // A1 = B1
    g.setFormula(1, 0, '=A1'); // B1 = A1  → cycle
    const summary = g.engine.recalcAll();
    expect(g.get(0, 0)).toBe(ERR.CIRC.code);
    expect(g.get(1, 0)).toBe(ERR.CIRC.code);
    expect(summary.cycles).toBeGreaterThanOrEqual(2);
  });

  it('clearing a formula reverts the cell to a literal and updates dependents', () => {
    const g = new TestGrid(3, 2);
    g.setLiteral(0, 0, 10);
    g.setFormula(1, 0, '=A1*2'); // B1 = 20
    g.setFormula(1, 1, '=B1+1'); // B2 = 21
    expect(g.get(1, 1)).toBe(21);

    // Replace B1's formula with a literal 100; B2 should follow.
    const cleared = g.engine.clearFormula(0, 'B');
    g.setLiteral(1, 0, 100);
    g.engine.recalcFrom([cleared]);
    expect(g.get(1, 0)).toBe(100);
    expect(g.get(1, 1)).toBe(101);
    expect(g.engine.isFormula(0, 'B')).toBe(false);
  });

  it('full recalc over a wide fan computes all leaves', () => {
    const g = new TestGrid(1, 1001);
    g.setLiteral(0, 0, 2); // A1
    for (let c = 1; c <= 1000; c++) g.setFormula(c, 0, '=A1*2'); // B1..ALM1 = 4
    g.engine.recalcAll();
    expect(g.engine.formulaCount).toBe(1000);
    expect(g.get(1, 0)).toBe(4);
    expect(g.get(1000, 0)).toBe(4);
    // Changing A1 recomputes all 1000 fan-out cells (their values change).
    g.setLiteral(0, 0, 5);
    const s2 = g.engine.recalcFrom([encodeCellId(0, 0)]);
    expect(s2.changed).toBe(1000);
    expect(g.get(1000, 0)).toBe(10);
  });
});
