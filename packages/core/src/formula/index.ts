/**
 * `CAP-FORMULA` — public barrel for the formula subsystem. The grid wires the
 * `FormulaEngine` into `IndexEngine`; these exports also serve tooling + tests.
 */
export { FormulaEngine, encodeCellId } from './engine.js';
export type { GridAccess, CellId, RecalcSummary } from './engine.js';
export { parseFormula } from './parser.js';
export { tokenize, FormulaSyntaxError } from './tokenizer.js';
export { evaluate } from './evaluator.js';
export type { CellResolver, EvalResult, RangeValue } from './eval-types.js';
export { FUNCTIONS, FUNCTION_NAMES } from './functions.js';
export {
  FormulaError,
  ERR,
  isError,
  fromRaw,
  toDisplay,
  toNumber,
  toText,
  toBoolean,
} from './values.js';
export type { FormulaValue, FormulaErrorCode } from './values.js';
export {
  colLettersToIndex,
  indexToColLetters,
  parseA1,
  refToA1,
  translateRef,
} from './references.js';
export type { CellRefA1, RangeRefA1 } from './references.js';
export type { FormulaNode } from './ast.js';

/** A formula body is any string whose first non-space char is `=` (and length > 1). */
export function isFormulaSource(value: unknown): value is string {
  return typeof value === 'string' && value.length > 1 && value.charCodeAt(0) === 61 /* '=' */;
}
