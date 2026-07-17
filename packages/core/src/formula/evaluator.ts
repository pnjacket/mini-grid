/**
 * `CAP-FORMULA` evaluator — a pure AST interpreter (honours `SEC-FORMULA-NO-EVAL`:
 * no `eval`/`new Function`). Cell/range access is abstracted behind `CellResolver`
 * so the same evaluator serves the grid engine and one-shot tooling
 * (`LIB-FORMULA-EVAL`).
 */
import type { FormulaNode } from './ast.js';
import {
  ERR,
  FormulaError,
  compareValues,
  isError,
  toNumber,
  toText,
  type FormulaValue,
} from './values.js';
import { isLambda, isRange, isReference, type CellResolver, type EvalResult, type LambdaValue, type RangeValue, type ReferenceValue, type Scope } from './eval-types.js';
import { FUNCTIONS, REF_AWARE_FUNCTIONS } from './functions.js';

const EMPTY_SCOPE: Scope = new Map();
/**
 * Sentinel for an **omitted** LAMBDA argument (`ISOMITTED`). It lives only in a
 * lambda's binding scope; `deref` coerces it to blank (`null`) everywhere a value
 * is consumed, so an omitted optional parameter behaves as blank — only `ISOMITTED`
 * detects it (by identity, before deref).
 */
const OMITTED = { omitted: true } as unknown as EvalResult;
/** `CAP-FORMULA-ARRAY` — special forms handled by the evaluator itself (they need
 * unevaluated argument ASTs and a variable scope, not eager values). */
const SPECIAL_FORMS = new Set(['LET', 'LAMBDA', 'MAP', 'REDUCE', 'SCAN', 'BYROW', 'BYCOL', 'MAKEARRAY', 'ISOMITTED']);

export { isRange } from './eval-types.js';
export type { CellResolver, EvalResult, RangeValue, FnContext, FormulaFn } from './eval-types.js';

/** Evaluate a formula AST to a scalar `FormulaValue` (a range in scalar position → `#VALUE!`). */
export function evaluate(node: FormulaNode, resolver: CellResolver): FormulaValue {
  const r = deref(evalNode(node, resolver, EMPTY_SCOPE), resolver);
  if (isRange(r)) return ERR.VALUE;
  if (isLambda(r)) return ERR.CALC;
  return r as FormulaValue;
}

/**
 * `CAP-FORMULA-ARRAY` — evaluate to a raw `EvalResult` (may be a `RangeValue`
 * array). Used by the engine's spill materialization; a lambda in the top
 * position collapses to `#CALC!`.
 */
export function evaluateResult(node: FormulaNode, resolver: CellResolver): EvalResult {
  const r = deref(evalNode(node, resolver, EMPTY_SCOPE), resolver);
  return isLambda(r) ? ERR.CALC : r;
}

/** `CAP-FORMULA-REFVAL` — resolve a lazy reference to a value (1×1) or `RangeValue`. */
function deref(r: EvalResult, resolver: CellResolver): EvalResult {
  if (r === OMITTED) return null; // an omitted lambda arg reads as blank everywhere but ISOMITTED
  if (!isReference(r)) return r;
  const ref = r as ReferenceValue;
  if (ref.rows === 1 && ref.cols === 1) {
    return resolver.getValue({ col: ref.left, row: ref.top, colAbs: false, rowAbs: false });
  }
  return resolver.getRange({
    start: { col: ref.left, row: ref.top, colAbs: false, rowAbs: false },
    end: { col: ref.left + ref.cols - 1, row: ref.top + ref.rows - 1, colAbs: false, rowAbs: false },
  });
}

function evalNode(node: FormulaNode, resolver: CellResolver, scope: Scope): EvalResult {
  switch (node.kind) {
    case 'num':
      return node.value;
    case 'missing':
      return null; // an omitted argument
    case 'str':
      return node.value;
    case 'bool':
      return node.value;
    case 'error':
      return FormulaError.of(node.code);
    case 'name': {
      // A LET/LAMBDA variable, else #NAME?.
      const v = scope.get(node.name);
      return v === undefined ? ERR.NAME : v;
    }
    case 'ref':
      // A lazy reference — dereferenced at any non-reference-aware boundary.
      return { kind: 'reference', top: node.ref.row, left: node.ref.col, rows: 1, cols: 1 };
    case 'spillref': {
      // `A1#` — the range that spilled from the anchor (1×1 if it doesn't spill).
      const ext = resolver.spillExtentAt?.(node.ref.col, node.ref.row);
      return { kind: 'reference', top: node.ref.row, left: node.ref.col, rows: ext?.rows ?? 1, cols: ext?.cols ?? 1 };
    }
    case 'range': {
      const top = Math.min(node.range.start.row, node.range.end.row);
      const left = Math.min(node.range.start.col, node.range.end.col);
      const rows = Math.abs(node.range.end.row - node.range.start.row) + 1;
      const cols = Math.abs(node.range.end.col - node.range.start.col) + 1;
      return { kind: 'reference', top, left, rows, cols };
    }
    case 'unary': {
      const v = scalar(evalNode(node.operand, resolver, scope), resolver);
      if (isError(v)) return v;
      const n = toNumber(v);
      if (isError(n)) return n;
      return node.op === '-' ? -n : n;
    }
    case 'percent': {
      const v = scalar(evalNode(node.operand, resolver, scope), resolver);
      if (isError(v)) return v;
      const n = toNumber(v);
      if (isError(n)) return n;
      return n / 100;
    }
    case 'intersect': {
      // `@expr` — implicit intersection (CAP-FORMULA-INTERSECT; INV-INTERSECT-SCALAR:
      // always a scalar, never spills). A reference intersects the formula's own row/col.
      const r = evalNode(node.operand, resolver, scope);
      if (isReference(r)) {
        const ref = r as ReferenceValue;
        if (ref.rows === 1 && ref.cols === 1) {
          return resolver.getValue({ col: ref.left, row: ref.top, colAbs: false, rowAbs: false });
        }
        const row0 = resolver.currentRow - 1;
        const col0 = resolver.currentCol - 1;
        let pickRow: number;
        let pickCol: number;
        if (ref.cols === 1) {
          if (row0 < ref.top || row0 >= ref.top + ref.rows) return ERR.VALUE;
          pickRow = row0;
          pickCol = ref.left;
        } else if (ref.rows === 1) {
          if (col0 < ref.left || col0 >= ref.left + ref.cols) return ERR.VALUE;
          pickRow = ref.top;
          pickCol = col0;
        } else {
          if (row0 < ref.top || row0 >= ref.top + ref.rows || col0 < ref.left || col0 >= ref.left + ref.cols) return ERR.VALUE;
          pickRow = row0;
          pickCol = col0;
        }
        return resolver.getValue({ col: pickCol, row: pickRow, colAbs: false, rowAbs: false });
      }
      const d = deref(r, resolver);
      if (isRange(d)) {
        const rg = d as RangeValue;
        return (rg.values.length ? rg.values[0] : ERR.VALUE) as FormulaValue;
      }
      if (isLambda(d)) return ERR.CALC;
      return d as FormulaValue;
    }
    case 'binary':
      return evalBinary(node.op, deref(evalNode(node.left, resolver, scope), resolver), deref(evalNode(node.right, resolver, scope), resolver));
    case 'call': {
      if (SPECIAL_FORMS.has(node.name)) return evalSpecialForm(node.name, node.args, resolver, scope);
      // A scope-bound lambda called as `f(...)`.
      const bound = scope.get(node.name);
      if (bound !== undefined && isLambda(bound)) {
        // An explicitly-omitted arg (`f(5,)`) binds OMITTED so ISOMITTED can see it.
        const argv = node.args.map((a) => (a.kind === 'missing' ? OMITTED : deref(evalNode(a, resolver, scope), resolver)));
        return applyLambda(bound, argv, resolver);
      }
      const fn = FUNCTIONS[node.name];
      if (!fn) return ERR.NAME;
      const refAware = REF_AWARE_FUNCTIONS.has(node.name);
      const args = node.args.map((a) => {
        const r = evalNode(a, resolver, scope);
        return refAware ? r : deref(r, resolver); // ordinary functions get values/ranges
      });
      return fn(args, { resolver, applyLambda: (lam, argv) => applyLambda(lam, argv, resolver) });
    }
  }
}

/** Collapse a lambda result to a single `FormulaValue` (array/lambda → `#CALC!`). */
function collapse(r: EvalResult, resolver: CellResolver): FormulaValue {
  const d = deref(r, resolver);
  return isRange(d) || isLambda(d) ? ERR.CALC : (d as FormulaValue);
}

/** Apply a `LambdaValue` to already-dereferenced argument values. */
function applyLambda(lam: LambdaValue, argv: EvalResult[], resolver: CellResolver): EvalResult {
  const inner = new Map(lam.captured);
  lam.params.forEach((p, i) => inner.set(p, i < argv.length ? (argv[i] as EvalResult) : OMITTED));
  return evalNode(lam.body, resolver, inner);
}

/** Coerce any result to a `RangeValue` (a scalar/reference → a 1×1 array). */
function asRange(r: EvalResult, resolver: CellResolver): RangeValue {
  const d = deref(r, resolver);
  if (isRange(d)) return d;
  return { kind: 'range', values: [isLambda(d) ? ERR.CALC : (d as never)], rows: 1, cols: 1 };
}

function evalSpecialForm(name: string, args: FormulaNode[], resolver: CellResolver, scope: Scope): EvalResult {
  switch (name) {
    case 'ISOMITTED': {
      // TRUE iff the (single) argument is an omitted LAMBDA parameter. Evaluated
      // WITHOUT deref so the OMITTED sentinel survives to be detected by identity.
      if (args.length !== 1) return ERR.VALUE;
      return evalNode(args[0] as FormulaNode, resolver, scope) === OMITTED;
    }
    case 'LET': {
      // args = [name1, val1, name2, val2, …, calc]  (odd count ≥ 3)
      if (args.length < 3 || args.length % 2 === 0) return ERR.VALUE;
      const inner = new Map(scope);
      for (let i = 0; i + 1 < args.length - 1; i += 2) {
        const nameNode = args[i] as FormulaNode;
        if (nameNode.kind !== 'name') return ERR.NAME;
        inner.set(nameNode.name, evalNode(args[i + 1] as FormulaNode, resolver, inner));
      }
      return evalNode(args[args.length - 1] as FormulaNode, resolver, inner);
    }
    case 'LAMBDA': {
      // args = [param1, …, paramN, body]
      if (args.length < 1) return ERR.VALUE;
      const params: string[] = [];
      for (let i = 0; i < args.length - 1; i++) {
        const p = args[i] as FormulaNode;
        if (p.kind !== 'name') return ERR.NAME;
        params.push(p.name);
      }
      return { kind: 'lambda', params, body: args[args.length - 1] as FormulaNode, captured: new Map(scope) };
    }
    case 'MAP': {
      // MAP(array1, …, lambda) — element-wise.
      if (args.length < 2) return ERR.VALUE;
      const lam = evalNode(args[args.length - 1] as FormulaNode, resolver, scope);
      if (!isLambda(lam)) return ERR.CALC;
      const arrays = args.slice(0, -1).map((a) => asRange(evalNode(a, resolver, scope), resolver));
      const first = arrays[0] as RangeValue;
      const out: FormulaValue[] = [];
      for (let i = 0; i < first.values.length; i++) {
        const callArgs = arrays.map((ar) => (ar.values[i] ?? null) as EvalResult);
        out.push(collapse(applyLambda(lam, callArgs, resolver), resolver));
      }
      return { kind: 'range', values: out, rows: first.rows, cols: first.cols };
    }
    case 'REDUCE': {
      // REDUCE(init, array, lambda(acc, value))
      if (args.length !== 3) return ERR.VALUE;
      let acc = deref(evalNode(args[0] as FormulaNode, resolver, scope), resolver);
      const arr = asRange(evalNode(args[1] as FormulaNode, resolver, scope), resolver);
      const lam = evalNode(args[2] as FormulaNode, resolver, scope);
      if (!isLambda(lam)) return ERR.CALC;
      for (const v of arr.values) acc = deref(applyLambda(lam, [acc, v as EvalResult], resolver), resolver);
      return acc;
    }
    case 'SCAN': {
      // SCAN(init, array, lambda) — like REDUCE but emit each intermediate.
      if (args.length !== 3) return ERR.VALUE;
      let acc = deref(evalNode(args[0] as FormulaNode, resolver, scope), resolver);
      const arr = asRange(evalNode(args[1] as FormulaNode, resolver, scope), resolver);
      const lam = evalNode(args[2] as FormulaNode, resolver, scope);
      if (!isLambda(lam)) return ERR.CALC;
      const out: FormulaValue[] = [];
      for (const v of arr.values) {
        acc = deref(applyLambda(lam, [acc, v as EvalResult], resolver), resolver);
        out.push(isRange(acc) || isLambda(acc) ? ERR.CALC : (acc as FormulaValue));
      }
      return { kind: 'range', values: out, rows: arr.rows, cols: arr.cols };
    }
    case 'BYROW':
    case 'BYCOL': {
      if (args.length !== 2) return ERR.VALUE;
      const arr = asRange(evalNode(args[0] as FormulaNode, resolver, scope), resolver);
      const lam = evalNode(args[1] as FormulaNode, resolver, scope);
      if (!isLambda(lam)) return ERR.CALC;
      const out: FormulaValue[] = [];
      const byRow = name === 'BYROW';
      const outer = byRow ? arr.rows : arr.cols;
      const inner = byRow ? arr.cols : arr.rows;
      for (let a = 0; a < outer; a++) {
        const line: FormulaValue[] = [];
        for (let b = 0; b < inner; b++) {
          const idx = byRow ? a * arr.cols + b : b * arr.cols + a;
          line.push(arr.values[idx] as FormulaValue);
        }
        const lineRange: RangeValue = { kind: 'range', values: line, rows: byRow ? 1 : inner, cols: byRow ? inner : 1 };
        out.push(collapse(applyLambda(lam, [lineRange], resolver), resolver));
      }
      return { kind: 'range', values: out, rows: byRow ? outer : 1, cols: byRow ? 1 : outer };
    }
    case 'MAKEARRAY': {
      // MAKEARRAY(rows, cols, lambda(r, c))
      if (args.length !== 3) return ERR.VALUE;
      const rowsV = toNumber(scalar(evalNode(args[0] as FormulaNode, resolver, scope), resolver));
      if (isError(rowsV)) return rowsV;
      const colsV = toNumber(scalar(evalNode(args[1] as FormulaNode, resolver, scope), resolver));
      if (isError(colsV)) return colsV;
      const lam = evalNode(args[2] as FormulaNode, resolver, scope);
      if (!isLambda(lam)) return ERR.CALC;
      const R = Math.trunc(rowsV);
      const C = Math.trunc(colsV);
      if (R < 1 || C < 1) return ERR.VALUE;
      const out: FormulaValue[] = [];
      for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
        out.push(collapse(applyLambda(lam, [r + 1, c + 1], resolver), resolver));
      }
      return { kind: 'range', values: out, rows: R, cols: C };
    }
    default:
      return ERR.NAME;
  }
}

/** Collapse a reference/range/lambda in scalar position to a value or an error. */
function scalar(r: EvalResult, resolver: CellResolver): FormulaValue {
  const d = deref(r, resolver);
  if (isRange(d)) return ERR.VALUE;
  if (isLambda(d)) return ERR.CALC;
  return d as FormulaValue;
}

function evalBinary(op: string, leftR: EvalResult, rightR: EvalResult): FormulaValue {
  // Operands are already dereferenced by the caller; only a range stays as-is.
  const left = isRange(leftR) ? ERR.VALUE : (leftR as FormulaValue);
  const right = isRange(rightR) ? ERR.VALUE : (rightR as FormulaValue);
  if (isError(left)) return left;
  if (isError(right)) return right;

  if (op === '&') {
    const a = toText(left);
    if (isError(a)) return a;
    const b = toText(right);
    if (isError(b)) return b;
    return a + b;
  }

  if (op === '=' || op === '<>' || op === '<' || op === '>' || op === '<=' || op === '>=') {
    const c = compareValues(left, right);
    switch (op) {
      case '=': return c === 0;
      case '<>': return c !== 0;
      case '<': return c < 0;
      case '>': return c > 0;
      case '<=': return c <= 0;
      case '>=': return c >= 0;
    }
  }

  const a = toNumber(left);
  if (isError(a)) return a;
  const b = toNumber(right);
  if (isError(b)) return b;
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return b === 0 ? ERR.DIV0 : a / b;
    case '^': {
      const p = Math.pow(a, b);
      return Number.isFinite(p) ? p : ERR.NUM;
    }
  }
  return ERR.VALUE;
}
