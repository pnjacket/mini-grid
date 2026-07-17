/**
 * Shared evaluation types for `CAP-FORMULA` — factored out so the evaluator and
 * the function library can both depend on them without an import cycle.
 */
import type { FormulaNode } from './ast.js';
import type { CellRefA1, RangeRefA1 } from './references.js';
import { FormulaError, type FormulaValue } from './values.js';

export interface RangeValue {
  kind: 'range';
  values: FormulaValue[];
  rows: number;
  cols: number;
}

/**
 * `CAP-FORMULA-REFVAL` — a lazy rectangular reference (an *address*, not yet a
 * value). Produced by `ref`/`range` nodes and by `OFFSET`/`INDIRECT`/`INDEX`; the
 * evaluator dereferences it to a value/`RangeValue` at any non-reference-aware
 * boundary. Coordinates are 0-based canonical positions.
 */
export interface ReferenceValue {
  kind: 'reference';
  top: number;
  left: number;
  rows: number;
  cols: number;
}

/**
 * `CAP-FORMULA-ARRAY` (LAMBDA) — a closure: parameter names + an unevaluated body
 * AST + the lexical scope captured at definition. Flows as a value (LET-bound,
 * passed to MAP/REDUCE/…); in a plain value position it collapses to `#CALC!`.
 */
export interface LambdaValue {
  kind: 'lambda';
  params: string[];
  body: FormulaNode;
  captured: ReadonlyMap<string, EvalResult>;
}

export type EvalResult = FormulaValue | RangeValue | ReferenceValue | LambdaValue;

export function isRange(r: EvalResult | undefined): r is RangeValue {
  return (
    typeof r === 'object' &&
    r !== null &&
    !(r instanceof FormulaError) &&
    (r as RangeValue).kind === 'range'
  );
}

export function isReference(r: EvalResult | undefined): r is ReferenceValue {
  return (
    typeof r === 'object' &&
    r !== null &&
    !(r instanceof FormulaError) &&
    (r as ReferenceValue).kind === 'reference'
  );
}

export function isLambda(r: EvalResult | undefined): r is LambdaValue {
  return (
    typeof r === 'object' &&
    r !== null &&
    !(r instanceof FormulaError) &&
    (r as LambdaValue).kind === 'lambda'
  );
}

/** Scope for LET/LAMBDA variable bindings, chained lexically. */
export type Scope = ReadonlyMap<string, EvalResult>;

/** The grid access surface an evaluation needs. */
export interface CellResolver {
  getValue(ref: CellRefA1): FormulaValue;
  getRange(range: RangeRefA1): RangeValue;
  /** 1-based position of the formula's own cell (for `ROW()`/`COLUMN()`). */
  currentRow: number;
  currentCol: number;
  /** Injected clock for `TODAY`/`NOW` (kept out of the evaluator for testability). */
  now(): Date;
  /**
   * `CAP-FORMULA-REFVAL` — the raw `=…` source at a canonical position if it is a
   * formula cell, else `undefined` (for `ISFORMULA`/`FORMULATEXT`). Optional so
   * one-shot resolvers (`LIB-FORMULA-EVAL`) can omit it.
   */
  formulaSourceAt?(col: number, row: number): string | undefined;
  /** Grid extent, for reference-producing functions to clamp/validate (optional). */
  colCount?(): number;
  rowCount?(): number;
  /**
   * `COMPONENT-I18N` — the active BCP-47 locale for locale-aware text functions
   * (`FIXED`/`DOLLAR`/`TEXT`). Optional; defaults to `en-US` when absent.
   */
  locale?: string;
  /**
   * `CAP-FORMULA-ARRAY` — the spill extent `{rows, cols}` anchored at a canonical
   * position, or `undefined` if the cell is not a spill anchor (for the `A1#`
   * spill-reference operator). Optional.
   */
  spillExtentAt?(col: number, row: number): { rows: number; cols: number } | undefined;
}

/** Context handed to each library function. */
export interface FnContext {
  resolver: CellResolver;
  /**
   * Apply a `LambdaValue` to argument values — lets a registry function invoke a
   * lambda argument (e.g. `GROUPBY(..., LAMBDA(v, SUM(v)))`). Provided by the
   * evaluator; optional so one-shot callers can omit it.
   */
  applyLambda?(lam: LambdaValue, argv: EvalResult[]): EvalResult;
}

/** A library function: raw arg results in, a value/range/reference out. */
export type FormulaFn = (args: EvalResult[], ctx: FnContext) => EvalResult;
