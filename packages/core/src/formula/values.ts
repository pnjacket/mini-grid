/**
 * `ENTITY-FORMULA-ERROR` + the value model shared by the formula front-end and
 * evaluator (`CAP-FORMULA`). A `FormulaValue` is what a cell computes to; a
 * `FormulaError` is a **typed sentinel** (never a bare string) so a *literal*
 * text cell holding `"#REF!"` is not mistaken for an error.
 */

/** The Excel-style error codes surfaced by `CAP-FORMULA` (incl. the spill pair). */
export type FormulaErrorCode =
  | '#DIV/0!'
  | '#VALUE!'
  | '#NAME?'
  | '#REF!'
  | '#N/A'
  | '#NUM!'
  | '#CIRC!'
  | '#SPILL!'
  | '#CALC!';

/** A typed error sentinel (interned per code — `ENTITY-FORMULA-ERROR`). */
export class FormulaError {
  private constructor(readonly code: FormulaErrorCode) {}
  private static readonly cache = new Map<FormulaErrorCode, FormulaError>();
  static of(code: FormulaErrorCode): FormulaError {
    let e = FormulaError.cache.get(code);
    if (!e) {
      e = new FormulaError(code);
      FormulaError.cache.set(code, e);
    }
    return e;
  }
  toString(): string {
    return this.code;
  }
}

export const ERR = {
  DIV0: FormulaError.of('#DIV/0!'),
  VALUE: FormulaError.of('#VALUE!'),
  NAME: FormulaError.of('#NAME?'),
  REF: FormulaError.of('#REF!'),
  NA: FormulaError.of('#N/A'),
  NUM: FormulaError.of('#NUM!'),
  CIRC: FormulaError.of('#CIRC!'),
  SPILL: FormulaError.of('#SPILL!'), // CAP-FORMULA-ARRAY: a blocked spill range
  CALC: FormulaError.of('#CALC!'), // CAP-FORMULA-ARRAY: empty-array / uncomputable
} as const;

/** A scalar cell result. */
export type FormulaValue = number | string | boolean | null | FormulaError;

export function isError(v: unknown): v is FormulaError {
  return v instanceof FormulaError;
}

const ERROR_CODES = new Set<string>(['#DIV/0!', '#VALUE!', '#NAME?', '#REF!', '#N/A', '#NUM!', '#CIRC!', '#SPILL!', '#CALC!']);

/**
 * Coerce a raw host cell value (from `row.data[field]`) into a `FormulaValue`.
 * A string that exactly matches an error code is treated as that error (the
 * documented round-trip convention for cross-cell error propagation).
 */
export function fromRaw(v: unknown): FormulaValue {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : ERR.NUM;
  if (typeof v === 'boolean') return v;
  if (v instanceof FormulaError) return v;
  if (typeof v === 'string') return ERROR_CODES.has(v) ? FormulaError.of(v as FormulaErrorCode) : v;
  if (v instanceof Date) return v.getTime();
  return String(v);
}

/** Project a computed `FormulaValue` to a display-friendly value stored in `data[field]`. */
export function toDisplay(v: FormulaValue): number | string | boolean | null {
  if (v instanceof FormulaError) return v.code;
  return v;
}

/** Coerce to a number (Excel rules); returns a `FormulaError` on failure/propagation. */
export function toNumber(v: FormulaValue): number | FormulaError {
  if (isError(v)) return v;
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const s = v.trim();
  if (s === '') return 0;
  // Percentage literal like "50%".
  if (/^[-+]?\d*\.?\d+%$/.test(s)) return Number(s.slice(0, -1)) / 100;
  const n = Number(s);
  return Number.isFinite(n) ? n : ERR.VALUE;
}

/** Coerce to text (Excel rules); propagates errors. */
export function toText(v: FormulaValue): string | FormulaError {
  if (isError(v)) return v;
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return numberToText(v);
  return v;
}

/** Coerce to boolean (Excel rules); propagates errors. */
export function toBoolean(v: FormulaValue): boolean | FormulaError {
  if (isError(v)) return v;
  if (v == null) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = v.trim().toUpperCase();
  if (s === 'TRUE') return true;
  if (s === 'FALSE') return false;
  if (s === '') return false;
  return ERR.VALUE;
}

/** Default number → text projection (no thousands separators; up to 10 sig digits). */
export function numberToText(n: number): string {
  if (Number.isInteger(n)) return String(n);
  // Trim floating noise the way a spreadsheet does for display.
  return String(Math.round(n * 1e10) / 1e10);
}

/** `true` when the value is "blank" for COUNTA / ISBLANK purposes. */
export function isBlank(v: FormulaValue): boolean {
  return v == null || v === '';
}

/**
 * Excel-style scalar comparison → -1 / 0 / 1, with cross-type ranking
 * (number < text < boolean). Text compares case-insensitively. Errors are
 * handled by the caller before this is reached.
 */
export function compareValues(a: FormulaValue, b: FormulaValue): number {
  const ra = typeRank(a);
  const rb = typeRank(b);
  if (ra !== rb) return ra < rb ? -1 : 1;
  if (ra === 0) {
    const na = a as number;
    const nb = b as number;
    return na < nb ? -1 : na > nb ? 1 : 0;
  }
  if (ra === 1) {
    const sa = (a as string).toUpperCase();
    const sb = (b as string).toUpperCase();
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  }
  // boolean
  const ba = a ? 1 : 0;
  const bb = b ? 1 : 0;
  return ba - bb;
}

function typeRank(v: FormulaValue): number {
  if (v == null) return 0; // empty ranks with number 0 for comparison
  if (typeof v === 'number') return 0;
  if (typeof v === 'string') return 1;
  return 2; // boolean
}
