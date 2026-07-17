/**
 * `CAP-FORMULA` AST — the parsed shape of a formula body. Pure data; the
 * evaluator (`formula/evaluator.ts`) walks it, and `collectRefs` walks it to
 * derive a formula's precedents for the dependency graph.
 */
import { formatA1, type CellRefA1, type RangeRefA1 } from './references.js';
import type { FormulaErrorCode } from './values.js';

export type FormulaNode =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'error'; code: FormulaErrorCode }
  | { kind: 'ref'; ref: CellRefA1 }
  | { kind: 'range'; range: RangeRefA1 }
  | { kind: 'unary'; op: '-' | '+'; operand: FormulaNode }
  | { kind: 'percent'; operand: FormulaNode }
  | { kind: 'intersect'; operand: FormulaNode } // `@expr` — implicit intersection (CAP-FORMULA-INTERSECT)
  | { kind: 'binary'; op: BinaryOp; left: FormulaNode; right: FormulaNode }
  | { kind: 'call'; name: string; args: FormulaNode[] }
  | { kind: 'name'; name: string } // a bare identifier: a LET/LAMBDA variable, else #NAME?
  | { kind: 'spillref'; ref: CellRefA1 } // `A1#` — the range that spilled from an anchor
  | { kind: 'missing' }; // an omitted argument (`,,`) — evaluates to blank/null

export type BinaryOp = '+' | '-' | '*' | '/' | '^' | '&' | '=' | '<>' | '<' | '>' | '<=' | '>=';

/** Walk an AST collecting every single-cell ref and range (a formula's precedents). */
export function collectRefs(node: FormulaNode, cells: CellRefA1[], ranges: RangeRefA1[]): void {
  switch (node.kind) {
    case 'ref':
    case 'spillref':
      // A spill anchor is a precedent: the dependent recalcs when the anchor re-spills.
      cells.push(node.ref);
      return;
    case 'range':
      ranges.push(node.range);
      return;
    case 'unary':
    case 'percent':
    case 'intersect':
      collectRefs(node.operand, cells, ranges);
      return;
    case 'binary':
      collectRefs(node.left, cells, ranges);
      collectRefs(node.right, cells, ranges);
      return;
    case 'call':
      for (const a of node.args) collectRefs(a, cells, ranges);
      return;
    default:
      return;
  }
}

/**
 * `INV-FORMULA-REBUILD` — rewrite an AST's references for a structural row/column
 * insert or delete. `axis` is which coordinate shifts, `at` the 0-based insertion
 * index, `delta` the signed count (+ inserted, − removed). A reference inside a
 * deleted band becomes a `#REF!` error node; one at/after `at` shifts by `delta`.
 * (Structural shifts move absolute refs too — the data itself relocated.)
 */
export function translateAst(node: FormulaNode, axis: 'row' | 'col', at: number, delta: number): FormulaNode {
  const shift = (v: number): number | null => {
    if (v < at) return v;
    if (delta < 0 && v < at - delta) return null; // inside the deleted band
    return v + delta;
  };
  const shiftRef = (ref: CellRefA1): CellRefA1 | null => {
    const v = axis === 'row' ? shift(ref.row) : shift(ref.col);
    if (v === null) return null;
    return axis === 'row' ? { ...ref, row: v } : { ...ref, col: v };
  };
  switch (node.kind) {
    case 'ref': {
      const r = shiftRef(node.ref);
      return r ? { kind: 'ref', ref: r } : { kind: 'error', code: '#REF!' };
    }
    case 'spillref': {
      const r = shiftRef(node.ref);
      return r ? { kind: 'spillref', ref: r } : { kind: 'error', code: '#REF!' };
    }
    case 'range': {
      const s = shiftRef(node.range.start);
      const e = shiftRef(node.range.end);
      if (s === null && e === null) return { kind: 'error', code: '#REF!' };
      // A partially-deleted range clamps the deleted endpoint to the survivor.
      return { kind: 'range', range: { start: s ?? (e as CellRefA1), end: e ?? (s as CellRefA1) } };
    }
    case 'unary':
      return { kind: 'unary', op: node.op, operand: translateAst(node.operand, axis, at, delta) };
    case 'percent':
      return { kind: 'percent', operand: translateAst(node.operand, axis, at, delta) };
    case 'intersect':
      return { kind: 'intersect', operand: translateAst(node.operand, axis, at, delta) };
    case 'binary':
      return { kind: 'binary', op: node.op, left: translateAst(node.left, axis, at, delta), right: translateAst(node.right, axis, at, delta) };
    case 'call':
      return { kind: 'call', name: node.name, args: node.args.map((a) => translateAst(a, axis, at, delta)) };
    default:
      return node;
  }
}

/** Serialize an AST back to a formula body string (no leading `=`). */
export function formatAst(node: FormulaNode): string {
  switch (node.kind) {
    case 'num': return String(node.value);
    case 'str': return `"${node.value.replace(/"/g, '""')}"`;
    case 'bool': return node.value ? 'TRUE' : 'FALSE';
    case 'error': return node.code;
    case 'name': return node.name;
    case 'missing': return '';
    case 'ref': return formatA1(node.ref);
    case 'spillref': return `${formatA1(node.ref)}#`;
    case 'range': return `${formatA1(node.range.start)}:${formatA1(node.range.end)}`;
    case 'unary': return `${node.op}${formatAst(node.operand)}`;
    case 'percent': return `${formatAst(node.operand)}%`;
    case 'intersect': return `@${formatAst(node.operand)}`;
    case 'binary': return `${formatAst(node.left)}${node.op}${formatAst(node.right)}`;
    case 'call': return `${node.name}(${node.args.map(formatAst).join(',')})`;
  }
}

/** True if the AST calls any function in `names` (e.g. the volatile set). */
export function astHasCall(node: FormulaNode, names: ReadonlySet<string>): boolean {
  switch (node.kind) {
    case 'call':
      if (names.has(node.name)) return true;
      return node.args.some((a) => astHasCall(a, names));
    case 'unary':
    case 'percent':
    case 'intersect':
      return astHasCall(node.operand, names);
    case 'binary':
      return astHasCall(node.left, names) || astHasCall(node.right, names);
    default:
      return false;
  }
}
