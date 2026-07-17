/**
 * `CAP-FORMULA-FN` — the built-in function library (475 registry functions across
 * math/trig, statistical, financial, date/time, text, logical, lookup/ref, info,
 * engineering, database; `LET`/`LAMBDA`/`MAP`/… are evaluator special forms).
 * Each function is `(args, ctx) => EvalResult`; args arrive as already-evaluated
 * `EvalResult`s (scalars, ranges, or — for `REF_AWARE_FUNCTIONS` — references).
 * Errors propagate unless explicitly trapped (`IFERROR`/`IFNA`/`IS*`).
 */
import {
  ERR,
  FormulaError,
  compareValues,
  isBlank,
  isError,
  numberToText,
  toBoolean,
  toNumber,
  toText,
  type FormulaValue,
} from './values.js';
import { isLambda, isRange, isReference, type EvalResult, type FnContext, type FormulaFn, type RangeValue, type ReferenceValue } from './eval-types.js';
import { indexToColLetters, looksLikeA1, parseA1 } from './references.js';

// ---------------------------------------------------------------------------
// Argument helpers
// ---------------------------------------------------------------------------

function argAt(args: EvalResult[], i: number): EvalResult | undefined {
  return args[i];
}

/** Reduce an arg to a scalar (a 1-cell range acts as a scalar; larger → `#VALUE!`). */
function scalarOf(arg: EvalResult | undefined): FormulaValue {
  if (arg === undefined) return null;
  if (isReference(arg)) return ERR.REF; // ordinary fns receive dereferenced values
  if (isLambda(arg)) return ERR.CALC;
  if (isRange(arg)) {
    if (arg.values.length === 1) return arg.values[0] as FormulaValue;
    return ERR.VALUE;
  }
  return arg;
}

function numAt(args: EvalResult[], i: number): number | FormulaError {
  const v = scalarOf(argAt(args, i));
  if (isError(v)) return v;
  return toNumber(v);
}

function textAt(args: EvalResult[], i: number): string | FormulaError {
  const v = scalarOf(argAt(args, i));
  if (isError(v)) return v;
  return toText(v);
}

/** Collect numeric values across args: ranges contribute numbers only; scalars coerce. */
function collectNumbers(args: EvalResult[]): number[] | FormulaError {
  const out: number[] = [];
  for (const arg of args) {
    if (isRange(arg)) {
      for (const v of arg.values) {
        if (isError(v)) return v;
        if (typeof v === 'number') out.push(v);
      }
    } else if (isReference(arg) || isLambda(arg)) {
      return ERR.REF;
    } else {
      if (isError(arg)) return arg;
      const n = toNumber(arg);
      if (isError(n)) return n;
      out.push(n);
    }
  }
  return out;
}

/** Flatten all values (ranges expanded), keeping blanks/text/bools/errors as-is. */
function flatValues(args: EvalResult[]): FormulaValue[] {
  const out: FormulaValue[] = [];
  for (const arg of args) {
    if (isRange(arg)) out.push(...arg.values);
    else if (isReference(arg) || isLambda(arg)) out.push(ERR.REF);
    else out.push(arg);
  }
  return out;
}

function firstError(vals: FormulaValue[]): FormulaError | null {
  for (const v of vals) if (isError(v)) return v;
  return null;
}

// ---------------------------------------------------------------------------
// Criteria (SUMIF / COUNTIF / AVERAGEIF)
// ---------------------------------------------------------------------------

const CRITERIA_RE = /^(>=|<=|<>|>|<|=)?(.*)$/;

/** A compiled criteria test: `(cellValue) => boolean`. */
type CriteriaPred = (v: FormulaValue) => boolean;

/** Map a comparison operator to an `(order) => boolean` test (built once per call). */
function cmpForOp(op: string): (c: number) => boolean {
  switch (op) {
    case '>': return (c) => c > 0;
    case '<': return (c) => c < 0;
    case '>=': return (c) => c >= 0;
    case '<=': return (c) => c <= 0;
    case '<>': return (c) => c !== 0;
    default: return (c) => c === 0;
  }
}

/**
 * Compile a `COUNTIF`/`SUMIF`/`AVERAGEIF` criteria **once** (the criteria is
 * loop-invariant) into a per-cell predicate. Hoists the regex parse + `Number`
 * coercion out of the range loop; a numeric right-hand side takes a fast path that
 * skips `compareValues`/`typeRank`. Byte-identical to the prior `matchCriteria`
 * (a non-number cell still ranks above a number, so `">5"` matches text — Excel's
 * type-rank quirk — and blanks compare as `0`).
 */
function compileCriteria(criteria: FormulaValue): CriteriaPred {
  let op = '=';
  let rhs: FormulaValue = criteria;
  if (typeof criteria === 'string') {
    const m = CRITERIA_RE.exec(criteria);
    op = m?.[1] || '=';
    const rhsText = (m?.[2] ?? '').trim();
    const rhsNum = Number(rhsText);
    rhs = rhsText !== '' && Number.isFinite(rhsNum) ? rhsNum : rhsText;
  }
  const cmp = cmpForOp(op);
  if (typeof rhs === 'number') {
    const r = rhs;
    // Fast path: rhs is numeric → compare without compareValues/typeRank.
    const rankAbove = r > 0 ? -1 : r < 0 ? 1 : 0; // where a blank (0) lands vs r
    return (v) => {
      if (typeof v === 'number') return cmp(v < r ? -1 : v > r ? 1 : 0);
      if (v == null) return cmp(rankAbove);
      if (v instanceof FormulaError) return false;
      return cmp(1); // string/boolean rank above any number
    };
  }
  return (v) => (v instanceof FormulaError ? false : cmp(compareValues(v, rhs)));
}

// ---------------------------------------------------------------------------
// Math / aggregation
// ---------------------------------------------------------------------------

const SUM: FormulaFn = (args) => {
  const nums = collectNumbers(args);
  if (isError(nums)) return nums;
  let s = 0;
  for (const n of nums) s += n;
  return s;
};

const PRODUCT: FormulaFn = (args) => {
  const nums = collectNumbers(args);
  if (isError(nums)) return nums;
  if (nums.length === 0) return 0;
  let p = 1;
  for (const n of nums) p *= n;
  return p;
};

const AVERAGE: FormulaFn = (args) => {
  const nums = collectNumbers(args);
  if (isError(nums)) return nums;
  if (nums.length === 0) return ERR.DIV0;
  let s = 0;
  for (const n of nums) s += n;
  return s / nums.length;
};

const SUMSQ: FormulaFn = (args) => {
  const nums = collectNumbers(args);
  if (isError(nums)) return nums;
  let s = 0;
  for (const n of nums) s += n * n;
  return s;
};

const COUNT: FormulaFn = (args) => {
  let c = 0;
  for (const arg of args) {
    if (isRange(arg)) {
      for (const v of arg.values) if (typeof v === 'number') c++;
    } else if (!isReference(arg) && !isLambda(arg) && !isError(arg)) {
      const n = toNumber(arg);
      if (!isError(n)) c++;
    }
  }
  return c;
};

const COUNTA: FormulaFn = (args) => {
  let c = 0;
  for (const v of flatValues(args)) if (!isBlank(v)) c++;
  return c;
};

const MINFN: FormulaFn = (args) => {
  const nums = collectNumbers(args);
  if (isError(nums)) return nums;
  if (nums.length === 0) return 0;
  let m = nums[0] as number;
  for (const n of nums) if (n < m) m = n;
  return m;
};

const MAXFN: FormulaFn = (args) => {
  const nums = collectNumbers(args);
  if (isError(nums)) return nums;
  if (nums.length === 0) return 0;
  let m = nums[0] as number;
  for (const n of nums) if (n > m) m = n;
  return m;
};

const unaryNum = (f: (n: number) => number | FormulaError): FormulaFn => (args) => {
  const n = numAt(args, 0);
  if (isError(n)) return n;
  return f(n);
};

const ROUND: FormulaFn = (args) => {
  const n = numAt(args, 0);
  if (isError(n)) return n;
  const d = args.length > 1 ? numAt(args, 1) : 0;
  if (isError(d)) return d;
  const f = Math.pow(10, Math.trunc(d));
  return Math.round((n + Number.EPSILON * Math.sign(n)) * f) / f;
};
const ROUNDUP: FormulaFn = (args) => {
  const n = numAt(args, 0);
  if (isError(n)) return n;
  const d = args.length > 1 ? numAt(args, 1) : 0;
  if (isError(d)) return d;
  const f = Math.pow(10, Math.trunc(d));
  return (n < 0 ? -Math.ceil(-n * f) : Math.ceil(n * f)) / f;
};
const ROUNDDOWN: FormulaFn = (args) => {
  const n = numAt(args, 0);
  if (isError(n)) return n;
  const d = args.length > 1 ? numAt(args, 1) : 0;
  if (isError(d)) return d;
  const f = Math.pow(10, Math.trunc(d));
  return (n < 0 ? -Math.floor(-n * f) : Math.floor(n * f)) / f;
};

const POWERFN: FormulaFn = (args) => {
  const a = numAt(args, 0);
  if (isError(a)) return a;
  const b = numAt(args, 1);
  if (isError(b)) return b;
  const p = Math.pow(a, b);
  return Number.isFinite(p) ? p : ERR.NUM;
};

const MODFN: FormulaFn = (args) => {
  const a = numAt(args, 0);
  if (isError(a)) return a;
  const b = numAt(args, 1);
  if (isError(b)) return b;
  if (b === 0) return ERR.DIV0;
  // Excel MOD result takes the sign of the divisor.
  return a - b * Math.floor(a / b);
};

const CEILINGFN: FormulaFn = (args) => {
  const n = numAt(args, 0);
  if (isError(n)) return n;
  const sig = args.length > 1 ? numAt(args, 1) : 1;
  if (isError(sig)) return sig;
  if (sig === 0) return 0;
  return Math.ceil(n / sig) * sig;
};
const FLOORFN: FormulaFn = (args) => {
  const n = numAt(args, 0);
  if (isError(n)) return n;
  const sig = args.length > 1 ? numAt(args, 1) : 1;
  if (isError(sig)) return sig;
  if (sig === 0) return ERR.DIV0;
  return Math.floor(n / sig) * sig;
};

const LOGFN: FormulaFn = (args) => {
  const n = numAt(args, 0);
  if (isError(n)) return n;
  const base = args.length > 1 ? numAt(args, 1) : 10;
  if (isError(base)) return base;
  if (n <= 0 || base <= 0 || base === 1) return ERR.NUM;
  return Math.log(n) / Math.log(base);
};

const SUMPRODUCT: FormulaFn = (args) => {
  const ranges = args.map((a) => (isRange(a) ? a.values : [scalarOf(a)]));
  const len = ranges[0]?.length ?? 0;
  for (const r of ranges) if (r.length !== len) return ERR.VALUE;
  let total = 0;
  for (let i = 0; i < len; i++) {
    let prod = 1;
    for (const r of ranges) {
      const v = r[i] as FormulaValue;
      if (isError(v)) return v;
      prod *= typeof v === 'number' ? v : 0;
    }
    total += prod;
  }
  return total;
};

/** SUMIF(range, criteria, [sumRange]) / COUNTIF / AVERAGEIF share this core. */
function ifReduce(args: EvalResult[], mode: 'sum' | 'count' | 'average'): FormulaValue {
  const range = argAt(args, 0);
  if (!isRange(range)) return mode === 'count' ? 0 : ERR.VALUE;
  const criteria = scalarOf(argAt(args, 1));
  if (isError(criteria)) return criteria;
  // Compile the (loop-invariant) criteria ONCE, then test each cell.
  const pred = compileCriteria(criteria);
  const vals = range.values;
  const sumRange = mode === 'count' ? range : (argAt(args, 2) as EvalResult | undefined);
  const sumVals = sumRange && isRange(sumRange) ? sumRange.values : vals;
  let acc = 0;
  let n = 0;
  for (let i = 0; i < vals.length; i++) {
    if (pred(vals[i] as FormulaValue)) {
      if (mode === 'count') {
        n++;
      } else {
        const v = sumVals[i] as FormulaValue;
        if (typeof v === 'number') {
          acc += v;
          n++;
        }
      }
    }
  }
  if (mode === 'sum') return acc;
  if (mode === 'count') return n;
  return n === 0 ? ERR.DIV0 : acc / n;
}

// ---------------------------------------------------------------------------
// Slice 42a — the *IFS family (N criteria), COUNTBLANK, SUBTOTAL, and the D*
// database functions.
// ---------------------------------------------------------------------------

type IfsMode = 'sum' | 'count' | 'average' | 'max' | 'min';

/**
 * `SUMIFS`/`COUNTIFS`/`AVERAGEIFS`/`MAXIFS`/`MINIFS` — N `(criteria_range, criteria)`
 * pairs, **AND-combined per row**. The value range is `args[0]` for all but COUNTIFS
 * (which has none). All ranges must share the same shape (else `#VALUE!`). Each
 * criterion is compiled once (reuses the v1.5.1 `compileCriteria` fast path).
 */
function ifsReduce(args: EvalResult[], mode: IfsMode): FormulaValue {
  const hasValueRange = mode !== 'count';
  const valueRange = hasValueRange ? argAt(args, 0) : undefined;
  if (hasValueRange && !isRange(valueRange)) return ERR.VALUE;
  const valueVals = hasValueRange ? (valueRange as RangeValue).values : undefined;
  const start = hasValueRange ? 1 : 0;

  const preds: { vals: FormulaValue[]; pred: (v: FormulaValue) => boolean }[] = [];
  let len = valueVals ? valueVals.length : -1;
  for (let i = start; i + 1 < args.length; i += 2) {
    const cr = argAt(args, i);
    if (!isRange(cr)) return ERR.VALUE;
    if (len === -1) len = cr.values.length;
    else if (cr.values.length !== len) return ERR.VALUE; // mismatched shape
    const crit = scalarOf(argAt(args, i + 1));
    if (isError(crit)) return crit;
    preds.push({ vals: cr.values, pred: compileCriteria(crit) });
  }
  if (preds.length === 0 || len < 0) return mode === 'count' ? 0 : ERR.VALUE;

  let acc = 0;
  let n = 0;
  let ext: number | undefined;
  for (let j = 0; j < len; j++) {
    let keep = true;
    for (let p = 0; p < preds.length; p++) {
      const pr = preds[p] as (typeof preds)[number];
      if (!pr.pred(pr.vals[j] as FormulaValue)) {
        keep = false;
        break;
      }
    }
    if (!keep) continue;
    if (mode === 'count') {
      n++;
      continue;
    }
    const v = (valueVals as FormulaValue[])[j] as FormulaValue;
    if (typeof v === 'number') {
      n++;
      if (mode === 'sum' || mode === 'average') acc += v;
      else if (mode === 'max') ext = ext === undefined || v > ext ? v : ext;
      else ext = ext === undefined || v < ext ? v : ext;
    }
  }
  switch (mode) {
    case 'sum': return acc;
    case 'count': return n;
    case 'average': return n === 0 ? ERR.DIV0 : acc / n;
    case 'max': return ext ?? 0;
    case 'min': return ext ?? 0;
  }
  return ERR.VALUE;
}

const COUNTBLANK: FormulaFn = (args) => {
  let c = 0;
  for (const v of flatValues(args)) if (isBlank(v)) c++;
  return c;
};

/** Population/sample variance + stdev over a plain number list. */
function varOfNums(nums: number[], sample: boolean): number | FormulaError {
  const n = nums.length;
  if (n < (sample ? 2 : 1)) return ERR.DIV0;
  let mean = 0;
  for (const x of nums) mean += x;
  mean /= n;
  let ss = 0;
  for (const x of nums) {
    const d = x - mean;
    ss += d * d;
  }
  return ss / (sample ? n - 1 : n);
}
function stdevOfNums(nums: number[], sample: boolean): number | FormulaError {
  const v = varOfNums(nums, sample);
  return isError(v) ? v : Math.sqrt(v);
}
function variance(args: EvalResult[], sample: boolean): FormulaValue {
  const nums = collectNumbers(args);
  return isError(nums) ? nums : varOfNums(nums, sample);
}
function stdev(args: EvalResult[], sample: boolean): FormulaValue {
  const nums = collectNumbers(args);
  return isError(nums) ? nums : stdevOfNums(nums, sample);
}

/**
 * `SUBTOTAL(fnNum, ref…)` — 1–11 (and 101–111 "ignore hidden", treated the same:
 * the formula engine has no hidden-cell model in canonical space). Nested-SUBTOTAL
 * exclusion is not modeled (a documented limitation).
 */
const SUBTOTAL: FormulaFn = (args, ctx) => {
  const fnum = numAt(args, 0);
  if (isError(fnum)) return fnum;
  const code = Math.trunc(fnum) % 100;
  const rest = args.slice(1);
  switch (code) {
    case 1: return AVERAGE(rest, ctx);
    case 2: return COUNT(rest, ctx);
    case 3: return COUNTA(rest, ctx);
    case 4: return MAXFN(rest, ctx);
    case 5: return MINFN(rest, ctx);
    case 6: return PRODUCT(rest, ctx);
    case 7: return stdev(rest, true);
    case 8: return stdev(rest, false);
    case 9: return SUM(rest, ctx);
    case 10: return variance(rest, true);
    case 11: return variance(rest, false);
    default: return ERR.VALUE;
  }
};

// --- Database functions (D*) -----------------------------------------------

type DbMode =
  | 'sum' | 'count' | 'counta' | 'get' | 'max' | 'min'
  | 'product' | 'average' | 'stdev' | 'stdevp' | 'var' | 'varp';

function rangeCellAt(r: RangeValue, row: number, col: number): FormulaValue {
  return (r.values[row * r.cols + col] ?? null) as FormulaValue;
}

/** Resolve a D* `field` (1-based number OR a header name) to a 0-based db column. */
function resolveDbField(field: FormulaValue, headers: FormulaValue[]): number {
  if (typeof field === 'number') {
    const idx = Math.trunc(field) - 1;
    return idx >= 0 && idx < headers.length ? idx : -1;
  }
  const name = typeof field === 'string' ? field.trim().toUpperCase() : '';
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (typeof h === 'string' && h.trim().toUpperCase() === name) return i;
  }
  return -1;
}

/**
 * `DSUM`/`DCOUNT`/`DGET`/… — a `(database, field, criteria)` reduce. Row 0 of each
 * range is field-name headers. A data row matches when **any** criteria row matches
 * (OR across rows), a criteria row matching when **all** its non-blank cells match
 * (AND across columns) — each cell a `compileCriteria` predicate over the row's
 * value in that field's column. Reduces the matched rows' `field` column.
 */
function dbReduce(args: EvalResult[], mode: DbMode): FormulaValue {
  const db = argAt(args, 0);
  if (!isRange(db) || db.rows < 2) return ERR.VALUE;
  const crit = argAt(args, 2);
  if (!isRange(crit) || crit.rows < 2) return ERR.VALUE;
  const field = scalarOf(argAt(args, 1));
  if (isError(field)) return field;

  const dbHeaders: FormulaValue[] = [];
  for (let c = 0; c < db.cols; c++) dbHeaders.push(rangeCellAt(db, 0, c));
  const fieldCol = resolveDbField(field, dbHeaders);
  if (fieldCol < 0) return ERR.VALUE;

  const critCols: number[] = [];
  for (let c = 0; c < crit.cols; c++) critCols.push(resolveDbField(rangeCellAt(crit, 0, c), dbHeaders));

  const rowMatches = (dbRow: number): boolean => {
    for (let cr = 1; cr < crit.rows; cr++) {
      let all = true;
      let any = false;
      for (let cc = 0; cc < crit.cols; cc++) {
        const critVal = rangeCellAt(crit, cr, cc);
        if (isBlank(critVal)) continue;
        any = true;
        const dbc = critCols[cc] as number;
        if (dbc < 0 || !compileCriteria(critVal)(rangeCellAt(db, dbRow, dbc))) {
          all = false;
          break;
        }
      }
      if (any && all) return true;
    }
    return false;
  };

  const picked: FormulaValue[] = [];
  for (let r = 1; r < db.rows; r++) if (rowMatches(r)) picked.push(rangeCellAt(db, r, fieldCol));
  const nums: number[] = [];
  for (const v of picked) if (typeof v === 'number') nums.push(v);
  const reduceNums = (init: number, f: (a: number, b: number) => number): number =>
    nums.reduce(f, init);

  switch (mode) {
    case 'count': return nums.length;
    case 'counta': return picked.filter((v) => !isBlank(v)).length;
    case 'get': {
      const nonBlank = picked.filter((v) => !isBlank(v));
      if (nonBlank.length === 0) return ERR.VALUE;
      if (nonBlank.length > 1) return ERR.NUM;
      return nonBlank[0] as FormulaValue;
    }
    case 'sum': return reduceNums(0, (a, b) => a + b);
    case 'product': return nums.length ? reduceNums(1, (a, b) => a * b) : 0;
    case 'max': return nums.length ? reduceNums(nums[0] as number, (a, b) => (b > a ? b : a)) : 0;
    case 'min': return nums.length ? reduceNums(nums[0] as number, (a, b) => (b < a ? b : a)) : 0;
    case 'average': return nums.length ? reduceNums(0, (a, b) => a + b) / nums.length : ERR.DIV0;
    case 'stdev': return stdevOfNums(nums, true);
    case 'stdevp': return stdevOfNums(nums, false);
    case 'var': return varOfNums(nums, true);
    case 'varp': return varOfNums(nums, false);
  }
  return ERR.VALUE;
}

// ---------------------------------------------------------------------------
// Slice 42b — Financial (time-value-of-money, depreciation, rate conversion).
// Excel sign convention: cash received is +, cash paid is −.
// ---------------------------------------------------------------------------

/** Optional numeric arg with a default when omitted/blank; propagates a coercion error. */
function fnum(args: EvalResult[], i: number, def: number): number | FormulaError {
  if (i >= args.length) return def;
  const a = argAt(args, i);
  if (a === undefined || scalarOf(a) == null) return def; // omitted (`,,`) or blank → default
  return numAt(args, i);
}
function numOrNum(n: number): FormulaValue {
  return Number.isFinite(n) ? n : ERR.NUM;
}

// --- Annuity core (solve one of pv/fv/pmt/nper) ----------------------------
function annuityFV(rate: number, nper: number, pmt: number, pv: number, type: number): number {
  if (rate === 0) return -(pv + pmt * nper);
  const p = Math.pow(1 + rate, nper);
  return -(pv * p + pmt * (1 + rate * type) * (p - 1) / rate);
}
function annuityPV(rate: number, nper: number, pmt: number, fv: number, type: number): number {
  if (rate === 0) return -(fv + pmt * nper);
  const p = Math.pow(1 + rate, nper);
  return -(fv + pmt * (1 + rate * type) * (p - 1) / rate) / p;
}
function annuityPMT(rate: number, nper: number, pv: number, fv: number, type: number): number {
  if (rate === 0) return nper === 0 ? NaN : -(pv + fv) / nper;
  const p = Math.pow(1 + rate, nper);
  return (-(pv * p + fv) * rate) / ((1 + rate * type) * (p - 1));
}
function annuityNPER(rate: number, pmt: number, pv: number, fv: number, type: number): number {
  if (rate === 0) return pmt === 0 ? NaN : -(pv + fv) / pmt;
  const a = pmt * (1 + rate * type);
  const q = (a - fv * rate) / (a + pv * rate);
  return q <= 0 ? NaN : Math.log(q) / Math.log(1 + rate);
}
function ipmtValue(rate: number, per: number, nper: number, pv: number, fv: number, type: number): number {
  const pmt = annuityPMT(rate, nper, pv, fv, type);
  const fvPrev = annuityFV(rate, per - 1, pmt, pv, type);
  let ip = fvPrev * rate;
  if (type === 1) ip = per === 1 ? 0 : ip / (1 + rate);
  return ip;
}

// --- Iterative solvers (Newton + bisection fallback) -----------------------
function solveRoot(f: (x: number) => number, guess: number): number {
  let r = guess;
  for (let i = 0; i < 100; i++) {
    const f0 = f(r);
    const h = 1e-6;
    const df = (f(r + h) - f(r - h)) / (2 * h);
    if (Math.abs(df) < 1e-12) break;
    const rn = r - f0 / df;
    if (!Number.isFinite(rn)) break;
    if (Math.abs(rn - r) < 1e-10) return rn;
    r = rn <= -1 ? -1 + 1e-9 : rn;
  }
  // Bisection fallback over a wide bracket.
  let lo = -0.999999;
  let hi = 10;
  let flo = f(lo);
  if (!Number.isFinite(flo) || flo * f(hi) > 0) return NaN;
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (Math.abs(fm) < 1e-10) return mid;
    if (flo * fm < 0) hi = mid;
    else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}
/**
 * Root of a monotone `f` on `[lo, hi]` where `f(x) = target`, via the **Illinois**
 * regula-falsi method: bracketing (always convergent) and superlinear — typically
 * ~3–5× fewer `f` evaluations than plain bisection to the same tolerance. Falls back
 * to the nearer endpoint if `[lo, hi]` does not bracket the target.
 */
function solveMonotone(f: (x: number) => number, lo: number, hi: number, target: number, tol: number): number {
  let a = lo;
  let b = hi;
  let fa = f(a) - target;
  let fb = f(b) - target;
  if (Math.abs(fa) < tol) return a;
  if (Math.abs(fb) < tol) return b;
  if ((fa < 0) === (fb < 0)) return Math.abs(fa) < Math.abs(fb) ? a : b; // not bracketed
  let x = (a + b) / 2;
  for (let i = 0; i < 100; i++) {
    x = (a * fb - b * fa) / (fb - fa); // regula-falsi step
    const fx = f(x) - target;
    if (Math.abs(fx) < tol) return x;
    if ((fx < 0) === (fa < 0)) { a = x; fa = fx; fb *= 0.5; } // keep b → down-weight it (Illinois)
    else { b = x; fb = fx; fa *= 0.5; } // keep a → down-weight it
  }
  return x;
}

// --- Depreciation ----------------------------------------------------------
function ddbValue(cost: number, salvage: number, life: number, period: number, factor: number): number {
  const rate = factor / life;
  let book = cost;
  let depr = 0;
  for (let p = 1; p <= period; p++) {
    depr = Math.max(0, Math.min(book * rate, book - salvage));
    book -= depr;
  }
  return depr;
}
function dbValue(cost: number, salvage: number, life: number, period: number, month: number): number {
  const rate = Math.round((1 - Math.pow(salvage / cost, 1 / life)) * 1000) / 1000;
  let book = cost;
  let depr = 0;
  for (let p = 1; p <= period; p++) {
    if (p === 1) depr = cost * rate * month / 12;
    else if (p === life + 1) depr = book * rate * (12 - month) / 12;
    else depr = book * rate;
    book -= depr;
  }
  return depr;
}

// --- Function wrappers ------------------------------------------------------
const PMT: FormulaFn = (args) => {
  const r = numAt(args, 0), np = numAt(args, 1), pv = numAt(args, 2);
  const fv = fnum(args, 3, 0), ty = fnum(args, 4, 0);
  for (const v of [r, np, pv, fv, ty]) if (isError(v)) return v;
  return numOrNum(annuityPMT(r as number, np as number, pv as number, fv as number, ty as number));
};
const PV: FormulaFn = (args) => {
  const r = numAt(args, 0), np = numAt(args, 1), pmt = numAt(args, 2);
  const fv = fnum(args, 3, 0), ty = fnum(args, 4, 0);
  for (const v of [r, np, pmt, fv, ty]) if (isError(v)) return v;
  return numOrNum(annuityPV(r as number, np as number, pmt as number, fv as number, ty as number));
};
const FV: FormulaFn = (args) => {
  const r = numAt(args, 0), np = numAt(args, 1), pmt = numAt(args, 2);
  const pv = fnum(args, 3, 0), ty = fnum(args, 4, 0);
  for (const v of [r, np, pmt, pv, ty]) if (isError(v)) return v;
  return numOrNum(annuityFV(r as number, np as number, pmt as number, pv as number, ty as number));
};
const NPER: FormulaFn = (args) => {
  const r = numAt(args, 0), pmt = numAt(args, 1), pv = numAt(args, 2);
  const fv = fnum(args, 3, 0), ty = fnum(args, 4, 0);
  for (const v of [r, pmt, pv, fv, ty]) if (isError(v)) return v;
  return numOrNum(annuityNPER(r as number, pmt as number, pv as number, fv as number, ty as number));
};
const RATE: FormulaFn = (args) => {
  const np = numAt(args, 0), pmt = numAt(args, 1), pv = numAt(args, 2);
  const fv = fnum(args, 3, 0), ty = fnum(args, 4, 0), guess = fnum(args, 5, 0.1);
  for (const v of [np, pmt, pv, fv, ty, guess]) if (isError(v)) return v;
  const f = (r: number): number => {
    if (r === 0) return (pv as number) + (pmt as number) * (np as number) + (fv as number);
    const p = Math.pow(1 + r, np as number);
    return (pv as number) * p + (pmt as number) * (1 + r * (ty as number)) * (p - 1) / r + (fv as number);
  };
  return numOrNum(solveRoot(f, guess as number));
};
const IPMT: FormulaFn = (args) => {
  const r = numAt(args, 0), per = numAt(args, 1), np = numAt(args, 2), pv = numAt(args, 3);
  const fv = fnum(args, 4, 0), ty = fnum(args, 5, 0);
  for (const v of [r, per, np, pv, fv, ty]) if (isError(v)) return v;
  return numOrNum(ipmtValue(r as number, per as number, np as number, pv as number, fv as number, ty as number));
};
const PPMT: FormulaFn = (args) => {
  const r = numAt(args, 0), per = numAt(args, 1), np = numAt(args, 2), pv = numAt(args, 3);
  const fv = fnum(args, 4, 0), ty = fnum(args, 5, 0);
  for (const v of [r, per, np, pv, fv, ty]) if (isError(v)) return v;
  const pmt = annuityPMT(r as number, np as number, pv as number, fv as number, ty as number);
  const ip = ipmtValue(r as number, per as number, np as number, pv as number, fv as number, ty as number);
  return numOrNum(pmt - ip);
};
function cumulate(args: EvalResult[], want: 'interest' | 'principal'): FormulaValue {
  const r = numAt(args, 0), np = numAt(args, 1), pv = numAt(args, 2);
  const start = numAt(args, 3), end = numAt(args, 4), ty = fnum(args, 5, 0);
  for (const v of [r, np, pv, start, end, ty]) if (isError(v)) return v;
  const pmt = annuityPMT(r as number, np as number, pv as number, 0, ty as number);
  let acc = 0;
  for (let per = Math.trunc(start as number); per <= Math.trunc(end as number); per++) {
    const ip = ipmtValue(r as number, per, np as number, pv as number, 0, ty as number);
    acc += want === 'interest' ? ip : pmt - ip;
  }
  return numOrNum(acc);
}
const ISPMT: FormulaFn = (args) => {
  const r = numAt(args, 0), per = numAt(args, 1), np = numAt(args, 2), pv = numAt(args, 3);
  for (const v of [r, per, np, pv]) if (isError(v)) return v;
  return numOrNum((pv as number) * (r as number) * ((per as number) / (np as number) - 1));
};
const NPV: FormulaFn = (args) => {
  const r = numAt(args, 0);
  if (isError(r)) return r;
  const flows = collectNumbers(args.slice(1));
  if (isError(flows)) return flows;
  let s = 0;
  for (let i = 0; i < flows.length; i++) s += (flows[i] as number) / Math.pow(1 + (r as number), i + 1);
  return numOrNum(s);
};
const IRR: FormulaFn = (args) => {
  const flows = collectNumbers([argAt(args, 0) as EvalResult]);
  if (isError(flows)) return flows;
  const guess = fnum(args, 1, 0.1);
  if (isError(guess)) return guess;
  const f = (r: number): number => {
    let s = 0;
    for (let i = 0; i < flows.length; i++) s += (flows[i] as number) / Math.pow(1 + r, i);
    return s;
  };
  return numOrNum(solveRoot(f, guess as number));
};
const MIRR: FormulaFn = (args) => {
  const flows = collectNumbers([argAt(args, 0) as EvalResult]);
  if (isError(flows)) return flows;
  const fin = numAt(args, 1), rein = numAt(args, 2);
  for (const v of [fin, rein]) if (isError(v)) return v;
  const n = flows.length;
  let posFV = 0;
  let negPV = 0;
  for (let i = 0; i < n; i++) {
    const cf = flows[i] as number;
    if (cf > 0) posFV += cf * Math.pow(1 + (rein as number), n - 1 - i);
    else negPV += cf / Math.pow(1 + (fin as number), i);
  }
  if (negPV === 0) return ERR.DIV0;
  return numOrNum(Math.pow(-posFV / negPV, 1 / (n - 1)) - 1);
};
function xflows(args: EvalResult[]): { cf: number[]; days: number[] } | FormulaError {
  const values = argAt(args, 1);
  const dates = argAt(args, 2);
  if (!isRange(values) || !isRange(dates)) return ERR.VALUE;
  const cf: number[] = [];
  const dr: number[] = [];
  const n = Math.min(values.values.length, dates.values.length);
  const d0 = values.values.length ? Number(dates.values[0]) : 0;
  for (let i = 0; i < n; i++) {
    cf.push(Number(values.values[i]));
    dr.push((Number(dates.values[i]) - d0) / 365);
  }
  return { cf, days: dr };
}
const XNPV: FormulaFn = (args) => {
  const r = numAt(args, 0);
  if (isError(r)) return r;
  const x = xflows(args);
  if (isError(x)) return x;
  let s = 0;
  for (let i = 0; i < x.cf.length; i++) s += (x.cf[i] as number) / Math.pow(1 + (r as number), x.days[i] as number);
  return numOrNum(s);
};
const XIRR: FormulaFn = (args) => {
  const x = xflows([argAt(args, 0), argAt(args, 0), argAt(args, 1)] as EvalResult[]);
  if (isError(x)) return x;
  const guess = fnum(args, 2, 0.1);
  if (isError(guess)) return guess;
  const f = (r: number): number => {
    let s = 0;
    for (let i = 0; i < x.cf.length; i++) s += (x.cf[i] as number) / Math.pow(1 + r, x.days[i] as number);
    return s;
  };
  return numOrNum(solveRoot(f, guess as number));
};
const FVSCHEDULE: FormulaFn = (args) => {
  const principal = numAt(args, 0);
  if (isError(principal)) return principal;
  const sched = collectNumbers([argAt(args, 1) as EvalResult]);
  if (isError(sched)) return sched;
  let acc = principal as number;
  for (const rate of sched) acc *= 1 + rate;
  return numOrNum(acc);
};
const SLN: FormulaFn = (args) => {
  const cost = numAt(args, 0), salv = numAt(args, 1), life = numAt(args, 2);
  for (const v of [cost, salv, life]) if (isError(v)) return v;
  return (life as number) === 0 ? ERR.DIV0 : numOrNum(((cost as number) - (salv as number)) / (life as number));
};
const SYD: FormulaFn = (args) => {
  const cost = numAt(args, 0), salv = numAt(args, 1), life = numAt(args, 2), per = numAt(args, 3);
  for (const v of [cost, salv, life, per]) if (isError(v)) return v;
  const l = life as number;
  return numOrNum(((cost as number) - (salv as number)) * (l - (per as number) + 1) * 2 / (l * (l + 1)));
};
const DDB: FormulaFn = (args) => {
  const cost = numAt(args, 0), salv = numAt(args, 1), life = numAt(args, 2), per = numAt(args, 3);
  const factor = fnum(args, 4, 2);
  for (const v of [cost, salv, life, per, factor]) if (isError(v)) return v;
  return numOrNum(ddbValue(cost as number, salv as number, life as number, per as number, factor as number));
};
const DB: FormulaFn = (args) => {
  const cost = numAt(args, 0), salv = numAt(args, 1), life = numAt(args, 2), per = numAt(args, 3);
  const month = fnum(args, 4, 12);
  for (const v of [cost, salv, life, per, month]) if (isError(v)) return v;
  return numOrNum(dbValue(cost as number, salv as number, life as number, per as number, month as number));
};
const EFFECT: FormulaFn = (args) => {
  const nom = numAt(args, 0), np = numAt(args, 1);
  for (const v of [nom, np]) if (isError(v)) return v;
  const n = Math.trunc(np as number);
  return n < 1 ? ERR.NUM : numOrNum(Math.pow(1 + (nom as number) / n, n) - 1);
};
const NOMINAL: FormulaFn = (args) => {
  const eff = numAt(args, 0), np = numAt(args, 1);
  for (const v of [eff, np]) if (isError(v)) return v;
  const n = Math.trunc(np as number);
  return n < 1 ? ERR.NUM : numOrNum(n * (Math.pow(1 + (eff as number), 1 / n) - 1));
};
const PDURATION: FormulaFn = (args) => {
  const r = numAt(args, 0), pv = numAt(args, 1), fv = numAt(args, 2);
  for (const v of [r, pv, fv]) if (isError(v)) return v;
  return numOrNum((Math.log(fv as number) - Math.log(pv as number)) / Math.log(1 + (r as number)));
};
const RRI: FormulaFn = (args) => {
  const np = numAt(args, 0), pv = numAt(args, 1), fv = numAt(args, 2);
  for (const v of [np, pv, fv]) if (isError(v)) return v;
  return numOrNum(Math.pow((fv as number) / (pv as number), 1 / (np as number)) - 1);
};
const DOLLARDE: FormulaFn = (args) => {
  const fd = numAt(args, 0), frac = numAt(args, 1);
  for (const v of [fd, frac]) if (isError(v)) return v;
  const f = Math.trunc(frac as number);
  if (f === 0) return ERR.DIV0;
  const i = Math.trunc(fd as number);
  const digits = Math.ceil(Math.log10(Math.abs(f))) || 1;
  return numOrNum(i + ((fd as number) - i) * Math.pow(10, digits) / f);
};
const DOLLARFR: FormulaFn = (args) => {
  const dd = numAt(args, 0), frac = numAt(args, 1);
  for (const v of [dd, frac]) if (isError(v)) return v;
  const f = Math.trunc(frac as number);
  if (f === 0) return ERR.DIV0;
  const i = Math.trunc(dd as number);
  const digits = Math.ceil(Math.log10(Math.abs(f))) || 1;
  return numOrNum(i + ((dd as number) - i) * f / Math.pow(10, digits));
};

// ---------------------------------------------------------------------------
// Slice 42c-1 — Statistical (descriptive, ranking, regression) + AGGREGATE.
// ---------------------------------------------------------------------------

function numsSorted(args: EvalResult[]): number[] | FormulaError {
  const nums = collectNumbers(args);
  if (isError(nums)) return nums;
  return [...nums].sort((a, b) => a - b);
}

/**
 * In-place quickselect — the k-th smallest (0-based) of `a`, mutating `a`. O(n)
 * average (Hoare partition, median-of-three pivot → robust on sorted/reverse input).
 * Returns the same order-statistic value a full sort would, without the log factor.
 */
function quickselect(a: number[], k: number): number {
  let lo = 0;
  let hi = a.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const x = a[lo] as number;
    const y = a[mid] as number;
    const z = a[hi] as number;
    const pivot = x < y ? (y < z ? y : x < z ? z : x) : x < z ? x : y < z ? z : y;
    let i = lo;
    let j = hi;
    while (i <= j) {
      while ((a[i] as number) < pivot) i++;
      while ((a[j] as number) > pivot) j--;
      if (i <= j) {
        const t = a[i] as number;
        a[i] = a[j] as number;
        a[j] = t;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else break; // k landed in the settled equal-to-pivot middle
  }
  return a[k] as number;
}

/** Collapse args into one range with error cells removed (AGGREGATE ignore-errors). */
function stripErrors(args: EvalResult[]): RangeValue {
  const values: FormulaValue[] = [];
  for (const v of flatValues(args)) if (!isError(v)) values.push(v);
  return { kind: 'range', values, rows: values.length, cols: 1 };
}

/** *A-variant collector: text→0, TRUE→1, FALSE→0, blanks ignored, errors propagate. */
function collectNumbersA(args: EvalResult[]): number[] | FormulaError {
  const out: number[] = [];
  for (const arg of args) {
    const vals = isRange(arg) ? arg.values : [scalarOf(arg)];
    for (const v of vals) {
      if (isError(v)) return v;
      if (typeof v === 'number') out.push(v);
      else if (typeof v === 'boolean') out.push(v ? 1 : 0);
      else if (typeof v === 'string' && v !== '') out.push(0);
    }
  }
  return out;
}

function percentileInc(sorted: number[], k: number): number | FormulaError {
  const n = sorted.length;
  if (n === 0 || k < 0 || k > 1) return ERR.NUM;
  const pos = k * (n - 1);
  const lo = Math.floor(pos);
  const frac = pos - lo;
  const a = sorted[lo] as number;
  return lo + 1 < n ? a + frac * ((sorted[lo + 1] as number) - a) : a;
}
function percentileExc(sorted: number[], k: number): number | FormulaError {
  const n = sorted.length;
  if (n === 0 || k <= 0 || k >= 1) return ERR.NUM;
  const pos = k * (n + 1) - 1;
  if (pos < 0 || pos > n - 1) return ERR.NUM;
  const lo = Math.floor(pos);
  const frac = pos - lo;
  const a = sorted[lo] as number;
  return lo + 1 < n ? a + frac * ((sorted[lo + 1] as number) - a) : a;
}

function rankOf(x: number, nums: number[], ascending: boolean, avg: boolean): number | FormulaError {
  let less = 0;
  let greater = 0;
  let equal = 0;
  for (const v of nums) {
    if (v === x) equal++;
    else if (v < x) less++;
    else greater++;
  }
  if (equal === 0) return ERR.NA;
  const base = ascending ? less + 1 : greater + 1;
  return avg ? base + (equal - 1) / 2 : base;
}

/** Two parallel numeric samples from two range/scalar args (paired, skip non-numeric). */
function twoRanges(args: EvalResult[], i: number, j: number): { xs: number[]; ys: number[] } | FormulaError {
  const a = argAt(args, i);
  const b = argAt(args, j);
  const av = isRange(a) ? a.values : [scalarOf(a)];
  const bv = isRange(b) ? b.values : [scalarOf(b)];
  if (av.length !== bv.length) return ERR.NA;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let k = 0; k < av.length; k++) {
    const x = av[k] as FormulaValue;
    const y = bv[k] as FormulaValue;
    if (isError(x)) return x;
    if (isError(y)) return y;
    if (typeof x === 'number' && typeof y === 'number') {
      xs.push(x);
      ys.push(y);
    }
  }
  return { xs, ys };
}
function regression(xs: number[], ys: number[]): { n: number; mx: number; my: number; sxx: number; syy: number; sxy: number } {
  const n = xs.length;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i] as number;
    sy += ys[i] as number;
  }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (xs[i] as number) - mx;
    const dy = (ys[i] as number) - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  return { n, mx, my, sxx, syy, sxy };
}

function skewness(nums: number[], population: boolean): number | FormulaError {
  const n = nums.length;
  if (population ? n < 1 : n < 3) return ERR.DIV0;
  let mean = 0;
  for (const x of nums) mean += x;
  mean /= n;
  let s2 = 0;
  for (const x of nums) {
    const d = x - mean;
    s2 += d * d;
  }
  const sd = Math.sqrt(s2 / (population ? n : n - 1));
  if (sd === 0) return ERR.DIV0;
  let s3 = 0;
  for (const x of nums) {
    const z = (x - mean) / sd;
    s3 += z * z * z;
  }
  return population ? s3 / n : (n / ((n - 1) * (n - 2))) * s3;
}
function kurtosis(nums: number[]): number | FormulaError {
  const n = nums.length;
  if (n < 4) return ERR.DIV0;
  let mean = 0;
  for (const x of nums) mean += x;
  mean /= n;
  let s2 = 0;
  for (const x of nums) {
    const d = x - mean;
    s2 += d * d;
  }
  const sd = Math.sqrt(s2 / (n - 1));
  if (sd === 0) return ERR.DIV0;
  let s4 = 0;
  for (const x of nums) {
    const z = (x - mean) / sd;
    s4 += z * z * z * z;
  }
  return (n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3)) * s4 - (3 * (n - 1) * (n - 1)) / ((n - 2) * (n - 3));
}

// --- Function wrappers ------------------------------------------------------
const MEDIAN: FormulaFn = (args) => {
  const nums = collectNumbers(args); // a fresh array — safe to partition in place
  if (isError(nums)) return nums;
  const n = nums.length;
  if (n === 0) return ERR.NUM;
  const mid = Math.floor(n / 2);
  const hi = quickselect(nums, mid); // O(n) select; nums[0..mid-1] are all ≤ hi
  if (n % 2) return hi;
  let lo = -Infinity; // lower-middle = max of the left partition
  for (let i = 0; i < mid; i++) if ((nums[i] as number) > lo) lo = nums[i] as number;
  return (lo + hi) / 2;
};
const MODESNGL: FormulaFn = (args) => {
  const nums = collectNumbers(args);
  if (isError(nums)) return nums;
  const counts = new Map<number, number>();
  let best: number | undefined;
  let bestC = 1;
  for (const x of nums) {
    const c = (counts.get(x) ?? 0) + 1;
    counts.set(x, c);
    if (c > bestC || (c === bestC && best === undefined && c > 1)) {
      if (c > 1) { bestC = c; best = x; }
    }
  }
  return best === undefined ? ERR.NA : best;
};
/** `MODE.MULT` (v1.7) — every value tied for the most frequent (spills, appearance order); `#N/A` if none repeats. */
const MODEMULT: FormulaFn = (args) => {
  const nums = collectNumbers(args);
  if (isError(nums)) return nums;
  const counts = new Map<number, number>();
  const order: number[] = [];
  for (const x of nums) {
    const c = (counts.get(x) ?? 0) + 1;
    counts.set(x, c);
    if (c === 1) order.push(x);
  }
  let bestC = 1;
  for (const c of counts.values()) if (c > bestC) bestC = c;
  if (bestC < 2) return ERR.NA;
  const modes = order.filter((x) => counts.get(x) === bestC);
  return { kind: 'range', values: modes, rows: modes.length, cols: 1 };
};
/** `PROB(x_range, prob_range, lower, [upper])` (v1.7) — Σ prob where lower ≤ x ≤ upper. */
const PROB: FormulaFn = (args) => {
  const pair = twoRanges(args, 0, 1);
  if (isError(pair)) return pair;
  const { xs, ys } = pair;
  if (xs.length === 0) return ERR.NUM;
  let sum = 0;
  for (const p of ys) {
    if (p <= 0 || p > 1) return ERR.NUM;
    sum += p;
  }
  if (Math.abs(sum - 1) > 1e-9) return ERR.NUM;
  const lower = numAt(args, 2);
  if (isError(lower)) return lower;
  const upper = args.length > 3 ? numAt(args, 3) : lower;
  if (isError(upper)) return upper;
  let acc = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i] as number;
    if (x >= lower && x <= upper) acc += ys[i] as number;
  }
  return acc;
};
const LARGE: FormulaFn = (args) => {
  const nums = collectNumbers([argAt(args, 0) as EvalResult]);
  if (isError(nums)) return nums;
  const k = numAt(args, 1);
  if (isError(k)) return k;
  const idx = Math.trunc(k);
  return idx < 1 || idx > nums.length ? ERR.NUM : quickselect(nums, nums.length - idx);
};
const SMALL: FormulaFn = (args) => {
  const nums = collectNumbers([argAt(args, 0) as EvalResult]);
  if (isError(nums)) return nums;
  const k = numAt(args, 1);
  if (isError(k)) return k;
  const idx = Math.trunc(k);
  return idx < 1 || idx > nums.length ? ERR.NUM : quickselect(nums, idx - 1);
};
const rankFn = (avg: boolean): FormulaFn => (args) => {
  const x = numAt(args, 0);
  if (isError(x)) return x;
  const nums = collectNumbers([argAt(args, 1) as EvalResult]);
  if (isError(nums)) return nums;
  const order = fnum(args, 2, 0);
  if (isError(order)) return order;
  return rankOf(x, nums, order !== 0, avg);
};
const pctileFn = (exc: boolean): FormulaFn => (args) => {
  const s = numsSorted([argAt(args, 0) as EvalResult]);
  if (isError(s)) return s;
  const k = numAt(args, 1);
  if (isError(k)) return k;
  return exc ? percentileExc(s, k) : percentileInc(s, k);
};
const quartileFn = (exc: boolean): FormulaFn => (args) => {
  const s = numsSorted([argAt(args, 0) as EvalResult]);
  if (isError(s)) return s;
  const q = numAt(args, 1);
  if (isError(q)) return q;
  const qi = Math.trunc(q);
  if (exc) return qi < 1 || qi > 3 ? ERR.NUM : percentileExc(s, qi / 4);
  return qi < 0 || qi > 4 ? ERR.NUM : percentileInc(s, qi / 4);
};
const percentRankFn = (exc: boolean): FormulaFn => (args) => {
  const s = numsSorted([argAt(args, 0) as EvalResult]);
  if (isError(s)) return s;
  const x = numAt(args, 1);
  if (isError(x)) return x;
  const n = s.length;
  if (n === 0) return ERR.NUM;
  if (x < (s[0] as number) || x > (s[n - 1] as number)) return ERR.NA;
  // 0-based interpolated position of x among the sorted values.
  let i = 0;
  while (i < n && (s[i] as number) < x) i++;
  let rank: number;
  if (i < n && (s[i] as number) === x) rank = i;
  else {
    const lo = s[i - 1] as number;
    const hi = s[i] as number;
    rank = i - 1 + (x - lo) / (hi - lo);
  }
  return exc ? (rank + 1) / (n + 1) : rank / (n - 1);
};
const AVEDEV: FormulaFn = (args) => {
  const nums = collectNumbers(args);
  if (isError(nums)) return nums;
  if (nums.length === 0) return ERR.NUM;
  let mean = 0;
  for (const x of nums) mean += x;
  mean /= nums.length;
  let s = 0;
  for (const x of nums) s += Math.abs(x - mean);
  return s / nums.length;
};
const DEVSQ: FormulaFn = (args) => {
  const nums = collectNumbers(args);
  if (isError(nums)) return nums;
  let mean = 0;
  for (const x of nums) mean += x;
  mean /= nums.length || 1;
  let s = 0;
  for (const x of nums) {
    const d = x - mean;
    s += d * d;
  }
  return s;
};
const GEOMEAN: FormulaFn = (args) => {
  const nums = collectNumbers(args);
  if (isError(nums)) return nums;
  if (nums.length === 0) return ERR.NUM;
  let logSum = 0;
  for (const x of nums) {
    if (x <= 0) return ERR.NUM;
    logSum += Math.log(x);
  }
  return Math.exp(logSum / nums.length);
};
const HARMEAN: FormulaFn = (args) => {
  const nums = collectNumbers(args);
  if (isError(nums)) return nums;
  if (nums.length === 0) return ERR.NUM;
  let s = 0;
  for (const x of nums) {
    if (x <= 0) return ERR.NUM;
    s += 1 / x;
  }
  return nums.length / s;
};
const TRIMMEAN: FormulaFn = (args) => {
  const s = numsSorted([argAt(args, 0) as EvalResult]);
  if (isError(s)) return s;
  const pct = numAt(args, 1);
  if (isError(pct)) return pct;
  if (pct < 0 || pct >= 1) return ERR.NUM;
  const n = s.length;
  const trim = Math.floor((n * pct) / 2);
  const kept = s.slice(trim, n - trim);
  if (kept.length === 0) return ERR.NUM;
  let sum = 0;
  for (const x of kept) sum += x;
  return sum / kept.length;
};
const STANDARDIZE: FormulaFn = (args) => {
  const x = numAt(args, 0);
  if (isError(x)) return x;
  const mean = numAt(args, 1);
  if (isError(mean)) return mean;
  const sd = numAt(args, 2);
  if (isError(sd)) return sd;
  return sd <= 0 ? ERR.NUM : (x - mean) / sd;
};
const statA = (kind: 'avg' | 'max' | 'min'): FormulaFn => (args) => {
  const nums = collectNumbersA(args);
  if (isError(nums)) return nums;
  if (nums.length === 0) return kind === 'avg' ? ERR.DIV0 : 0;
  if (kind === 'avg') {
    let s = 0;
    for (const x of nums) s += x;
    return s / nums.length;
  }
  let acc = nums[0] as number;
  for (const x of nums) acc = kind === 'max' ? (x > acc ? x : acc) : x < acc ? x : acc;
  return acc;
};
const CORREL: FormulaFn = (args) => {
  const p = twoRanges(args, 0, 1);
  if (isError(p)) return p;
  const r = regression(p.xs, p.ys);
  return r.sxx === 0 || r.syy === 0 ? ERR.DIV0 : r.sxy / Math.sqrt(r.sxx * r.syy);
};
const covFn = (sample: boolean): FormulaFn => (args) => {
  const p = twoRanges(args, 0, 1);
  if (isError(p)) return p;
  const r = regression(p.xs, p.ys);
  const d = sample ? r.n - 1 : r.n;
  return d <= 0 ? ERR.DIV0 : r.sxy / d;
};
// SLOPE/INTERCEPT/RSQ/STEYX/FORECAST take (known_y, known_x).
const SLOPE: FormulaFn = (args) => {
  const p = twoRanges(args, 0, 1);
  if (isError(p)) return p;
  const r = regression(p.ys, p.xs); // x = known_x (arg 1)
  return r.sxx === 0 ? ERR.DIV0 : r.sxy / r.sxx;
};
const INTERCEPT: FormulaFn = (args) => {
  const p = twoRanges(args, 0, 1);
  if (isError(p)) return p;
  const r = regression(p.ys, p.xs);
  return r.sxx === 0 ? ERR.DIV0 : r.my - (r.sxy / r.sxx) * r.mx;
};
const RSQ: FormulaFn = (args) => {
  const p = twoRanges(args, 0, 1);
  if (isError(p)) return p;
  const r = regression(p.xs, p.ys);
  return r.sxx === 0 || r.syy === 0 ? ERR.DIV0 : (r.sxy * r.sxy) / (r.sxx * r.syy);
};
const STEYX: FormulaFn = (args) => {
  const p = twoRanges(args, 0, 1);
  if (isError(p)) return p;
  const r = regression(p.ys, p.xs);
  if (r.n < 3 || r.sxx === 0) return ERR.DIV0;
  return Math.sqrt((r.syy - (r.sxy * r.sxy) / r.sxx) / (r.n - 2));
};
const FORECASTLINEAR: FormulaFn = (args) => {
  const x = numAt(args, 0);
  if (isError(x)) return x;
  const p = twoRanges(args, 1, 2);
  if (isError(p)) return p;
  const r = regression(p.ys, p.xs); // known_y = arg1, known_x = arg2
  if (r.sxx === 0) return ERR.DIV0;
  const slope = r.sxy / r.sxx;
  return r.my - slope * r.mx + slope * x;
};

/** AGGREGATE(fnNum, options, ref…[, k]) — codes 1–19; options 2/3/6/7 ignore errors. */
const AGGREGATE: FormulaFn = (args, ctx) => {
  const fnum = numAt(args, 0);
  if (isError(fnum)) return fnum;
  const opt = numAt(args, 1);
  if (isError(opt)) return opt;
  const code = Math.trunc(fnum);
  const ignoreErrors = [2, 3, 6, 7].includes(Math.trunc(opt));
  const clean = (a: EvalResult[]): EvalResult[] => (ignoreErrors ? [stripErrors(a)] : a);
  if (code >= 1 && code <= 13) {
    const d = clean(args.slice(2));
    switch (code) {
      case 1: return AVERAGE(d, ctx);
      case 2: return COUNT(d, ctx);
      case 3: return COUNTA(d, ctx);
      case 4: return MAXFN(d, ctx);
      case 5: return MINFN(d, ctx);
      case 6: return PRODUCT(d, ctx);
      case 7: return stdev(d, true);
      case 8: return stdev(d, false);
      case 9: return SUM(d, ctx);
      case 10: return variance(d, true);
      case 11: return variance(d, false);
      case 12: return MEDIAN(d, ctx);
      case 13: return MODESNGL(d, ctx);
    }
  }
  if (code >= 14 && code <= 19) {
    // last arg is k / quart; the rest is the data range.
    const kArg = argAt(args, args.length - 1) as EvalResult;
    const data = clean(args.slice(2, args.length - 1));
    const call = [data[0] ?? { kind: 'range', values: [], rows: 0, cols: 0 }, kArg] as EvalResult[];
    switch (code) {
      case 14: return LARGE(call, ctx);
      case 15: return SMALL(call, ctx);
      case 16: return pctileFn(false)(call, ctx);
      case 17: return quartileFn(false)(call, ctx);
      case 18: return pctileFn(true)(call, ctx);
      case 19: return quartileFn(true)(call, ctx);
    }
  }
  return ERR.VALUE;
};

// ---------------------------------------------------------------------------
// Slice 42d — Math & trigonometry (trig/hyperbolic, combinatorics, bases, …).
// ---------------------------------------------------------------------------

function gcd2(a: number, b: number): number {
  a = Math.abs(Math.trunc(a));
  b = Math.abs(Math.trunc(b));
  while (b) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}
function factOf(n: number): number | FormulaError {
  if (n < 0 || !Number.isInteger(n)) return ERR.NUM;
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return Number.isFinite(f) ? f : ERR.NUM;
}
function factDoubleOf(n: number): number | FormulaError {
  n = Math.trunc(n);
  if (n < -1) return ERR.NUM;
  let f = 1;
  for (let i = n; i > 1; i -= 2) f *= i;
  return Number.isFinite(f) ? f : ERR.NUM;
}
function combinOf(n: number, k: number): number | FormulaError {
  n = Math.trunc(n);
  k = Math.trunc(k);
  if (k < 0 || n < 0 || k > n) return ERR.NUM;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}
function permutOf(n: number, k: number): number | FormulaError {
  n = Math.trunc(n);
  k = Math.trunc(k);
  if (k < 0 || n < 0 || k > n) return ERR.NUM;
  let r = 1;
  for (let i = 0; i < k; i++) r *= n - i;
  return r;
}
// Lanczos approximation for ln Γ — the widely published g=7, n=9 coefficient
// set (Lanczos, 1964). Public-domain mathematical constants.
const LANCZOS_G = 7;
const LANCZOS_C = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];
const LN_SQRT_2PI = 0.5 * Math.log(2 * Math.PI);

/** ln Γ(x) via the Lanczos approximation (Euler reflection for x < 0.5). */
function gammaln(x: number): number {
  if (x < 0.5) {
    // Reflection: Γ(x)·Γ(1-x) = π / sin(πx).
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - gammaln(1 - x);
  }
  const z = x - 1;
  let acc = LANCZOS_C[0] as number;
  for (let i = 1; i < LANCZOS_C.length; i++) acc += (LANCZOS_C[i] as number) / (z + i);
  const t = z + LANCZOS_G + 0.5;
  return LN_SQRT_2PI + (z + 0.5) * Math.log(t) - t + Math.log(acc);
}
function toRoman(n: number): string | null {
  n = Math.trunc(n);
  if (n < 0 || n > 3999) return null;
  const map: [number, string][] = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let s = '';
  for (const [v, sym] of map) while (n >= v) { s += sym; n -= v; }
  return s;
}
function fromRoman(text: string): number | null {
  const val: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let s = text.toUpperCase().trim();
  let neg = false;
  if (s.startsWith('-')) { neg = true; s = s.slice(1); }
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const cur = val[s[i] as string];
    if (cur === undefined) return null;
    const nxt = val[s[i + 1] as string];
    if (nxt !== undefined && cur < nxt) total -= cur;
    else total += cur;
  }
  return neg ? -total : total;
}

const ATAN2: FormulaFn = (args) => {
  const x = numAt(args, 0);
  if (isError(x)) return x;
  const y = numAt(args, 1);
  if (isError(y)) return y;
  return Math.atan2(y, x); // Excel arg order is (x, y)
};
const GCD: FormulaFn = (args) => {
  const nums = collectNumbers(args);
  if (isError(nums)) return nums;
  let g = 0;
  for (const n of nums) {
    if (n < 0) return ERR.NUM;
    g = gcd2(g, n);
  }
  return g;
};
const LCM: FormulaFn = (args) => {
  const nums = collectNumbers(args);
  if (isError(nums)) return nums;
  let l = 1;
  for (const n of nums) {
    if (n < 0) return ERR.NUM;
    const t = Math.abs(Math.trunc(n));
    if (t === 0) return 0;
    l = (l / gcd2(l, t)) * t;
  }
  return l;
};
const QUOTIENT: FormulaFn = (args) => {
  const a = numAt(args, 0);
  if (isError(a)) return a;
  const b = numAt(args, 1);
  if (isError(b)) return b;
  return b === 0 ? ERR.DIV0 : Math.trunc(a / b);
};
const binomFn = (fn: (n: number, k: number) => number | FormulaError): FormulaFn => (args) => {
  const n = numAt(args, 0);
  if (isError(n)) return n;
  const k = numAt(args, 1);
  if (isError(k)) return k;
  return fn(n, k);
};
const MULTINOMIAL: FormulaFn = (args) => {
  const nums = collectNumbers(args);
  if (isError(nums)) return nums;
  let sum = 0;
  let denomLog = 0;
  for (const n of nums) {
    const t = Math.trunc(n);
    if (t < 0) return ERR.NUM;
    sum += t;
    denomLog += gammaln(t + 1);
  }
  const r = Math.exp(gammaln(sum + 1) - denomLog);
  return Number.isFinite(r) ? Math.round(r) : ERR.NUM;
};
const SERIESSUM: FormulaFn = (args) => {
  const x = numAt(args, 0);
  if (isError(x)) return x;
  const n = numAt(args, 1);
  if (isError(n)) return n;
  const m = numAt(args, 2);
  if (isError(m)) return m;
  const coeffs = collectNumbers([argAt(args, 3) as EvalResult]);
  if (isError(coeffs)) return coeffs;
  let s = 0;
  for (let i = 0; i < coeffs.length; i++) s += (coeffs[i] as number) * Math.pow(x, n + i * m);
  return s;
};
const sumPairFn = (f: (x: number, y: number) => number): FormulaFn => (args) => {
  const p = twoRanges(args, 0, 1);
  if (isError(p)) return p;
  let s = 0;
  for (let i = 0; i < p.xs.length; i++) s += f(p.xs[i] as number, p.ys[i] as number);
  return s;
};
const ROMAN: FormulaFn = (args) => {
  const n = numAt(args, 0);
  if (isError(n)) return n;
  const r = toRoman(n);
  return r === null ? ERR.VALUE : r;
};
const ARABIC: FormulaFn = (args) => {
  const t = textAt(args, 0);
  if (isError(t)) return t;
  const n = fromRoman(t);
  return n === null ? ERR.VALUE : n;
};
const BASE: FormulaFn = (args) => {
  const n = numAt(args, 0);
  if (isError(n)) return n;
  const radix = numAt(args, 1);
  if (isError(radix)) return radix;
  const minLen = args.length > 2 ? numAt(args, 2) : 0;
  if (isError(minLen)) return minLen;
  const r = Math.trunc(radix);
  if (r < 2 || r > 36 || n < 0) return ERR.NUM;
  let s = Math.trunc(n).toString(r).toUpperCase();
  while (s.length < Math.trunc(minLen)) s = '0' + s;
  return s;
};
const DECIMAL: FormulaFn = (args) => {
  const t = textAt(args, 0);
  if (isError(t)) return t;
  const radix = numAt(args, 1);
  if (isError(radix)) return radix;
  const r = Math.trunc(radix);
  if (r < 2 || r > 36) return ERR.NUM;
  const n = parseInt(t.trim(), r);
  return Number.isNaN(n) ? ERR.NUM : n;
};
const MROUND: FormulaFn = (args) => {
  const n = numAt(args, 0);
  if (isError(n)) return n;
  const mult = numAt(args, 1);
  if (isError(mult)) return mult;
  if (mult === 0) return 0;
  if (Math.sign(n) !== Math.sign(mult) && n !== 0) return ERR.NUM;
  return Math.round(n / mult) * mult;
};
const ceilFloorMath = (dir: 'ceil' | 'floor'): FormulaFn => (args) => {
  const n = numAt(args, 0);
  if (isError(n)) return n;
  const sig = args.length > 1 ? numAt(args, 1) : 1;
  if (isError(sig)) return sig;
  const mode = args.length > 2 ? numAt(args, 2) : 0;
  if (isError(mode)) return mode;
  const s = Math.abs(sig);
  if (s === 0) return 0;
  // Default: CEILING→+inf, FLOOR→−inf. With mode≠0 and n<0, CEILING rounds AWAY
  // from zero (−inf) and FLOOR rounds TOWARD zero (+inf).
  if (n < 0 && mode !== 0) {
    return dir === 'ceil' ? Math.floor(n / s) * s : Math.ceil(n / s) * s;
  }
  return dir === 'ceil' ? Math.ceil(n / s) * s : Math.floor(n / s) * s;
};
const precise = (dir: 'ceil' | 'floor'): FormulaFn => (args) => {
  const n = numAt(args, 0);
  if (isError(n)) return n;
  const sig = args.length > 1 ? numAt(args, 1) : 1;
  if (isError(sig)) return sig;
  const s = Math.abs(sig) || 1;
  return dir === 'ceil' ? Math.ceil(n / s) * s : Math.floor(n / s) * s;
};

// ---------------------------------------------------------------------------
// Logical
// ---------------------------------------------------------------------------

const IF: FormulaFn = (args) => {
  const cond = toBoolean(scalarOf(argAt(args, 0)));
  if (isError(cond)) return cond;
  if (cond) return scalarOf(argAt(args, 1));
  return args.length > 2 ? scalarOf(argAt(args, 2)) : false;
};

const AND: FormulaFn = (args) => {
  const vals = flatValues(args);
  let any = false;
  for (const v of vals) {
    if (isBlank(v)) continue;
    const b = toBoolean(v);
    if (isError(b)) return b;
    any = true;
    if (!b) return false;
  }
  return any ? true : ERR.VALUE;
};
const OR: FormulaFn = (args) => {
  const vals = flatValues(args);
  let any = false;
  for (const v of vals) {
    if (isBlank(v)) continue;
    const b = toBoolean(v);
    if (isError(b)) return b;
    any = true;
    if (b) return true;
  }
  return any ? false : ERR.VALUE;
};
const XOR: FormulaFn = (args) => {
  let count = 0;
  for (const v of flatValues(args)) {
    if (isBlank(v)) continue;
    const b = toBoolean(v);
    if (isError(b)) return b;
    if (b) count++;
  }
  return count % 2 === 1;
};
const NOT: FormulaFn = (args) => {
  const b = toBoolean(scalarOf(argAt(args, 0)));
  if (isError(b)) return b;
  return !b;
};

const IFERROR: FormulaFn = (args) => {
  const v = scalarOf(argAt(args, 0));
  return isError(v) ? scalarOf(argAt(args, 1)) : v;
};
const IFNA: FormulaFn = (args) => {
  const v = scalarOf(argAt(args, 0));
  return v instanceof FormulaError && v.code === '#N/A' ? scalarOf(argAt(args, 1)) : v;
};

const IFS: FormulaFn = (args) => {
  for (let i = 0; i + 1 < args.length; i += 2) {
    const cond = toBoolean(scalarOf(argAt(args, i)));
    if (isError(cond)) return cond;
    if (cond) return scalarOf(argAt(args, i + 1));
  }
  return ERR.NA;
};
const SWITCH: FormulaFn = (args) => {
  const subject = scalarOf(argAt(args, 0));
  if (isError(subject)) return subject;
  let i = 1;
  for (; i + 1 < args.length; i += 2) {
    const match = scalarOf(argAt(args, i));
    if (compareValues(subject, match) === 0) return scalarOf(argAt(args, i + 1));
  }
  // trailing default
  return i < args.length ? scalarOf(argAt(args, i)) : ERR.NA;
};

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

const CONCAT: FormulaFn = (args) => {
  let s = '';
  for (const v of flatValues(args)) {
    if (isError(v)) return v;
    const t = toText(v);
    if (isError(t)) return t;
    s += t;
  }
  return s;
};

const TEXTJOIN: FormulaFn = (args) => {
  const delim = textAt(args, 0);
  if (isError(delim)) return delim;
  const ignoreEmpty = toBoolean(scalarOf(argAt(args, 1)));
  if (isError(ignoreEmpty)) return ignoreEmpty;
  const parts: string[] = [];
  for (const v of flatValues(args.slice(2))) {
    if (isError(v)) return v;
    if (ignoreEmpty && isBlank(v)) continue;
    const t = toText(v);
    if (isError(t)) return t;
    parts.push(t);
  }
  return parts.join(delim);
};

const LEN: FormulaFn = (args) => {
  const t = textAt(args, 0);
  if (isError(t)) return t;
  return t.length;
};
const LEFT: FormulaFn = (args) => {
  const t = textAt(args, 0);
  if (isError(t)) return t;
  const n = args.length > 1 ? numAt(args, 1) : 1;
  if (isError(n)) return n;
  return t.slice(0, Math.max(0, Math.trunc(n)));
};
const RIGHT: FormulaFn = (args) => {
  const t = textAt(args, 0);
  if (isError(t)) return t;
  const n = args.length > 1 ? numAt(args, 1) : 1;
  if (isError(n)) return n;
  const k = Math.max(0, Math.trunc(n));
  return k === 0 ? '' : t.slice(-k);
};
const MID: FormulaFn = (args) => {
  const t = textAt(args, 0);
  if (isError(t)) return t;
  const start = numAt(args, 1);
  if (isError(start)) return start;
  const len = numAt(args, 2);
  if (isError(len)) return len;
  const s = Math.trunc(start) - 1;
  if (s < 0) return ERR.VALUE;
  return t.slice(s, s + Math.max(0, Math.trunc(len)));
};
const textXform = (f: (s: string) => string): FormulaFn => (args) => {
  const t = textAt(args, 0);
  if (isError(t)) return t;
  return f(t);
};
const PROPER: FormulaFn = textXform((s) => s.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\B\w/g, (c) => c.toLowerCase()));

const REPT: FormulaFn = (args) => {
  const t = textAt(args, 0);
  if (isError(t)) return t;
  const n = numAt(args, 1);
  if (isError(n)) return n;
  const k = Math.trunc(n);
  if (k < 0) return ERR.VALUE;
  return t.repeat(k);
};
const EXACT: FormulaFn = (args) => {
  const a = textAt(args, 0);
  if (isError(a)) return a;
  const b = textAt(args, 1);
  if (isError(b)) return b;
  return a === b;
};
const FINDFN = (caseSensitive: boolean): FormulaFn => (args) => {
  const needle = textAt(args, 0);
  if (isError(needle)) return needle;
  const hay = textAt(args, 1);
  if (isError(hay)) return hay;
  const start = args.length > 2 ? numAt(args, 2) : 1;
  if (isError(start)) return start;
  const from = Math.max(0, Math.trunc(start) - 1);
  const idx = caseSensitive
    ? hay.indexOf(needle, from)
    : hay.toUpperCase().indexOf(needle.toUpperCase(), from);
  return idx < 0 ? ERR.VALUE : idx + 1;
};
const REPLACE: FormulaFn = (args) => {
  const t = textAt(args, 0);
  if (isError(t)) return t;
  const start = numAt(args, 1);
  if (isError(start)) return start;
  const len = numAt(args, 2);
  if (isError(len)) return len;
  const repl = textAt(args, 3);
  if (isError(repl)) return repl;
  const s = Math.trunc(start) - 1;
  if (s < 0) return ERR.VALUE;
  return t.slice(0, s) + repl + t.slice(s + Math.max(0, Math.trunc(len)));
};
const SUBSTITUTE: FormulaFn = (args) => {
  const t = textAt(args, 0);
  if (isError(t)) return t;
  const oldT = textAt(args, 1);
  if (isError(oldT)) return oldT;
  const newT = textAt(args, 2);
  if (isError(newT)) return newT;
  if (oldT === '') return t;
  if (args.length > 3) {
    const which = numAt(args, 3);
    if (isError(which)) return which;
    let count = 0;
    let idx = t.indexOf(oldT);
    while (idx >= 0) {
      count++;
      if (count === Math.trunc(which)) return t.slice(0, idx) + newT + t.slice(idx + oldT.length);
      idx = t.indexOf(oldT, idx + oldT.length);
    }
    return t;
  }
  return t.split(oldT).join(newT);
};
const CHAR: FormulaFn = (args) => {
  const n = numAt(args, 0);
  if (isError(n)) return n;
  const code = Math.trunc(n);
  if (code < 1 || code > 65535) return ERR.VALUE;
  return String.fromCharCode(code);
};
const CODE: FormulaFn = (args) => {
  const t = textAt(args, 0);
  if (isError(t)) return t;
  if (t.length === 0) return ERR.VALUE;
  return t.charCodeAt(0);
};
const VALUEFN: FormulaFn = (args) => {
  const v = scalarOf(argAt(args, 0));
  if (isError(v)) return v;
  const n = toNumber(v);
  return n;
};
const TEXTFN: FormulaFn = (args, ctx) => {
  const v = scalarOf(argAt(args, 0));
  if (isError(v)) return v;
  const fmt = textAt(args, 1);
  if (isError(fmt)) return fmt;
  return applyTextFormat(v, fmt, ctx.resolver.locale ?? 'en-US');
};

/** Minimal TEXT() number-format subset (`0`, `0.00`, `#,##0`, `0%`, else default). */
function applyTextFormat(v: FormulaValue, fmt: string, locale: string): string | FormulaError {
  const n = toNumber(v);
  if (isError(n)) return typeof v === 'string' ? v : ERR.VALUE;
  const f = fmt.trim();
  const percent = f.includes('%');
  const comma = f.includes(',');
  const dotIdx = f.indexOf('.');
  const decimals = dotIdx >= 0 ? (f.slice(dotIdx + 1).match(/0/g)?.length ?? 0) : 0;
  return new Intl.NumberFormat(locale, {
    style: percent ? 'percent' : 'decimal',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: comma,
  }).format(n);
}

// ---------------------------------------------------------------------------
// Lookup / reference
// ---------------------------------------------------------------------------

function rangeCell(r: RangeValue, row: number, col: number): FormulaValue {
  return (r.values[row * r.cols + col] as FormulaValue) ?? null;
}

const VLOOKUP: FormulaFn = (args) => lookupTable(args, 'v');
const HLOOKUP: FormulaFn = (args) => lookupTable(args, 'h');

function lookupTable(args: EvalResult[], axis: 'v' | 'h'): FormulaValue {
  const key = scalarOf(argAt(args, 0));
  if (isError(key)) return key;
  const table = argAt(args, 1);
  if (!isRange(table)) return ERR.VALUE;
  const idx = numAt(args, 2);
  if (isError(idx)) return idx;
  const approx = args.length > 3 ? toBoolean(scalarOf(argAt(args, 3))) : true;
  if (isError(approx)) return approx;
  const index = Math.trunc(idx) - 1;
  if (index < 0) return ERR.VALUE;

  const lines = axis === 'v' ? table.rows : table.cols;
  const cellAt = (line: number): FormulaValue =>
    axis === 'v' ? rangeCell(table, line, 0) : rangeCell(table, 0, line);

  let found = -1;
  if (approx) {
    // Assume ascending; take the largest value ≤ key.
    for (let i = 0; i < lines; i++) {
      const c = compareValues(cellAt(i), key);
      if (c <= 0) found = i;
      else break;
    }
  } else {
    for (let i = 0; i < lines; i++) {
      if (compareValues(cellAt(i), key) === 0) {
        found = i;
        break;
      }
    }
  }
  if (found < 0) return ERR.NA;
  return axis === 'v'
    ? (index < table.cols ? rangeCell(table, found, index) : ERR.REF)
    : (index < table.rows ? rangeCell(table, index, found) : ERR.REF);
}

const MATCHFN: FormulaFn = (args) => {
  const key = scalarOf(argAt(args, 0));
  if (isError(key)) return key;
  const vec = argAt(args, 1);
  if (!isRange(vec)) return ERR.NA;
  const type = args.length > 2 ? numAt(args, 2) : 1;
  if (isError(type)) return type;
  const t = Math.sign(Math.trunc(type));
  const vals = vec.values;
  if (t === 0) {
    for (let i = 0; i < vals.length; i++) if (compareValues(vals[i] as FormulaValue, key) === 0) return i + 1;
    return ERR.NA;
  }
  let found = -1;
  for (let i = 0; i < vals.length; i++) {
    const c = compareValues(vals[i] as FormulaValue, key);
    if (t === 1 && c <= 0) found = i;
    else if (t === 1 && c > 0) break;
    else if (t === -1 && c >= 0) found = i;
    else if (t === -1 && c < 0) break;
  }
  return found < 0 ? ERR.NA : found + 1;
};

const INDEXFN: FormulaFn = (args) => {
  const table = argAt(args, 0);
  const rowNum = numAt(args, 1);
  if (isError(rowNum)) return rowNum;
  // Reference form (`CAP-FORMULA-REFVAL`): return a sub-reference (0 = whole row/col).
  if (isReference(table)) {
    const colNum = args.length > 2 ? numAt(args, 2) : (table.rows === 1 ? 1 : 0);
    if (isError(colNum)) return colNum;
    let r = Math.trunc(rowNum);
    let c = Math.trunc(colNum);
    if (args.length <= 2 && table.rows === 1) { c = r; r = 1; }
    if (r < 0 || r > table.rows || c < 0 || c > table.cols) return ERR.REF;
    if (r === 0 && c === 0) return table;
    if (r === 0) return { kind: 'reference', top: table.top, left: table.left + c - 1, rows: table.rows, cols: 1 };
    if (c === 0) return { kind: 'reference', top: table.top + r - 1, left: table.left, rows: 1, cols: table.cols };
    return { kind: 'reference', top: table.top + r - 1, left: table.left + c - 1, rows: 1, cols: 1 };
  }
  // Array form (a range value from a nested function): return the scalar at (r,c).
  if (!isRange(table)) return ERR.REF;
  let r = Math.trunc(rowNum);
  let c: number;
  if (args.length > 2) {
    const colNum = numAt(args, 2);
    if (isError(colNum)) return colNum;
    c = Math.trunc(colNum);
  } else if (table.rows === 1) {
    c = r; // a single-row vector: the one index is the column
    r = 1;
  } else {
    c = 1; // a single-column vector (or default first column)
  }
  if (r < 1 || r > table.rows || c < 1 || c > table.cols) return ERR.REF;
  return rangeCell(table, r - 1, c - 1);
};
const OFFSET: FormulaFn = (args) => {
  const base = argAt(args, 0);
  if (!isReference(base)) return ERR.REF;
  const dr = numAt(args, 1);
  if (isError(dr)) return dr;
  const dc = numAt(args, 2);
  if (isError(dc)) return dc;
  const h = args.length > 3 && scalarOf(argAt(args, 3)) != null ? numAt(args, 3) : base.rows;
  if (isError(h)) return h;
  const w = args.length > 4 && scalarOf(argAt(args, 4)) != null ? numAt(args, 4) : base.cols;
  if (isError(w)) return w;
  const top = base.top + Math.trunc(dr);
  const left = base.left + Math.trunc(dc);
  if (top < 0 || left < 0 || Math.trunc(h) < 1 || Math.trunc(w) < 1) return ERR.REF;
  return { kind: 'reference', top, left, rows: Math.trunc(h), cols: Math.trunc(w) };
};
const INDIRECT: FormulaFn = (args) => {
  const t = textAt(args, 0);
  if (isError(t)) return t;
  const parts = t.split(':');
  if (parts.length === 2 && looksLikeA1((parts[0] as string).trim()) && looksLikeA1((parts[1] as string).trim())) {
    const s = parseA1((parts[0] as string).trim());
    const e = parseA1((parts[1] as string).trim());
    if (!s || !e) return ERR.REF;
    return { kind: 'reference', top: Math.min(s.row, e.row), left: Math.min(s.col, e.col), rows: Math.abs(e.row - s.row) + 1, cols: Math.abs(e.col - s.col) + 1 };
  }
  const trimmed = t.trim();
  if (!looksLikeA1(trimmed)) return ERR.REF;
  const c = parseA1(trimmed);
  if (!c) return ERR.REF;
  return { kind: 'reference', top: c.row, left: c.col, rows: 1, cols: 1 };
};
const ISFORMULA: FormulaFn = (args, ctx) => {
  const a = argAt(args, 0);
  if (!isReference(a)) return ERR.VALUE;
  return ctx.resolver.formulaSourceAt?.(a.left, a.top) !== undefined;
};
const FORMULATEXT: FormulaFn = (args, ctx) => {
  const a = argAt(args, 0);
  if (!isReference(a)) return ERR.NA;
  return ctx.resolver.formulaSourceAt?.(a.left, a.top) ?? ERR.NA;
};
const ISREF: FormulaFn = (args) => isReference(argAt(args, 0));
const CELLFN: FormulaFn = (args, ctx) => {
  const info = textAt(args, 0);
  if (isError(info)) return info;
  const a = args.length > 1 ? argAt(args, 1) : undefined;
  const ref: ReferenceValue = isReference(a)
    ? a
    : { kind: 'reference', top: ctx.resolver.currentRow - 1, left: ctx.resolver.currentCol - 1, rows: 1, cols: 1 };
  const val = (): FormulaValue => ctx.resolver.getValue({ col: ref.left, row: ref.top, colAbs: false, rowAbs: false });
  switch (info.toLowerCase()) {
    case 'row': return ref.top + 1;
    case 'col': return ref.left + 1;
    case 'address': return `$${indexToColLetters(ref.left)}$${ref.top + 1}`;
    case 'contents': return val();
    case 'width': return 10; // host-dependent default
    case 'type': { const v = val(); return v == null || v === '' ? 'b' : typeof v === 'string' ? 'l' : 'v'; }
    default: return ERR.VALUE;
  }
};

const CHOOSE: FormulaFn = (args) => {
  const idx = numAt(args, 0);
  if (isError(idx)) return idx;
  const i = Math.trunc(idx);
  if (i < 1 || i >= args.length) return ERR.VALUE;
  return scalarOf(argAt(args, i));
};

const ROWFN: FormulaFn = (args, ctx) => {
  if (args.length === 0) return ctx.resolver.currentRow;
  const a = argAt(args, 0);
  return isReference(a) ? a.top + 1 : ctx.resolver.currentRow; // scalar form: top of a multi-row ref
};
const COLUMNFN: FormulaFn = (args, ctx) => {
  if (args.length === 0) return ctx.resolver.currentCol;
  const a = argAt(args, 0);
  return isReference(a) ? a.left + 1 : ctx.resolver.currentCol;
};
const ROWSFN: FormulaFn = (args) => {
  const r = argAt(args, 0);
  if (isReference(r)) return r.rows;
  return isRange(r) ? r.rows : 1;
};
const COLUMNSFN: FormulaFn = (args) => {
  const r = argAt(args, 0);
  if (isReference(r)) return r.cols;
  return isRange(r) ? r.cols : 1;
};

// ---------------------------------------------------------------------------
// Date
// ---------------------------------------------------------------------------

/** Excel serial date (days since 1899-12-30). Uses UTC fields for TZ-stability. */
function toSerial(d: Date): number {
  const utc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.floor(utc / 86_400_000) + 25569;
}
function fromSerial(serial: number): Date {
  return new Date((serial - 25569) * 86_400_000);
}
const TODAY: FormulaFn = (_a, ctx) => toSerial(ctx.resolver.now());
const NOWFN: FormulaFn = (_a, ctx) => {
  const d = ctx.resolver.now();
  return toSerial(d) + (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400;
};
const DATEFN: FormulaFn = (args) => {
  const y = numAt(args, 0);
  if (isError(y)) return y;
  const m = numAt(args, 1);
  if (isError(m)) return m;
  const d = numAt(args, 2);
  if (isError(d)) return d;
  return toSerial(new Date(Date.UTC(Math.trunc(y), Math.trunc(m) - 1, Math.trunc(d))));
};
const datePart = (part: 'y' | 'm' | 'd'): FormulaFn => (args) => {
  const n = numAt(args, 0);
  if (isError(n)) return n;
  const d = fromSerial(n);
  return part === 'y' ? d.getUTCFullYear() : part === 'm' ? d.getUTCMonth() + 1 : d.getUTCDate();
};

// ---------------------------------------------------------------------------
// Info
// ---------------------------------------------------------------------------

const ISNUMBER: FormulaFn = (args) => typeof scalarOf(argAt(args, 0)) === 'number';
const ISTEXT: FormulaFn = (args) => typeof scalarOf(argAt(args, 0)) === 'string';
const ISBLANK: FormulaFn = (args) => isBlank(scalarOf(argAt(args, 0)));
const ISERROR: FormulaFn = (args) => isError(scalarOf(argAt(args, 0)));
const ISERR: FormulaFn = (args) => {
  const v = scalarOf(argAt(args, 0));
  return v instanceof FormulaError && v.code !== '#N/A';
};
const ISNA: FormulaFn = (args) => {
  const v = scalarOf(argAt(args, 0));
  return v instanceof FormulaError && v.code === '#N/A';
};
const NFN: FormulaFn = (args) => {
  const v = scalarOf(argAt(args, 0));
  if (isError(v)) return v;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return 0;
};

// ---------------------------------------------------------------------------
// Slice 42e — Date/time + text.  (`FIXED`/`DOLLAR` use a default en-US format;
// routing them + the date formatters through `COMPONENT-I18N` locale is a small
// follow-up — it needs a `locale` on the `CellResolver`.  [REVISIT])
// ---------------------------------------------------------------------------

function timeParts(serial: number): { h: number; m: number; s: number } {
  const frac = serial - Math.floor(serial);
  let sec = Math.round(frac * 86400);
  const h = Math.floor(sec / 3600);
  sec -= h * 3600;
  const m = Math.floor(sec / 60);
  return { h: h % 24, m, s: sec - m * 60 };
}
function daysInMonth(y: number, m0: number): number {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
}
function daysInYear(y: number): number {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365;
}
function addMonths(serial: number, months: number, eom: boolean): number {
  const d = fromSerial(serial);
  const total = d.getUTCMonth() + Math.trunc(months);
  const ty = d.getUTCFullYear() + Math.floor(total / 12);
  const tm = ((total % 12) + 12) % 12;
  const dim = daysInMonth(ty, tm);
  const day = eom ? dim : Math.min(d.getUTCDate(), dim);
  return toSerial(new Date(Date.UTC(ty, tm, day)));
}
function parseDateText(text: string): number | null {
  let m = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (m) return toSerial(new Date(Date.UTC(+(m[1] as string), +(m[2] as string) - 1, +(m[3] as string))));
  m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text);
  if (m) return toSerial(new Date(Date.UTC(+(m[3] as string), +(m[1] as string) - 1, +(m[2] as string))));
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : toSerial(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())));
}
function days360(sSerial: number, eSerial: number, european: boolean): number {
  const ds = fromSerial(sSerial);
  const de = fromSerial(eSerial);
  let d1 = ds.getUTCDate();
  let d2 = de.getUTCDate();
  if (european) {
    if (d1 === 31) d1 = 30;
    if (d2 === 31) d2 = 30;
  } else {
    if (d1 === 31) d1 = 30;
    if (d2 === 31 && d1 === 30) d2 = 30;
  }
  return (de.getUTCFullYear() - ds.getUTCFullYear()) * 360 + (de.getUTCMonth() - ds.getUTCMonth()) * 30 + (d2 - d1);
}
function weekendSet(arg: EvalResult | undefined): Set<number> | null {
  if (arg === undefined) return new Set([0, 6]);
  const v = scalarOf(arg);
  if (typeof v === 'number') {
    const pair: Record<number, number[]> = {
      1: [6, 0], 2: [0, 1], 3: [1, 2], 4: [2, 3], 5: [3, 4], 6: [4, 5], 7: [5, 6],
      11: [0], 12: [1], 13: [2], 14: [3], 15: [4], 16: [5], 17: [6],
    };
    const days = pair[Math.trunc(v)];
    return days ? new Set(days) : null;
  }
  if (typeof v === 'string' && v.length === 7) {
    const s = new Set<number>();
    for (let i = 0; i < 7; i++) if (v[i] === '1') s.add((i + 1) % 7); // Mon..Sun → Sun=0
    return s;
  }
  return null;
}
function holidaySet(arg: EvalResult | undefined): Set<number> {
  const set = new Set<number>();
  if (arg === undefined) return set;
  const vals = isRange(arg) ? arg.values : [scalarOf(arg)];
  for (const v of vals) if (typeof v === 'number') set.add(Math.trunc(v));
  return set;
}
const TIME: FormulaFn = (args) => {
  const h = numAt(args, 0), m = numAt(args, 1), s = numAt(args, 2);
  if (isError(h)) return h;
  if (isError(m)) return m;
  if (isError(s)) return s;
  const total = (((h * 3600 + m * 60 + s) % 86400) + 86400) % 86400;
  return total / 86400;
};
const timeGetter = (part: 'h' | 'm' | 's'): FormulaFn => (args) => {
  const n = numAt(args, 0);
  if (isError(n)) return n;
  return timeParts(n)[part];
};
const DATEVALUE: FormulaFn = (args) => {
  const t = textAt(args, 0);
  if (isError(t)) return t;
  const s = parseDateText(t);
  return s === null ? ERR.VALUE : s;
};
const TIMEVALUE: FormulaFn = (args) => {
  const t = textAt(args, 0);
  if (isError(t)) return t;
  const m = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i.exec(t);
  if (!m) return ERR.VALUE;
  let h = +(m[1] as string);
  const ap = m[4]?.toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return (h * 3600 + +(m[2] as string) * 60 + (m[3] ? +m[3] : 0)) / 86400;
};
const DATEDIF: FormulaFn = (args) => {
  const start = numAt(args, 0), end = numAt(args, 1), unit = textAt(args, 2);
  if (isError(start)) return start;
  if (isError(end)) return end;
  if (isError(unit)) return unit;
  if (end < start) return ERR.NUM;
  const s = fromSerial(start), e = fromSerial(end);
  const sm = s.getUTCMonth(), sd = s.getUTCDate();
  const em = e.getUTCMonth(), ed = e.getUTCDate();
  switch ((unit as string).toUpperCase()) {
    case 'D': return Math.trunc(end) - Math.trunc(start);
    case 'Y': { let y = e.getUTCFullYear() - s.getUTCFullYear(); if (em < sm || (em === sm && ed < sd)) y--; return y; }
    case 'M': { let m = (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (em - sm); if (ed < sd) m--; return m; }
    case 'YM': { let m = em - sm; if (ed < sd) m--; if (m < 0) m += 12; return m; }
    case 'MD': { let d = ed - sd; if (d < 0) d += daysInMonth(e.getUTCFullYear(), em - 1 < 0 ? 11 : em - 1); return d; }
    case 'YD': {
      let ay = e.getUTCFullYear();
      if (toSerial(new Date(Date.UTC(ay, sm, sd))) > Math.trunc(end)) ay--;
      return Math.trunc(end) - toSerial(new Date(Date.UTC(ay, sm, sd)));
    }
    default: return ERR.NUM;
  }
};
const DAYS: FormulaFn = (args) => {
  const end = numAt(args, 0), start = numAt(args, 1);
  if (isError(end)) return end;
  if (isError(start)) return start;
  return Math.trunc(end) - Math.trunc(start);
};
const DAYS360: FormulaFn = (args) => {
  const start = numAt(args, 0), end = numAt(args, 1);
  if (isError(start)) return start;
  if (isError(end)) return end;
  const eu = args.length > 2 ? toBoolean(scalarOf(argAt(args, 2))) : false;
  if (isError(eu)) return eu;
  return days360(start, end, eu);
};
const EDATE: FormulaFn = (args) => {
  const start = numAt(args, 0), months = numAt(args, 1);
  if (isError(start)) return start;
  if (isError(months)) return months;
  return addMonths(start, months, false);
};
const EOMONTH: FormulaFn = (args) => {
  const start = numAt(args, 0), months = numAt(args, 1);
  if (isError(start)) return start;
  if (isError(months)) return months;
  return addMonths(start, months, true);
};
const WEEKDAY: FormulaFn = (args) => {
  const serial = numAt(args, 0);
  if (isError(serial)) return serial;
  const type = args.length > 1 ? numAt(args, 1) : 1;
  if (isError(type)) return type;
  const dow = fromSerial(serial).getUTCDay();
  const t = Math.trunc(type);
  if (t === 3) return (dow + 6) % 7;
  let startDow: number;
  if (t === 1) startDow = 0;
  else if (t === 2) startDow = 1;
  else if (t >= 11 && t <= 17) startDow = (t - 10) % 7;
  else return ERR.NUM;
  return ((dow - startDow + 7) % 7) + 1;
};
const WEEKNUM: FormulaFn = (args) => {
  const serial = numAt(args, 0);
  if (isError(serial)) return serial;
  const type = args.length > 1 ? numAt(args, 1) : 1;
  if (isError(type)) return type;
  if (Math.trunc(type) === 21) return isoWeek(serial);
  const d = fromSerial(serial);
  const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const startDow = Math.trunc(type) === 2 ? 1 : 0;
  const dayOfYear = Math.floor((d.getTime() - jan1.getTime()) / 86400000);
  const offset = (jan1.getUTCDay() - startDow + 7) % 7;
  return Math.floor((dayOfYear + offset) / 7) + 1;
};
function isoWeek(serial: number): number {
  const d = fromSerial(serial);
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const ft = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  ft.setUTCDate(ft.getUTCDate() - ((ft.getUTCDay() + 6) % 7) + 3);
  return 1 + Math.round((date.getTime() - ft.getTime()) / (7 * 86400000));
}
const ISOWEEKNUM: FormulaFn = (args) => {
  const serial = numAt(args, 0);
  return isError(serial) ? serial : isoWeek(serial);
};
const YEARFRAC: FormulaFn = (args) => {
  let start = numAt(args, 0);
  let end = numAt(args, 1);
  if (isError(start)) return start;
  if (isError(end)) return end;
  const basis = args.length > 2 ? numAt(args, 2) : 0;
  if (isError(basis)) return basis;
  if ((start as number) > (end as number)) { const t = start; start = end; end = t; }
  const s = start as number;
  const e = end as number;
  switch (Math.trunc(basis)) {
    case 0: return days360(s, e, false) / 360;
    case 1: {
      const y1 = fromSerial(s).getUTCFullYear();
      const y2 = fromSerial(e).getUTCFullYear();
      if (y1 === y2) return (e - s) / daysInYear(y1);
      let total = 0;
      for (let y = y1; y <= y2; y++) total += daysInYear(y);
      return (e - s) / (total / (y2 - y1 + 1));
    }
    case 2: return (e - s) / 360;
    case 3: return (e - s) / 365;
    case 4: return days360(s, e, true) / 360;
    default: return ERR.NUM;
  }
};
const NETWORKDAYS = (intl: boolean): FormulaFn => (args) => {
  const start = numAt(args, 0), end = numAt(args, 1);
  if (isError(start)) return start;
  if (isError(end)) return end;
  const wknd = intl ? weekendSet(argAt(args, 2)) : new Set([0, 6]);
  if (!wknd) return ERR.NUM;
  const hol = holidaySet(argAt(args, intl ? 3 : 2));
  let s = Math.trunc(start);
  let e = Math.trunc(end);
  let sign = 1;
  if (s > e) { const t = s; s = e; e = t; sign = -1; }
  let count = 0;
  for (let d = s; d <= e; d++) {
    const dow = fromSerial(d).getUTCDay();
    if (!wknd.has(dow) && !hol.has(d)) count++;
  }
  return count * sign;
};
const WORKDAY = (intl: boolean): FormulaFn => (args) => {
  const start = numAt(args, 0), days = numAt(args, 1);
  if (isError(start)) return start;
  if (isError(days)) return days;
  const wknd = intl ? weekendSet(argAt(args, 2)) : new Set([0, 6]);
  if (!wknd) return ERR.NUM;
  const hol = holidaySet(argAt(args, intl ? 3 : 2));
  let d = Math.trunc(start);
  const step = days >= 0 ? 1 : -1;
  let remaining = Math.abs(Math.trunc(days));
  while (remaining > 0) {
    d += step;
    const dow = fromSerial(d).getUTCDay();
    if (!wknd.has(dow) && !hol.has(d)) remaining--;
  }
  return d;
};

// --- Text -------------------------------------------------------------------
/** `COMPONENT-I18N` — the locale's default ISO-4217 currency (for `DOLLAR`). */
function currencyForLocale(locale: string): string {
  const region = (locale.split(/[-_]/)[1] ?? '').toUpperCase();
  const map: Record<string, string> = {
    US: 'USD', GB: 'GBP', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', IE: 'EUR',
    JP: 'JPY', CN: 'CNY', IN: 'INR', CA: 'CAD', AU: 'AUD', CH: 'CHF', BR: 'BRL', MX: 'MXN',
    KR: 'KRW', RU: 'RUB', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', ZA: 'ZAR',
  };
  return map[region] ?? 'USD';
}
const FIXED: FormulaFn = (args, ctx) => {
  const n = numAt(args, 0);
  if (isError(n)) return n;
  const dec = args.length > 1 ? numAt(args, 1) : 2;
  if (isError(dec)) return dec;
  const noCommas = args.length > 2 ? toBoolean(scalarOf(argAt(args, 2))) : false;
  if (isError(noCommas)) return noCommas;
  const dd = Math.trunc(dec);
  let val = n;
  let places = dd;
  if (dd < 0) { const f = Math.pow(10, -dd); val = Math.round(n / f) * f; places = 0; }
  places = Math.max(0, places);
  return new Intl.NumberFormat(ctx.resolver.locale ?? 'en-US', {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
    useGrouping: !noCommas,
  }).format(val);
};
const DOLLAR: FormulaFn = (args, ctx) => {
  const n = numAt(args, 0);
  if (isError(n)) return n;
  const dec = args.length > 1 ? numAt(args, 1) : 2;
  if (isError(dec)) return dec;
  const d = Math.max(0, Math.trunc(dec));
  const locale = ctx.resolver.locale ?? 'en-US';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currencyForLocale(locale),
    currencySign: 'accounting', // Excel wraps negatives in parens
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(n);
};
const NUMBERVALUE: FormulaFn = (args) => {
  const t = textAt(args, 0);
  if (isError(t)) return t;
  const decSep = args.length > 1 ? textAt(args, 1) : '.';
  if (isError(decSep)) return decSep;
  const grpSep = args.length > 2 ? textAt(args, 2) : ',';
  if (isError(grpSep)) return grpSep;
  let s = t.trim().split(grpSep || ',').join('');
  if (decSep && decSep !== '.') s = s.split(decSep).join('.');
  let pctScale = 1;
  while (s.endsWith('%')) { s = s.slice(0, -1); pctScale /= 100; }
  const n = Number(s);
  return Number.isNaN(n) ? ERR.VALUE : n * pctScale;
};
const CLEAN: FormulaFn = (args) => {
  const t = textAt(args, 0);
  if (isError(t)) return t;
  let out = '';
  for (const ch of t) if (ch.charCodeAt(0) >= 32) out += ch;
  return out;
};
const TFN: FormulaFn = (args) => {
  const v = scalarOf(argAt(args, 0));
  return typeof v === 'string' ? v : '';
};
const UNICHAR: FormulaFn = (args) => {
  const n = numAt(args, 0);
  if (isError(n)) return n;
  const code = Math.trunc(n);
  if (code < 1 || code > 0x10ffff) return ERR.VALUE;
  return String.fromCodePoint(code);
};
const UNICODE: FormulaFn = (args) => {
  const t = textAt(args, 0);
  if (isError(t)) return t;
  return t.length === 0 ? ERR.VALUE : (t.codePointAt(0) as number);
};
function textBeforeAfter(args: EvalResult[], after: boolean): FormulaValue {
  const t = textAt(args, 0);
  if (isError(t)) return t;
  const delim = textAt(args, 1);
  if (isError(delim)) return delim;
  const inst = args.length > 2 ? numAt(args, 2) : 1;
  if (isError(inst)) return inst;
  const n = Math.trunc(inst);
  if (delim === '') return after ? t : '';
  let idx = -1;
  if (n > 0) {
    let from = 0;
    for (let k = 0; k < n; k++) {
      idx = t.indexOf(delim, from);
      if (idx < 0) break;
      from = idx + delim.length;
    }
  } else {
    let from = t.length;
    for (let k = 0; k < -n; k++) {
      idx = t.lastIndexOf(delim, from - 1);
      if (idx < 0) break;
      from = idx;
    }
  }
  if (idx < 0) return ERR.NA;
  return after ? t.slice(idx + delim.length) : t.slice(0, idx);
}
const VALUETOTEXT: FormulaFn = (args) => {
  const v = scalarOf(argAt(args, 0));
  const t = toText(v);
  return isError(t) ? (v instanceof FormulaError ? v.code : ERR.VALUE) : t;
};
const REGEXTEST: FormulaFn = (args) => {
  const t = textAt(args, 0);
  if (isError(t)) return t;
  const p = textAt(args, 1);
  if (isError(p)) return p;
  try {
    return new RegExp(p).test(t);
  } catch {
    return ERR.VALUE;
  }
};
const REGEXEXTRACT: FormulaFn = (args) => {
  const t = textAt(args, 0);
  if (isError(t)) return t;
  const p = textAt(args, 1);
  if (isError(p)) return p;
  try {
    const m = new RegExp(p).exec(t);
    return m ? (m[1] ?? m[0]) : ERR.NA;
  } catch {
    return ERR.VALUE;
  }
};
const REGEXREPLACE: FormulaFn = (args) => {
  const t = textAt(args, 0);
  if (isError(t)) return t;
  const p = textAt(args, 1);
  if (isError(p)) return p;
  const repl = textAt(args, 2);
  if (isError(repl)) return repl;
  try {
    return t.replace(new RegExp(p, 'g'), repl);
  } catch {
    return ERR.VALUE;
  }
};

// ---------------------------------------------------------------------------
// Slice 42f — Engineering (base conversions, bitwise, CONVERT, complex, ERF).
// ---------------------------------------------------------------------------

// --- Base conversions (Excel 10-digit two's-complement) --------------------
function decToBase(n: number, radix: number, digits: number): string | FormulaError {
  n = Math.trunc(n);
  const range = Math.pow(radix, digits);
  const half = range / 2;
  if (n < -half || n >= half) return ERR.NUM;
  const val = n < 0 ? range + n : n;
  return val.toString(radix).toUpperCase();
}
function baseToDec(text: string, radix: number, digits: number): number | FormulaError {
  const t = text.trim().toUpperCase();
  if (t.length === 0 || t.length > digits) return ERR.NUM;
  const val = parseInt(t, radix);
  if (Number.isNaN(val) || !new RegExp(`^[0-9A-V]+$`).test(t)) return ERR.NUM;
  const range = Math.pow(radix, digits);
  return val >= range / 2 ? val - range : val;
}
function padPlaces(s: string, args: EvalResult[], placesIdx: number): string | FormulaError {
  if (args.length <= placesIdx) return s;
  const p = numAt(args, placesIdx);
  if (isError(p)) return p;
  if (s.startsWith('-') || s.length >= 10) return s; // negatives are already full-width
  return s.padStart(Math.trunc(p), '0');
}
const dec2 = (radix: number, digits: number): FormulaFn => (args) => {
  const n = numAt(args, 0);
  if (isError(n)) return n;
  const s = decToBase(n, radix, digits);
  return isError(s) ? s : padPlaces(s, args, 1);
};
const from2to = (fromRadix: number, toRadix: number | null): FormulaFn => (args) => {
  const t = textAt(args, 0);
  if (isError(t)) return t;
  const dec = baseToDec(t, fromRadix, 10);
  if (isError(dec)) return dec;
  if (toRadix === null) return dec;
  const s = decToBase(dec, toRadix, 10);
  return isError(s) ? s : padPlaces(s, args, 1);
};

// --- Bitwise (up to 2^48, via BigInt) --------------------------------------
const MAX_BIT = 2 ** 48;
const bitFn = (op: (a: bigint, b: bigint) => bigint): FormulaFn => (args) => {
  const a = numAt(args, 0);
  if (isError(a)) return a;
  const b = numAt(args, 1);
  if (isError(b)) return b;
  if (a < 0 || b < 0 || a >= MAX_BIT || b >= MAX_BIT) return ERR.NUM;
  return Number(op(BigInt(Math.trunc(a)), BigInt(Math.trunc(b))));
};
const BITLSHIFT: FormulaFn = (args) => {
  const a = numAt(args, 0);
  if (isError(a)) return a;
  const n = numAt(args, 1);
  if (isError(n)) return n;
  if (a < 0 || a >= MAX_BIT || Math.abs(n) > 53) return ERR.NUM;
  const sh = Math.trunc(n);
  const r = sh >= 0 ? BigInt(Math.trunc(a)) << BigInt(sh) : BigInt(Math.trunc(a)) >> BigInt(-sh);
  return r >= BigInt(MAX_BIT) ? ERR.NUM : Number(r);
};
const BITRSHIFT: FormulaFn = (args) => {
  const a = numAt(args, 0);
  if (isError(a)) return a;
  const n = numAt(args, 1);
  if (isError(n)) return n;
  if (a < 0 || a >= MAX_BIT || Math.abs(n) > 53) return ERR.NUM;
  const sh = Math.trunc(n);
  const r = sh >= 0 ? BigInt(Math.trunc(a)) >> BigInt(sh) : BigInt(Math.trunc(a)) << BigInt(-sh);
  return r >= BigInt(MAX_BIT) ? ERR.NUM : Number(r);
};

// --- CONVERT (a practical subset) ------------------------------------------
const CONVERT_UNITS: Record<string, { cat: string; factor: number }> = {
  // mass (base gram)
  g: { cat: 'mass', factor: 1 }, kg: { cat: 'mass', factor: 1000 }, mg: { cat: 'mass', factor: 0.001 },
  lbm: { cat: 'mass', factor: 453.59237 }, ozm: { cat: 'mass', factor: 28.349523125 },
  u: { cat: 'mass', factor: 1.66053886e-24 }, stone: { cat: 'mass', factor: 6350.29318 }, ton: { cat: 'mass', factor: 907184.74 },
  // distance (base meter)
  m: { cat: 'dist', factor: 1 }, km: { cat: 'dist', factor: 1000 }, cm: { cat: 'dist', factor: 0.01 },
  mm: { cat: 'dist', factor: 0.001 }, mi: { cat: 'dist', factor: 1609.344 }, yd: { cat: 'dist', factor: 0.9144 },
  ft: { cat: 'dist', factor: 0.3048 }, in: { cat: 'dist', factor: 0.0254 }, nmi: { cat: 'dist', factor: 1852 },
  ang: { cat: 'dist', factor: 1e-10 }, ly: { cat: 'dist', factor: 9.4607304725808e15 }, pica: { cat: 'dist', factor: 0.0254 / 6 },
  // time (base second)
  sec: { cat: 'time', factor: 1 }, s: { cat: 'time', factor: 1 }, min: { cat: 'time', factor: 60 },
  mn: { cat: 'time', factor: 60 }, hr: { cat: 'time', factor: 3600 }, day: { cat: 'time', factor: 86400 },
  d: { cat: 'time', factor: 86400 }, yr: { cat: 'time', factor: 31557600 },
  // pressure (base pascal)
  Pa: { cat: 'pressure', factor: 1 }, p: { cat: 'pressure', factor: 1 }, atm: { cat: 'pressure', factor: 101325 },
  at: { cat: 'pressure', factor: 101325 }, mmHg: { cat: 'pressure', factor: 133.322 }, psi: { cat: 'pressure', factor: 6894.75729 }, Torr: { cat: 'pressure', factor: 133.322 },
  // force (base newton)
  N: { cat: 'force', factor: 1 }, dyn: { cat: 'force', factor: 1e-5 }, dy: { cat: 'force', factor: 1e-5 },
  lbf: { cat: 'force', factor: 4.4482216153 }, pond: { cat: 'force', factor: 9.80665e-3 },
  // energy (base joule)
  J: { cat: 'energy', factor: 1 }, e: { cat: 'energy', factor: 1e-7 }, cal: { cat: 'energy', factor: 4.184 },
  eV: { cat: 'energy', factor: 1.602176634e-19 }, ev: { cat: 'energy', factor: 1.602176634e-19 },
  Wh: { cat: 'energy', factor: 3600 }, wh: { cat: 'energy', factor: 3600 }, BTU: { cat: 'energy', factor: 1055.05585 }, HPh: { cat: 'energy', factor: 2684519.54 },
  // power (base watt)
  W: { cat: 'power', factor: 1 }, w: { cat: 'power', factor: 1 }, HP: { cat: 'power', factor: 745.699872 }, h: { cat: 'power', factor: 745.699872 }, PS: { cat: 'power', factor: 735.49875 },
  // magnetism (base tesla)
  T: { cat: 'mag', factor: 1 }, ga: { cat: 'mag', factor: 1e-4 },
  // volume (base liter)
  L: { cat: 'vol', factor: 1 }, l: { cat: 'vol', factor: 1 }, m3: { cat: 'vol', factor: 1000 }, gal: { cat: 'vol', factor: 3.785411784 },
  qt: { cat: 'vol', factor: 0.946352946 }, pt: { cat: 'vol', factor: 0.473176473 }, cup: { cat: 'vol', factor: 0.2365882365 },
  tbs: { cat: 'vol', factor: 0.0147867648 }, tsp: { cat: 'vol', factor: 0.00492892159 }, 'oz': { cat: 'vol', factor: 0.0295735296 },
  // area (base m²)
  m2: { cat: 'area', factor: 1 }, mi2: { cat: 'area', factor: 2589988.110336 }, acre: { cat: 'area', factor: 4046.8564224 },
  ha: { cat: 'area', factor: 10000 }, ft2: { cat: 'area', factor: 0.09290304 }, in2: { cat: 'area', factor: 0.00064516 }, km2: { cat: 'area', factor: 1e6 },
  // speed (base m/s)
  'm/s': { cat: 'speed', factor: 1 }, 'm/h': { cat: 'speed', factor: 1 / 3600 }, 'km/h': { cat: 'speed', factor: 1 / 3.6 },
  mph: { cat: 'speed', factor: 0.44704 }, kn: { cat: 'speed', factor: 0.514444444 }, admkn: { cat: 'speed', factor: 0.514773333 },
};
/** Metric (SI) prefixes applicable to a base metric unit (`kW`, `mL`, `MPa`, …). */
const METRIC_PREFIX: Record<string, number> = {
  Y: 1e24, Z: 1e21, E: 1e18, P: 1e15, T: 1e12, G: 1e9, M: 1e6, k: 1e3, h: 1e2, da: 1e1,
  d: 1e-1, c: 1e-2, m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15, a: 1e-18, z: 1e-21, y: 1e-24,
};
const METRIC_BASE = new Set(['g', 'm', 's', 'sec', 'L', 'l', 'Pa', 'N', 'J', 'W', 'cal', 'T', 'm2', 'm3', 'K']);
/** Resolve a CONVERT unit, applying a metric prefix if the bare unit isn't listed. */
function resolveUnit(name: string): { cat: string; factor: number } | null {
  const direct = CONVERT_UNITS[name];
  if (direct) return direct;
  for (const plen of [2, 1]) {
    const pre = name.slice(0, plen);
    const base = name.slice(plen);
    const p = METRIC_PREFIX[pre];
    if (p !== undefined && METRIC_BASE.has(base)) {
      const u = CONVERT_UNITS[base];
      if (u) return { cat: u.cat, factor: u.factor * p };
    }
  }
  return null;
}
function tempToC(v: number, u: string): number | null {
  if (u === 'C' || u === 'cel') return v;
  if (u === 'F' || u === 'fah') return ((v - 32) * 5) / 9;
  if (u === 'K' || u === 'kel') return v - 273.15;
  return null;
}
function tempFromC(v: number, u: string): number | null {
  if (u === 'C' || u === 'cel') return v;
  if (u === 'F' || u === 'fah') return (v * 9) / 5 + 32;
  if (u === 'K' || u === 'kel') return v + 273.15;
  return null;
}
const CONVERT: FormulaFn = (args) => {
  const n = numAt(args, 0);
  if (isError(n)) return n;
  const from = textAt(args, 1);
  if (isError(from)) return from;
  const to = textAt(args, 2);
  if (isError(to)) return to;
  const c = tempToC(n, from);
  if (c !== null) {
    const out = tempFromC(c, to);
    return out === null ? ERR.NA : out;
  }
  const f = resolveUnit(from);
  const t = resolveUnit(to);
  if (!f || !t || f.cat !== t.cat) return ERR.NA;
  return (n * f.factor) / t.factor;
};

// --- DELTA / GESTEP / ERF ---------------------------------------------------
const DELTA: FormulaFn = (args) => {
  const a = numAt(args, 0);
  if (isError(a)) return a;
  const b = args.length > 1 ? numAt(args, 1) : 0;
  if (isError(b)) return b;
  return a === b ? 1 : 0;
};
const GESTEP: FormulaFn = (args) => {
  const a = numAt(args, 0);
  if (isError(a)) return a;
  const step = args.length > 1 ? numAt(args, 1) : 0;
  if (isError(step)) return step;
  return a >= step ? 1 : 0;
};
function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
const ERF: FormulaFn = (args) => {
  const a = numAt(args, 0);
  if (isError(a)) return a;
  if (args.length > 1) {
    const b = numAt(args, 1);
    if (isError(b)) return b;
    return erf(b) - erf(a);
  }
  return erf(a);
};

// --- Bessel functions. Order-0/1 kernels are the Abramowitz & Stegun (public-
// domain, U.S. Government work) polynomial/rational approximations §9.4.1–9.4.6
// (J/Y) and §9.8.1–9.8.8 (I/K); higher integer orders via stable recurrence
// (upward for Y/K and for J when x>n; Miller downward, normalized, for I and for
// J when x≤n). Own Horner evaluation + recurrence code. --------------------------
/** Evaluate Σ coeff[i]·u^i by Horner. */
function poly(coeff: number[], u: number): number {
  let r = 0;
  for (let i = coeff.length - 1; i >= 0; i--) r = r * u + (coeff[i] as number);
  return r;
}
/** J0(x) — A&S 9.4.1 (|x|≤3) / 9.4.3 (x>3). */
function besselJ0(x: number): number {
  const ax = Math.abs(x);
  if (ax <= 3) {
    const t = (x / 3) * (x / 3);
    return poly([1, -2.2499997, 1.2656208, -0.3163866, 0.0444479, -0.0039444, 0.000021], t);
  }
  const z = 3 / ax;
  const f = poly([0.79788456, -0.00000077, -0.0055274, -0.00009512, 0.00137237, -0.00072805, 0.00014476], z);
  const theta = ax - 0.78539816 + z * (-0.04166397 + z * (-0.00003954 + z * (0.00262573 + z * (-0.00054125 + z * (-0.00029333 + z * 0.00013558)))));
  return (f / Math.sqrt(ax)) * Math.cos(theta);
}
/** J1(x) — A&S 9.4.4 (|x|≤3) / 9.4.6 (x>3). */
function besselJ1(x: number): number {
  const ax = Math.abs(x);
  if (ax <= 3) {
    const t = (x / 3) * (x / 3);
    return x * poly([0.5, -0.56249985, 0.21093573, -0.03954289, 0.00443319, -0.00031761, 0.00001109], t);
  }
  const z = 3 / ax;
  const f = poly([0.79788456, 0.00000156, 0.01659667, 0.00017105, -0.00249511, 0.00113653, -0.00020033], z);
  const theta = ax - 2.35619449 + z * (0.12499612 + z * (0.0000565 + z * (-0.00637879 + z * (0.00074348 + z * (0.00079824 + z * -0.00029166)))));
  const result = (f / Math.sqrt(ax)) * Math.cos(theta);
  return x < 0 ? -result : result;
}
/** Y0(x), x>0 — A&S 9.4.2 (x≤3) / 9.4.4 (x>3). */
function besselY0(x: number): number {
  if (x <= 3) {
    const t = (x / 3) * (x / 3);
    const p = poly([0.36746691, 0.60559366, -0.74350384, 0.25300117, -0.04261214, 0.00427916, -0.00024846], t);
    return (2 / Math.PI) * Math.log(x / 2) * besselJ0(x) + p;
  }
  const z = 3 / x;
  const f = poly([0.79788456, -0.00000077, -0.0055274, -0.00009512, 0.00137237, -0.00072805, 0.00014476], z);
  const theta = x - 0.78539816 + z * (-0.04166397 + z * (-0.00003954 + z * (0.00262573 + z * (-0.00054125 + z * (-0.00029333 + z * 0.00013558)))));
  return (f / Math.sqrt(x)) * Math.sin(theta);
}
/** Y1(x), x>0 — A&S 9.4.5 (x≤3) / 9.4.6 (x>3). */
function besselY1(x: number): number {
  if (x <= 3) {
    const t = (x / 3) * (x / 3);
    const p = poly([-0.6366198, 0.2212091, 2.1682709, -1.3164827, 0.3123951, -0.0400976, 0.0027873], t);
    return (2 / Math.PI) * Math.log(x / 2) * besselJ1(x) + p / x;
  }
  const z = 3 / x;
  const f = poly([0.79788456, 0.00000156, 0.01659667, 0.00017105, -0.00249511, 0.00113653, -0.00020033], z);
  const theta = x - 2.35619449 + z * (0.12499612 + z * (0.0000565 + z * (-0.00637879 + z * (0.00074348 + z * (0.00079824 + z * -0.00029166)))));
  return (f / Math.sqrt(x)) * Math.sin(theta);
}
/** I0(x) — A&S 9.8.1 (|x|<3.75) / 9.8.2. */
function besselI0(x: number): number {
  const ax = Math.abs(x);
  if (ax < 3.75) {
    const t = (x / 3.75) * (x / 3.75);
    return poly([1, 3.5156229, 3.0899424, 1.2067492, 0.2659732, 0.0360768, 0.0045813], t);
  }
  const z = 3.75 / ax;
  const p = poly([0.39894228, 0.01328592, 0.00225319, -0.00157565, 0.00916281, -0.02057706, 0.02635537, -0.01647633, 0.00392377], z);
  return (Math.exp(ax) / Math.sqrt(ax)) * p;
}
/** I1(x) — A&S 9.8.3 (|x|<3.75) / 9.8.4. */
function besselI1(x: number): number {
  const ax = Math.abs(x);
  let result: number;
  if (ax < 3.75) {
    const t = (x / 3.75) * (x / 3.75);
    result = ax * poly([0.5, 0.87890594, 0.51498869, 0.15084934, 0.02658733, 0.00301532, 0.00032411], t);
  } else {
    const z = 3.75 / ax;
    const p = poly([0.39894228, -0.03988024, -0.00362018, 0.00163801, -0.01031555, 0.02282967, -0.02895312, 0.01787654, -0.00420059], z);
    result = (Math.exp(ax) / Math.sqrt(ax)) * p;
  }
  return x < 0 ? -result : result;
}
/** K0(x), x>0 — A&S 9.8.5 (x≤2) / 9.8.6. */
function besselK0(x: number): number {
  if (x <= 2) {
    const t = (x / 2) * (x / 2);
    const p = poly([-0.57721566, 0.4227842, 0.23069756, 0.0348859, 0.00262698, 0.0001075, 0.0000074], t);
    return -Math.log(x / 2) * besselI0(x) + p;
  }
  const z = 2 / x;
  const p = poly([1.25331414, -0.07832358, 0.02189568, -0.01062446, 0.00587872, -0.0025154, 0.00053208], z);
  return (Math.exp(-x) / Math.sqrt(x)) * p;
}
/** K1(x), x>0 — A&S 9.8.7 (x≤2) / 9.8.8. */
function besselK1(x: number): number {
  if (x <= 2) {
    const t = (x / 2) * (x / 2);
    const p = poly([1, 0.15443144, -0.67278579, -0.18156897, -0.01919402, -0.00110404, -0.00004686], t);
    return Math.log(x / 2) * besselI1(x) + p / x;
  }
  const z = 2 / x;
  const p = poly([1.25331414, 0.23498619, -0.0365562, 0.01504268, -0.00780353, 0.00325614, -0.00068245], z);
  return (Math.exp(-x) / Math.sqrt(x)) * p;
}
/** Miller downward recurrence for J_order at x≤order, normalized by 1 = J0 + 2·Σ J_even. */
function besselMillerJ(order: number, ax: number): number {
  const start = 2 * Math.floor((order + Math.floor(Math.sqrt(60 * order))) / 2);
  const twoOverX = 2 / ax;
  let higher = 0, cur = 1e-30, wanted = 0, evenSum = 0, j0Unnorm = 0;
  for (let k = start; k >= 1; k--) {
    const lower = k * twoOverX * cur - higher;
    higher = cur;
    cur = lower;
    if (Math.abs(cur) > 1e10) { cur *= 1e-10; higher *= 1e-10; wanted *= 1e-10; evenSum *= 1e-10; j0Unnorm *= 1e-10; }
    const idx = k - 1;
    if (idx % 2 === 0) evenSum += cur;
    if (idx === 0) j0Unnorm = cur;
    if (idx === order) wanted = cur;
  }
  return wanted / (2 * evenSum - j0Unnorm);
}
/** Miller downward recurrence for I_order, normalized against the I0 kernel. */
function besselMillerI(order: number, ax: number): number {
  const start = 2 * Math.floor((order + Math.floor(Math.sqrt(60 * order))) / 2);
  const twoOverX = 2 / ax;
  let higher = 0, cur = 1e-30, wanted = 0, i0Unnorm = 0;
  for (let k = start; k >= 1; k--) {
    const lower = k * twoOverX * cur + higher;
    higher = cur;
    cur = lower;
    if (Math.abs(cur) > 1e10) { cur *= 1e-10; higher *= 1e-10; wanted *= 1e-10; i0Unnorm *= 1e-10; }
    const idx = k - 1;
    if (idx === 0) i0Unnorm = cur;
    if (idx === order) wanted = cur;
  }
  return wanted * (besselI0(ax) / i0Unnorm);
}
function besselJ(n: number, x: number): number {
  if (n === 0) return besselJ0(x);
  if (n === 1) return besselJ1(x);
  if (x === 0) return 0;
  const ax = Math.abs(x);
  let value: number;
  if (ax > n) {
    const twoOverX = 2 / ax;
    let prev = besselJ0(ax), cur = besselJ1(ax);
    for (let k = 1; k < n; k++) { const next = k * twoOverX * cur - prev; prev = cur; cur = next; }
    value = cur;
  } else {
    value = besselMillerJ(n, ax);
  }
  return x < 0 && n % 2 === 1 ? -value : value; // J_n(-x) = (-1)^n J_n(x)
}
function besselY(n: number, x: number): number {
  if (n === 0) return besselY0(x);
  if (n === 1) return besselY1(x);
  const twoOverX = 2 / x;
  let prev = besselY0(x), cur = besselY1(x);
  for (let k = 1; k < n; k++) { const next = k * twoOverX * cur - prev; prev = cur; cur = next; }
  return cur;
}
function besselI(n: number, x: number): number {
  if (n === 0) return besselI0(x);
  if (n === 1) return besselI1(x);
  if (x === 0) return 0;
  const value = besselMillerI(n, Math.abs(x));
  return x < 0 && n % 2 === 1 ? -value : value; // I_n(-x) = (-1)^n I_n(x)
}
function besselK(n: number, x: number): number {
  if (n === 0) return besselK0(x);
  if (n === 1) return besselK1(x);
  const twoOverX = 2 / x;
  let prev = besselK0(x), cur = besselK1(x);
  for (let k = 1; k < n; k++) { const next = prev + k * twoOverX * cur; prev = cur; cur = next; } // K_{k+1}=K_{k-1}+(2k/x)K_k
  return cur;
}
const besselFn = (impl: (n: number, x: number) => number): FormulaFn => (args) => {
  const x = numAt(args, 0);
  if (isError(x)) return x;
  const n = numAt(args, 1);
  if (isError(n)) return n;
  const order = Math.trunc(n);
  if (order < 0 || x < 0) return ERR.NUM;
  return impl(order, x);
};

// --- Complex numbers --------------------------------------------------------
function parseComplex(str: string): { re: number; im: number } | null {
  let s = str.trim().replace(/\s/g, '');
  if (s === '') return { re: 0, im: 0 };
  if (!/[ij]$/.test(s)) {
    const n = Number(s);
    return Number.isNaN(n) ? null : { re: n, im: 0 };
  }
  s = s.slice(0, -1); // drop the i/j suffix
  let splitIdx = -1;
  for (let k = s.length - 1; k > 0; k--) {
    const c = s[k];
    if ((c === '+' || c === '-') && s[k - 1] !== 'e' && s[k - 1] !== 'E') {
      splitIdx = k;
      break;
    }
  }
  const reStr = splitIdx > 0 ? s.slice(0, splitIdx) : '';
  const imStr = splitIdx > 0 ? s.slice(splitIdx) : s;
  const im = imStr === '' || imStr === '+' ? 1 : imStr === '-' ? -1 : Number(imStr);
  const re = reStr === '' ? 0 : Number(reStr);
  return Number.isNaN(re) || Number.isNaN(im) ? null : { re, im };
}
function fmtComplex(re: number, im: number, suffix: string): string {
  const r = Math.round(re * 1e10) / 1e10;
  const i = Math.round(im * 1e10) / 1e10;
  if (i === 0) return String(r);
  const ip = i === 1 ? '' : i === -1 ? '-' : String(i);
  if (r === 0) return ip + suffix;
  return String(r) + (i < 0 ? '' : '+') + ip + suffix;
}
const COMPLEX: FormulaFn = (args) => {
  const re = numAt(args, 0);
  if (isError(re)) return re;
  const im = numAt(args, 1);
  if (isError(im)) return im;
  const suffix = args.length > 2 ? textAt(args, 2) : 'i';
  if (isError(suffix)) return suffix;
  if (suffix !== 'i' && suffix !== 'j') return ERR.VALUE;
  return fmtComplex(re, im, suffix);
};
const imUnary = (f: (re: number, im: number) => number): FormulaFn => (args) => {
  const t = textAt(args, 0);
  if (isError(t)) return t;
  const c = parseComplex(t);
  return c === null ? ERR.NUM : f(c.re, c.im);
};
const imCombine = (f: (a: { re: number; im: number }, b: { re: number; im: number }) => { re: number; im: number } | null): FormulaFn => (args) => {
  const ta = textAt(args, 0);
  if (isError(ta)) return ta;
  const tb = textAt(args, 1);
  if (isError(tb)) return tb;
  const a = parseComplex(ta);
  const b = parseComplex(tb);
  if (a === null || b === null) return ERR.NUM;
  const r = f(a, b);
  return r === null ? ERR.NUM : fmtComplex(r.re, r.im, 'i');
};
const imMap = (f: (re: number, im: number) => { re: number; im: number }): FormulaFn => (args) => {
  const t = textAt(args, 0);
  if (isError(t)) return t;
  const c = parseComplex(t);
  if (c === null) return ERR.NUM;
  const r = f(c.re, c.im);
  return fmtComplex(r.re, r.im, 'i');
};
type Cpx = { re: number; im: number };
const cdiv = (a: Cpx, b: Cpx): Cpx => {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};
const cSin = (a: number, b: number): Cpx => ({ re: Math.sin(a) * Math.cosh(b), im: Math.cos(a) * Math.sinh(b) });
const cCos = (a: number, b: number): Cpx => ({ re: Math.cos(a) * Math.cosh(b), im: -Math.sin(a) * Math.sinh(b) });
const cSinh = (a: number, b: number): Cpx => ({ re: Math.sinh(a) * Math.cos(b), im: Math.cosh(a) * Math.sin(b) });
const cCosh = (a: number, b: number): Cpx => ({ re: Math.cosh(a) * Math.cos(b), im: Math.sinh(a) * Math.sin(b) });
const ONE: Cpx = { re: 1, im: 0 };
const IMPOWER: FormulaFn = (args) => {
  const t = textAt(args, 0);
  if (isError(t)) return t;
  const c = parseComplex(t);
  if (c === null) return ERR.NUM;
  const n = numAt(args, 1);
  if (isError(n)) return n;
  const r = Math.hypot(c.re, c.im);
  const th = Math.atan2(c.im, c.re);
  const rn = Math.pow(r, n);
  return fmtComplex(rn * Math.cos(n * th), rn * Math.sin(n * th), 'i');
};

// ---------------------------------------------------------------------------
// Slice 42g — Lookup-pure + Info-pure.  (Reference-arg functions ISFORMULA/
// FORMULATEXT/ISREF/AREAS/CELL/ROW(ref)/COLUMN(ref) need the reference value type
// → slice 44.)
// ---------------------------------------------------------------------------

/** XLOOKUP/XMATCH shared search: index into `arr` matching `key` per matchMode. */
function xsearch(key: FormulaValue, arr: FormulaValue[], matchMode: number, searchMode: number): number {
  const order = searchMode === -1 ? -1 : 1;
  const start = order === -1 ? arr.length - 1 : 0;
  const end = order === -1 ? -1 : arr.length;
  let bestSmaller = -1;
  let bestLarger = -1;
  for (let i = start; i !== end; i += order) {
    const v = arr[i] as FormulaValue;
    const c = compareValues(v, key);
    if (c === 0) return i;
    if (matchMode === -1 && c < 0) { if (bestSmaller < 0 || compareValues(v, arr[bestSmaller] as FormulaValue) > 0) bestSmaller = i; }
    if (matchMode === 1 && c > 0) { if (bestLarger < 0 || compareValues(v, arr[bestLarger] as FormulaValue) < 0) bestLarger = i; }
  }
  if (matchMode === -1) return bestSmaller;
  if (matchMode === 1) return bestLarger;
  return -1;
}
const XLOOKUP: FormulaFn = (args) => {
  const key = scalarOf(argAt(args, 0));
  if (isError(key)) return key;
  const lookupArr = argAt(args, 1);
  const returnArr = argAt(args, 2);
  if (!isRange(lookupArr) || !isRange(returnArr)) return ERR.VALUE;
  const matchMode = args.length > 4 ? numAt(args, 4) : 0;
  if (isError(matchMode)) return matchMode;
  const searchMode = args.length > 5 ? numAt(args, 5) : 1;
  if (isError(searchMode)) return searchMode;
  const idx = xsearch(key, lookupArr.values, Math.trunc(matchMode), Math.trunc(searchMode));
  if (idx < 0) {
    const nf = args.length > 3 ? scalarOf(argAt(args, 3)) : null;
    return nf == null ? ERR.NA : nf; // omitted if_not_found → #N/A
  }
  // Array return (v1.7): a multi-column vertical (or multi-row horizontal) return block
  // yields the whole matched row/column, which spills; a 1-D return stays scalar.
  const vertical = lookupArr.cols === 1;
  if (vertical && returnArr.cols > 1) {
    const row: FormulaValue[] = [];
    for (let c = 0; c < returnArr.cols; c++) row.push(rangeCellAt(returnArr, idx, c));
    return { kind: 'range', values: row, rows: 1, cols: returnArr.cols };
  }
  if (!vertical && returnArr.rows > 1) {
    const col: FormulaValue[] = [];
    for (let r = 0; r < returnArr.rows; r++) col.push(rangeCellAt(returnArr, r, idx));
    return { kind: 'range', values: col, rows: returnArr.rows, cols: 1 };
  }
  return (returnArr.values[idx] ?? null) as FormulaValue;
};
const XMATCH: FormulaFn = (args) => {
  const key = scalarOf(argAt(args, 0));
  if (isError(key)) return key;
  const arr = argAt(args, 1);
  if (!isRange(arr)) return ERR.NA;
  const matchMode = args.length > 2 ? numAt(args, 2) : 0;
  if (isError(matchMode)) return matchMode;
  const searchMode = args.length > 3 ? numAt(args, 3) : 1;
  if (isError(searchMode)) return searchMode;
  const idx = xsearch(key, arr.values, Math.trunc(matchMode), Math.trunc(searchMode));
  return idx < 0 ? ERR.NA : idx + 1;
};
const LOOKUP: FormulaFn = (args) => {
  const key = scalarOf(argAt(args, 0));
  if (isError(key)) return key;
  const vec = argAt(args, 1);
  if (!isRange(vec)) return ERR.NA;
  const result = args.length > 2 && isRange(argAt(args, 2)) ? (argAt(args, 2) as RangeValue).values : vec.values;
  // Vector form: largest value ≤ key (assumes ascending).
  let found = -1;
  for (let i = 0; i < vec.values.length; i++) {
    if (compareValues(vec.values[i] as FormulaValue, key) <= 0) found = i;
    else break;
  }
  return found < 0 ? ERR.NA : ((result[found] ?? null) as FormulaValue);
};
const ADDRESS: FormulaFn = (args) => {
  const row = numAt(args, 0);
  if (isError(row)) return row;
  const col = numAt(args, 1);
  if (isError(col)) return col;
  const absNum = args.length > 2 ? numAt(args, 2) : 1;
  if (isError(absNum)) return absNum;
  const a1 = args.length > 3 ? toBoolean(scalarOf(argAt(args, 3))) : true;
  if (isError(a1)) return a1;
  const r = Math.trunc(row);
  const c = Math.trunc(col);
  if (r < 1 || c < 1) return ERR.VALUE;
  if (!a1) {
    const rc = `R${r}C${c}`; // absolute R1C1
    return absNum === 1 ? rc : absNum === 2 ? `R${r}C[${c}]` : absNum === 3 ? `R[${r}]C${c}` : `R[${r}]C[${c}]`;
  }
  const letters = indexToColLetters(c - 1);
  const colAbs = absNum === 1 || absNum === 3 ? '$' : '';
  const rowAbs = absNum === 1 || absNum === 2 ? '$' : '';
  return `${colAbs}${letters}${rowAbs}${r}`;
};
const HYPERLINK: FormulaFn = (args) => {
  const link = textAt(args, 0);
  if (isError(link)) return link;
  if (args.length > 1) {
    const friendly = scalarOf(argAt(args, 1));
    return isError(friendly) ? friendly : (friendly ?? link);
  }
  return link;
};
const ISODD: FormulaFn = (args) => {
  const n = numAt(args, 0);
  return isError(n) ? n : Math.abs(Math.trunc(n)) % 2 === 1;
};
const ISEVEN: FormulaFn = (args) => {
  const n = numAt(args, 0);
  return isError(n) ? n : Math.abs(Math.trunc(n)) % 2 === 0;
};
const TYPEFN: FormulaFn = (args) => {
  const v = scalarOf(argAt(args, 0));
  if (typeof v === 'number') return 1;
  if (typeof v === 'string') return 2;
  if (typeof v === 'boolean') return 4;
  if (isError(v)) return 16;
  return 1; // blank → number-like
};
const ERRORTYPE: FormulaFn = (args) => {
  const v = scalarOf(argAt(args, 0));
  if (!(v instanceof FormulaError)) return ERR.NA;
  const map: Record<string, number> = {
    '#NULL!': 1, '#DIV/0!': 2, '#VALUE!': 3, '#REF!': 4, '#NAME?': 5, '#NUM!': 6, '#N/A': 7,
    '#SPILL!': 9, '#CALC!': 14, '#CIRC!': 4,
  };
  return map[v.code] ?? ERR.NA;
};

// ---------------------------------------------------------------------------
// Slice 42c-2 — Statistical distributions + tests + CONFIDENCE (special fns).
// ---------------------------------------------------------------------------

// Regularized incomplete gamma/beta via the standard power-series and modified
// Lentz continued-fraction forms (source-neutral published algorithm).
const GF_TINY = 1e-300;
const GF_EPS = 1e-14;

/** Power series for P(a,x), converges quickly when x < a+1. */
function gammaSeries(a: number, x: number): number {
  let denom = a, term = 1 / a, sum = term;
  for (let i = 0; i < 1000; i++) {
    denom += 1;
    term *= x / denom;
    sum += term;
    if (Math.abs(term) < Math.abs(sum) * GF_EPS) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - gammaln(a));
}

/** Modified Lentz continued fraction for Q(a,x) = 1 - P(a,x), x ≥ a+1. */
function gammaContinuedFraction(a: number, x: number): number {
  let b = x + 1 - a, c = 1 / GF_TINY, d = 1 / b, h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < GF_TINY) d = GF_TINY;
    c = b + an / c;
    if (Math.abs(c) < GF_TINY) c = GF_TINY;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < GF_EPS) break;
  }
  return Math.exp(-x + a * Math.log(x) - gammaln(a)) * h;
}

/** Regularized lower incomplete gamma P(a,x), a>0, x≥0 → [0,1]. */
function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  const p = x < a + 1 ? gammaSeries(a, x) : 1 - gammaContinuedFraction(a, x);
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

/** Modified Lentz continued fraction for the incomplete beta integral. */
function betaContinuedFraction(x: number, a: number, b: number): number {
  const sum = a + b, aPlus1 = a + 1, aMinus1 = a - 1;
  let c = 1, d = 1 - (sum * x) / aPlus1;
  if (Math.abs(d) < GF_TINY) d = GF_TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 500; m++) {
    const m2 = 2 * m;
    let coeff = (m * (b - m) * x) / ((aMinus1 + m2) * (a + m2)); // even step
    d = 1 + coeff * d;
    if (Math.abs(d) < GF_TINY) d = GF_TINY;
    c = 1 + coeff / c;
    if (Math.abs(c) < GF_TINY) c = GF_TINY;
    d = 1 / d;
    h *= d * c;
    coeff = -((a + m) * (sum + m) * x) / ((a + m2) * (aPlus1 + m2)); // odd step
    d = 1 + coeff * d;
    if (Math.abs(d) < GF_TINY) d = GF_TINY;
    c = 1 + coeff / c;
    if (Math.abs(c) < GF_TINY) c = GF_TINY;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < GF_EPS) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a,b), a>0, b>0, 0≤x≤1 → [0,1]. */
function betaReg(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2)
    ? (front * betaContinuedFraction(x, a, b)) / a
    : 1 - (front * betaContinuedFraction(1 - x, b, a)) / b;
}
function normCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}
function normPdf(z: number): number {
  return Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI);
}
function normSInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return ((((((c[0] as number) * q + (c[1] as number)) * q + (c[2] as number)) * q + (c[3] as number)) * q + (c[4] as number)) * q + (c[5] as number)) / (((((d[0] as number) * q + (d[1] as number)) * q + (d[2] as number)) * q + (d[3] as number)) * q + 1);
  }
  if (p <= 1 - pl) {
    const q = p - 0.5;
    const r = q * q;
    return (((((((a[0] as number) * r + (a[1] as number)) * r + (a[2] as number)) * r + (a[3] as number)) * r + (a[4] as number)) * r + (a[5] as number)) * q) / ((((((b[0] as number) * r + (b[1] as number)) * r + (b[2] as number)) * r + (b[3] as number)) * r + (b[4] as number)) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -((((((c[0] as number) * q + (c[1] as number)) * q + (c[2] as number)) * q + (c[3] as number)) * q + (c[4] as number)) * q + (c[5] as number)) / (((((d[0] as number) * q + (d[1] as number)) * q + (d[2] as number)) * q + (d[3] as number)) * q + 1);
}
function bisectInv(cdf: (x: number) => number, p: number, lo: number, hi: number): number {
  return solveMonotone(cdf, lo, hi, p, 1e-13);
}
function tCdf(t: number, df: number): number {
  const x = df / (df + t * t);
  const ib = betaReg(x, df / 2, 0.5) / 2;
  return t > 0 ? 1 - ib : ib;
}
function logCombin(n: number, k: number): number {
  return gammaln(n + 1) - gammaln(k + 1) - gammaln(n - k + 1);
}
function binomPmf(k: number, n: number, p: number): number {
  if (p <= 0) return k === 0 ? 1 : 0;
  if (p >= 1) return k === n ? 1 : 0;
  return Math.exp(logCombin(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
}

// --- helpers to read (x, ..., cumulative) ----------------------------------
function distArgs(args: EvalResult[], count: number): { nums: number[]; cum: boolean } | FormulaError {
  const nums: number[] = [];
  for (let i = 0; i < count; i++) {
    const v = numAt(args, i);
    if (isError(v)) return v;
    nums.push(v);
  }
  const cum = args.length > count ? toBoolean(scalarOf(argAt(args, count))) : true;
  if (isError(cum)) return cum;
  return { nums, cum };
}

const NORMSDIST_C = (z: number): number => normCdf(z);
const NORM_S_DIST: FormulaFn = (args) => {
  const z = numAt(args, 0);
  if (isError(z)) return z;
  const cum = args.length > 1 ? toBoolean(scalarOf(argAt(args, 1))) : true;
  if (isError(cum)) return cum;
  return cum ? normCdf(z) : normPdf(z);
};
const NORM_DIST: FormulaFn = (args) => {
  const d = distArgs(args, 3);
  if (isError(d)) return d;
  const [x, m, s] = d.nums as [number, number, number];
  if (s <= 0) return ERR.NUM;
  return d.cum ? normCdf((x - m) / s) : normPdf((x - m) / s) / s;
};
const NORM_INV: FormulaFn = (args) => {
  const p = numAt(args, 0), m = numAt(args, 1), s = numAt(args, 2);
  for (const v of [p, m, s]) if (isError(v)) return v;
  return numOrNum((m as number) + (s as number) * normSInv(p as number));
};
const GAMMA_DIST: FormulaFn = (args) => {
  const d = distArgs(args, 3);
  if (isError(d)) return d;
  const [x, a, b] = d.nums as [number, number, number];
  if (a <= 0 || b <= 0) return ERR.NUM;
  return d.cum ? gammaP(a, x / b) : (Math.pow(x, a - 1) * Math.exp(-x / b)) / (Math.pow(b, a) * Math.exp(gammaln(a)));
};
const POISSON_DIST: FormulaFn = (args) => {
  const d = distArgs(args, 2);
  if (isError(d)) return d;
  const [x, mean] = d.nums as [number, number];
  const k = Math.trunc(x);
  if (d.cum) {
    let s = 0;
    for (let i = 0; i <= k; i++) s += Math.exp(-mean + i * Math.log(mean) - gammaln(i + 1));
    return s;
  }
  return Math.exp(-mean + k * Math.log(mean) - gammaln(k + 1));
};
const EXPON_DIST: FormulaFn = (args) => {
  const d = distArgs(args, 2);
  if (isError(d)) return d;
  const [x, lambda] = d.nums as [number, number];
  if (lambda <= 0) return ERR.NUM;
  return d.cum ? 1 - Math.exp(-lambda * x) : lambda * Math.exp(-lambda * x);
};
const BINOM_DIST: FormulaFn = (args) => {
  const d = distArgs(args, 3);
  if (isError(d)) return d;
  const [k, n, p] = d.nums as [number, number, number];
  const kk = Math.trunc(k);
  const nn = Math.trunc(n);
  if (d.cum) {
    let s = 0;
    for (let i = 0; i <= kk; i++) s += binomPmf(i, nn, p);
    return s;
  }
  return binomPmf(kk, nn, p);
};
const CHISQ_DIST: FormulaFn = (args) => {
  const d = distArgs(args, 2);
  if (isError(d)) return d;
  const [x, df] = d.nums as [number, number];
  return d.cum ? gammaP(df / 2, x / 2) : (Math.pow(x, df / 2 - 1) * Math.exp(-x / 2)) / (Math.pow(2, df / 2) * Math.exp(gammaln(df / 2)));
};
const F_DIST: FormulaFn = (args) => {
  const d = distArgs(args, 3);
  if (isError(d)) return d;
  const [x, d1, d2] = d.nums as [number, number, number];
  if (x < 0) return ERR.NUM;
  if (d.cum) return betaReg((d1 * x) / (d1 * x + d2), d1 / 2, d2 / 2);
  const num = Math.sqrt((Math.pow(d1 * x, d1) * Math.pow(d2, d2)) / Math.pow(d1 * x + d2, d1 + d2));
  return num / (x * Math.exp(gammaln(d1 / 2) + gammaln(d2 / 2) - gammaln((d1 + d2) / 2)));
};
const T_DIST: FormulaFn = (args) => {
  const d = distArgs(args, 2);
  if (isError(d)) return d;
  const [t, df] = d.nums as [number, number];
  if (d.cum) return tCdf(t, df);
  return Math.exp(gammaln((df + 1) / 2) - gammaln(df / 2)) / Math.sqrt(df * Math.PI) * Math.pow(1 + (t * t) / df, -(df + 1) / 2);
};
const BETA_DIST: FormulaFn = (args) => {
  const x = numAt(args, 0), a = numAt(args, 1), b = numAt(args, 2);
  for (const v of [x, a, b]) if (isError(v)) return v;
  const cum = args.length > 3 ? toBoolean(scalarOf(argAt(args, 3))) : true;
  if (isError(cum)) return cum;
  const A = args.length > 4 ? numAt(args, 4) : 0;
  if (isError(A)) return A;
  const B = args.length > 5 ? numAt(args, 5) : 1;
  if (isError(B)) return B;
  const z = ((x as number) - A) / (B - A);
  if (cum) return betaReg(z, a as number, b as number);
  return (Math.pow(z, (a as number) - 1) * Math.pow(1 - z, (b as number) - 1)) / (Math.exp(gammaln(a as number) + gammaln(b as number) - gammaln((a as number) + (b as number))) * (B - A));
};

const CONFIDENCE_NORM: FormulaFn = (args) => {
  const alpha = numAt(args, 0), sd = numAt(args, 1), n = numAt(args, 2);
  for (const v of [alpha, sd, n]) if (isError(v)) return v;
  return numOrNum(normSInv(1 - (alpha as number) / 2) * (sd as number) / Math.sqrt(n as number));
};
const CONFIDENCE_T: FormulaFn = (args) => {
  const alpha = numAt(args, 0), sd = numAt(args, 1), n = numAt(args, 2);
  for (const v of [alpha, sd, n]) if (isError(v)) return v;
  const tinv = bisectInv((t) => tCdf(t, (n as number) - 1), 1 - (alpha as number) / 2, 0, 1e6);
  return numOrNum(tinv * (sd as number) / Math.sqrt(n as number));
};
const WEIBULL_DIST: FormulaFn = (args) => {
  const d = distArgs(args, 3);
  if (isError(d)) return d;
  const [x, alpha, beta] = d.nums as [number, number, number];
  if (alpha <= 0 || beta <= 0 || x < 0) return ERR.NUM;
  const t = Math.pow(x / beta, alpha);
  return d.cum ? 1 - Math.exp(-t) : (alpha / Math.pow(beta, alpha)) * Math.pow(x, alpha - 1) * Math.exp(-t);
};
const ZTEST: FormulaFn = (args) => {
  const nums = collectNumbers([argAt(args, 0) as EvalResult]);
  if (isError(nums)) return nums;
  const x = numAt(args, 1);
  if (isError(x)) return x;
  const n = nums.length;
  let mean = 0;
  for (const v of nums) mean += v;
  mean /= n;
  let sigma: number;
  if (args.length > 2) {
    const s = numAt(args, 2);
    if (isError(s)) return s;
    sigma = s;
  } else {
    let ss = 0;
    for (const v of nums) ss += (v - mean) * (v - mean);
    sigma = Math.sqrt(ss / (n - 1));
  }
  return 1 - normCdf((mean - x) / (sigma / Math.sqrt(n)));
};

// --- FORECAST.ETS — Holt-Winters additive triple exponential smoothing. ------
interface ETSModel {
  alpha: number; beta: number; gamma: number; m: number;
  level: number; trend: number; seasonal: number[]; n: number;
  mae: number; rmse: number; mase: number; smape: number;
}
/** One additive Holt-Winters pass (m<2 → Holt's linear/double smoothing). */
/**
 * One additive Holt-Winters pass computing **only** the in-sample SSE, writing the
 * seasonal components into a caller-supplied reusable buffer. No per-call allocation
 * (the buffer is reused across the whole grid search) and no second SSE pass — the
 * error is accumulated inline. m<2 → Holt's linear (the buffer is unused).
 */
function hwSSE(values: number[], m: number, alpha: number, beta: number, gamma: number, buf: number[]): number {
  const n = values.length;
  let sse = 0;
  if (m < 2) {
    let level = values[0] as number;
    let trend = (values[1] as number) - (values[0] as number);
    for (let t = 1; t < n; t++) {
      const e = (values[t] as number) - (level + trend);
      sse += e * e;
      const prev = level;
      level = alpha * (values[t] as number) + (1 - alpha) * (level + trend);
      trend = beta * (level - prev) + (1 - beta) * trend;
    }
    return sse;
  }
  let s0 = 0;
  for (let i = 0; i < m; i++) s0 += values[i] as number;
  s0 /= m;
  let s1 = 0;
  const secondLen = Math.min(m, n - m);
  for (let i = m; i < m + secondLen; i++) s1 += values[i] as number;
  s1 /= secondLen;
  let level = s0;
  let trend = (s1 - s0) / m;
  for (let i = 0; i < m; i++) buf[i] = (values[i] as number) - s0;
  for (let t = m; t < n; t++) {
    const prev = level;
    const e = (values[t] as number) - (level + trend + (buf[t - m] as number));
    sse += e * e;
    level = alpha * ((values[t] as number) - (buf[t - m] as number)) + (1 - alpha) * (level + trend);
    trend = beta * (level - prev) + (1 - beta) * trend;
    buf[t] = gamma * ((values[t] as number) - level) + (1 - gamma) * (buf[t - m] as number);
  }
  return sse;
}
/** The authoritative final HW pass with the chosen params → model + error stats. */
function finalizeETS(values: number[], m: number, alpha: number, beta: number, gamma: number): ETSModel {
  const n = values.length;
  const seasonal = new Array<number>(m < 2 ? 1 : n).fill(0);
  let mae = 0, mse = 0, smape = 0, cnt = 0;
  const acc = (a: number, f: number): void => {
    const e = Math.abs(a - f);
    mae += e;
    mse += (a - f) * (a - f);
    smape += Math.abs(a) + Math.abs(f) > 0 ? (2 * e) / (Math.abs(a) + Math.abs(f)) : 0;
    cnt++;
  };
  let level: number;
  let trend: number;
  if (m < 2) {
    level = values[0] as number;
    trend = (values[1] as number) - (values[0] as number);
    for (let t = 1; t < n; t++) {
      acc(values[t] as number, level + trend);
      const prev = level;
      level = alpha * (values[t] as number) + (1 - alpha) * (level + trend);
      trend = beta * (level - prev) + (1 - beta) * trend;
    }
  } else {
    let s0 = 0;
    for (let i = 0; i < m; i++) s0 += values[i] as number;
    s0 /= m;
    let s1 = 0;
    const secondLen = Math.min(m, n - m);
    for (let i = m; i < m + secondLen; i++) s1 += values[i] as number;
    s1 /= secondLen;
    level = s0;
    trend = (s1 - s0) / m;
    for (let i = 0; i < m; i++) seasonal[i] = (values[i] as number) - s0;
    for (let t = m; t < n; t++) {
      const prev = level;
      acc(values[t] as number, level + trend + (seasonal[t - m] as number));
      level = alpha * ((values[t] as number) - (seasonal[t - m] as number)) + (1 - alpha) * (level + trend);
      trend = beta * (level - prev) + (1 - beta) * trend;
      seasonal[t] = gamma * ((values[t] as number) - level) + (1 - gamma) * (seasonal[t - m] as number);
    }
  }
  mae /= cnt;
  mse /= cnt;
  smape /= cnt;
  let naive = 0;
  for (let t = 1; t < n; t++) naive += Math.abs((values[t] as number) - (values[t - 1] as number));
  naive /= Math.max(1, n - 1);
  return { alpha, beta, gamma, m, level, trend, seasonal, n, mae, rmse: Math.sqrt(mse), mase: naive > 0 ? mae / naive : 0, smape };
}
/**
 * Grid-search α/β/γ minimising in-sample SSE (byte-identical to the old exhaustive
 * search), then one authoritative pass for the model + error stats. The search reuses
 * a single seasonal buffer across all 81/729 combinations — O(n) allocation, not
 * O(combinations·n).
 */
function fitETS(values: number[], m: number): ETSModel {
  const grid = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
  const gGrid = m < 2 ? [0] : grid;
  const buf = new Array<number>(values.length);
  let bestA = 0.3, bestB = 0.1, bestG = m < 2 ? 0 : 0.1, bestSSE = Infinity;
  for (const a of grid) for (const b of grid) for (const g of gGrid) {
    const sse = hwSSE(values, m, a, b, g, buf);
    if (sse < bestSSE) { bestSSE = sse; bestA = a; bestB = b; bestG = g; }
  }
  return finalizeETS(values, m, bestA, bestB, bestG);
}
function forecastHW(model: ETSModel, h: number): number {
  if (model.m < 2) return model.level + h * model.trend;
  const idx = model.n - model.m + ((h - 1) % model.m);
  return model.level + h * model.trend + (model.seasonal[idx] ?? 0);
}
/**
 * Auto-detect the seasonal period via the autocorrelation peak. The series is
 * first-differenced to strip a linear trend (which otherwise dominates the ACF),
 * then the lag with the highest autocorrelation above a threshold is the period.
 */
function detectSeason(values: number[]): number {
  const n = values.length;
  if (n < 6) return 1;
  const d: number[] = [];
  for (let i = 1; i < n; i++) d.push((values[i] as number) - (values[i - 1] as number));
  const m = d.length;
  let mean = 0;
  for (const v of d) mean += v;
  mean /= m;
  let denom = 0;
  for (const v of d) denom += (v - mean) * (v - mean);
  if (denom === 0) return 1;
  let bestLag = 1;
  let bestAcf = 0.3;
  for (let lag = 2; lag <= Math.floor(m / 2); lag++) {
    let num = 0;
    for (let i = lag; i < m; i++) num += ((d[i] as number) - mean) * ((d[i - lag] as number) - mean);
    const acf = num / denom;
    if (acf > bestAcf) { bestAcf = acf; bestLag = lag; }
  }
  return bestLag;
}
/** Build the ETS model + timeline interval from (values, timeline, seasonality) args. */
function buildETS(args: EvalResult[], valuesIdx: number, timelineIdx: number, seasonIdx: number): { model: ETSModel; interval: number; lastT: number } | FormulaError {
  const values = collectNumbers([argAt(args, valuesIdx) as EvalResult]);
  if (isError(values)) return values;
  const timeline = collectNumbers([argAt(args, timelineIdx) as EvalResult]);
  if (isError(timeline)) return timeline;
  if (values.length < 2 || timeline.length !== values.length) return ERR.NA;
  const seasonality = args.length > seasonIdx && scalarOf(argAt(args, seasonIdx)) != null ? numAt(args, seasonIdx) : 1;
  if (isError(seasonality)) return seasonality;
  const sVal = Math.trunc(seasonality);
  const m = sVal === 1 ? detectSeason(values) : sVal <= 1 ? 1 : sVal;
  const interval = (timeline[1] as number) - (timeline[0] as number);
  return { model: fitETS(values, m), interval, lastT: timeline[timeline.length - 1] as number };
}

const FORECAST_ETS: FormulaFn = (args) => {
  const target = numAt(args, 0);
  if (isError(target)) return target;
  const built = buildETS(args, 1, 2, 3);
  if (isError(built)) return built;
  if (built.interval === 0) return ERR.NUM;
  const h = Math.round((target - built.lastT) / built.interval);
  if (h <= 0) return ERR.NUM; // target must be beyond the historical timeline
  return forecastHW(built.model, h);
};
const FORECAST_ETS_SEASONALITY: FormulaFn = (args) => {
  const values = collectNumbers([argAt(args, 0) as EvalResult]);
  if (isError(values)) return values;
  return detectSeason(values);
};
const FORECAST_ETS_STAT: FormulaFn = (args) => {
  const built = buildETS(args, 0, 1, 3);
  if (isError(built)) return built;
  const stat = numAt(args, 2);
  if (isError(stat)) return stat;
  const m = built.model;
  switch (Math.trunc(stat)) {
    case 1: return m.alpha;
    case 2: return m.beta;
    case 3: return m.gamma;
    case 4: return m.mase;
    case 5: return m.smape;
    case 6: return m.mae;
    case 7: return m.rmse;
    case 8: return built.interval;
    default: return ERR.NUM;
  }
};
const FORECAST_ETS_CONFINT: FormulaFn = (args) => {
  const target = numAt(args, 0);
  if (isError(target)) return target;
  const built = buildETS(args, 1, 2, 4);
  if (isError(built)) return built;
  if (built.interval === 0) return ERR.NUM;
  const conf = args.length > 3 && scalarOf(argAt(args, 3)) != null ? numAt(args, 3) : 0.95;
  if (isError(conf)) return conf;
  const h = Math.round((target - built.lastT) / built.interval);
  if (h <= 0) return ERR.NUM;
  // Approximate prediction interval: z · RMSE · √h.
  const z = normSInv(1 - (1 - conf) / 2);
  return z * built.model.rmse * Math.sqrt(h);
};

// --- Hypothesis tests (two arrays → a p-value; reuse the t/F/χ² CDFs). --------
function sampleStats(vals: number[]): { n: number; mean: number; variance: number } {
  const n = vals.length;
  let mean = 0;
  for (const v of vals) mean += v;
  mean /= n;
  let ss = 0;
  for (const v of vals) ss += (v - mean) * (v - mean);
  return { n, mean, variance: n > 1 ? ss / (n - 1) : 0 };
}
const TTEST: FormulaFn = (args) => {
  const a = collectNumbers([argAt(args, 0) as EvalResult]);
  if (isError(a)) return a;
  const b = collectNumbers([argAt(args, 1) as EvalResult]);
  if (isError(b)) return b;
  const tails = numAt(args, 2);
  if (isError(tails)) return tails;
  const type = numAt(args, 3);
  if (isError(type)) return type;
  let t: number;
  let df: number;
  if (Math.trunc(type) === 1) {
    // Paired.
    if (a.length !== b.length) return ERR.NA;
    const d = a.map((x, i) => x - (b[i] as number));
    const s = sampleStats(d);
    if (s.variance === 0) return ERR.DIV0;
    t = s.mean / Math.sqrt(s.variance / s.n);
    df = s.n - 1;
  } else {
    const sa = sampleStats(a);
    const sb = sampleStats(b);
    if (Math.trunc(type) === 2) {
      // Two-sample, equal variance (pooled).
      const sp = ((sa.n - 1) * sa.variance + (sb.n - 1) * sb.variance) / (sa.n + sb.n - 2);
      t = (sa.mean - sb.mean) / Math.sqrt(sp * (1 / sa.n + 1 / sb.n));
      df = sa.n + sb.n - 2;
    } else {
      // Two-sample, unequal variance (Welch).
      const va = sa.variance / sa.n;
      const vb = sb.variance / sb.n;
      t = (sa.mean - sb.mean) / Math.sqrt(va + vb);
      df = (va + vb) ** 2 / (va ** 2 / (sa.n - 1) + vb ** 2 / (sb.n - 1));
    }
  }
  const rt = 1 - tCdf(Math.abs(t), df);
  return Math.trunc(tails) === 1 ? rt : 2 * rt;
};
const FTEST: FormulaFn = (args) => {
  const a = collectNumbers([argAt(args, 0) as EvalResult]);
  if (isError(a)) return a;
  const b = collectNumbers([argAt(args, 1) as EvalResult]);
  if (isError(b)) return b;
  const sa = sampleStats(a);
  const sb = sampleStats(b);
  if (sa.variance === 0 || sb.variance === 0) return ERR.DIV0;
  const f = sa.variance / sb.variance;
  const left = betaReg((sa.n - 1) * f / ((sa.n - 1) * f + (sb.n - 1)), (sa.n - 1) / 2, (sb.n - 1) / 2);
  return 2 * Math.min(left, 1 - left);
};
const CHITEST: FormulaFn = (args) => {
  const actual = argAt(args, 0);
  const expected = argAt(args, 1);
  if (!isRange(actual) || !isRange(expected)) return ERR.NA;
  if (actual.values.length !== expected.values.length) return ERR.NA;
  let chi2 = 0;
  for (let i = 0; i < actual.values.length; i++) {
    const o = toNumber(actual.values[i] as FormulaValue);
    if (isError(o)) return o;
    const e = toNumber(expected.values[i] as FormulaValue);
    if (isError(e)) return e;
    if (e === 0) return ERR.DIV0;
    chi2 += ((o - e) * (o - e)) / e;
  }
  const r = actual.rows;
  const c = actual.cols;
  const df = r === 1 || c === 1 ? r * c - 1 : (r - 1) * (c - 1);
  if (df <= 0) return ERR.NUM;
  return 1 - gammaP(df / 2, chi2 / 2);
};

// ---------------------------------------------------------------------------
// Slice 42b-2 — Bond / coupon / day-count financial (uses the 42e date machinery).
// ---------------------------------------------------------------------------

/** Year fraction between two serial dates on an Excel day-count `basis` (0-4). */
function dayCountFrac(s: number, e: number, basis: number): number {
  switch (basis) {
    case 0: return days360(s, e, false) / 360;
    case 1: {
      const y1 = fromSerial(s).getUTCFullYear();
      const y2 = fromSerial(e).getUTCFullYear();
      if (y1 === y2) return (e - s) / daysInYear(y1);
      let total = 0;
      for (let y = y1; y <= y2; y++) total += daysInYear(y);
      return (e - s) / (total / (y2 - y1 + 1));
    }
    case 2: return (e - s) / 360;
    case 3: return (e - s) / 365;
    case 4: return days360(s, e, true) / 360;
    default: return NaN;
  }
}
/** Days between two serials on a basis (30/360 vs actual). */
function coupDayDiff(a: number, b: number, basis: number): number {
  return basis === 0 || basis === 4 ? days360(a, b, basis === 4) : b - a;
}
/** Coupon schedule around a settlement: previous/next coupon dates + coupons remaining. */
function couponSchedule(settlement: number, maturity: number, freq: number): { pcd: number; ncd: number; n: number } {
  const step = 12 / freq;
  let n = 0;
  let pcd = maturity;
  while (pcd > settlement) {
    n++;
    pcd = addMonths(maturity, -step * n, false);
  }
  const ncd = addMonths(maturity, -step * (n - 1), false);
  return { pcd, ncd, n };
}
function coupDaysInPeriod(pcd: number, ncd: number, freq: number, basis: number): number {
  if (basis === 0 || basis === 4) return 360 / freq;
  if (basis === 3) return 365 / freq;
  return ncd - pcd; // actual/actual + actual/360 → real period length
}
/** Read a settlement/maturity/… numeric arg (a serial date or scalar). */
function narg(args: EvalResult[], i: number): number | FormulaError {
  return numAt(args, i);
}
const basisArg = (args: EvalResult[], i: number): number | FormulaError => {
  if (args.length <= i || scalarOf(argAt(args, i)) == null) return 0;
  const b = numAt(args, i);
  if (isError(b)) return b;
  const bb = Math.trunc(b);
  return bb < 0 || bb > 4 ? ERR.NUM : bb;
};

const DISC: FormulaFn = (args) => {
  const s = narg(args, 0), m = narg(args, 1), pr = narg(args, 2), red = narg(args, 3);
  for (const v of [s, m, pr, red]) if (isError(v)) return v;
  const basis = basisArg(args, 4);
  if (isError(basis)) return basis;
  const yf = dayCountFrac(s as number, m as number, basis);
  if (yf === 0 || (red as number) === 0) return ERR.DIV0;
  return ((red as number) - (pr as number)) / (red as number) / yf;
};
const PRICEDISC: FormulaFn = (args) => {
  const s = narg(args, 0), m = narg(args, 1), d = narg(args, 2), red = narg(args, 3);
  for (const v of [s, m, d, red]) if (isError(v)) return v;
  const basis = basisArg(args, 4);
  if (isError(basis)) return basis;
  return (red as number) - (d as number) * (red as number) * dayCountFrac(s as number, m as number, basis);
};
const YIELDDISC: FormulaFn = (args) => {
  const s = narg(args, 0), m = narg(args, 1), pr = narg(args, 2), red = narg(args, 3);
  for (const v of [s, m, pr, red]) if (isError(v)) return v;
  const basis = basisArg(args, 4);
  if (isError(basis)) return basis;
  const yf = dayCountFrac(s as number, m as number, basis);
  if (yf === 0 || (pr as number) === 0) return ERR.DIV0;
  return ((red as number) - (pr as number)) / (pr as number) / yf;
};
const INTRATE: FormulaFn = (args) => {
  const s = narg(args, 0), m = narg(args, 1), inv = narg(args, 2), red = narg(args, 3);
  for (const v of [s, m, inv, red]) if (isError(v)) return v;
  const basis = basisArg(args, 4);
  if (isError(basis)) return basis;
  const yf = dayCountFrac(s as number, m as number, basis);
  if (yf === 0 || (inv as number) === 0) return ERR.DIV0;
  return ((red as number) - (inv as number)) / (inv as number) / yf;
};
const RECEIVED: FormulaFn = (args) => {
  const s = narg(args, 0), m = narg(args, 1), inv = narg(args, 2), d = narg(args, 3);
  for (const v of [s, m, inv, d]) if (isError(v)) return v;
  const basis = basisArg(args, 4);
  if (isError(basis)) return basis;
  const denom = 1 - (d as number) * dayCountFrac(s as number, m as number, basis);
  if (denom === 0) return ERR.DIV0;
  return (inv as number) / denom;
};
const ACCRINTM: FormulaFn = (args) => {
  const issue = narg(args, 0), settle = narg(args, 1), rate = narg(args, 2), par = narg(args, 3);
  for (const v of [issue, settle, rate, par]) if (isError(v)) return v;
  const basis = basisArg(args, 4);
  if (isError(basis)) return basis;
  return (par as number) * (rate as number) * dayCountFrac(issue as number, settle as number, basis);
};
/** `ACCRINT(issue, first_int, settlement, rate, par, freq, [basis], [calc])` — accrued interest, periodic. */
const ACCRINT: FormulaFn = (args) => {
  const issue = narg(args, 0), settle = narg(args, 2), rate = narg(args, 3);
  const par = args.length > 4 && scalarOf(argAt(args, 4)) != null ? narg(args, 4) : 1000;
  for (const v of [issue, settle, rate, par]) if (isError(v)) return v;
  const basis = basisArg(args, 6);
  if (isError(basis)) return basis;
  if ((rate as number) <= 0 || (par as number) <= 0) return ERR.NUM;
  if ((settle as number) <= (issue as number)) return ERR.NUM;
  // Aggregate accrual issue→settlement (exact for bases 0/2/3/4; the proportional day-count).
  return (par as number) * (rate as number) * dayCountFrac(issue as number, settle as number, basis);
};
/** `PRICEMAT(settlement, maturity, issue, rate, yld, [basis])` — price, interest-at-maturity. */
const PRICEMAT: FormulaFn = (args) => {
  const s = narg(args, 0), m = narg(args, 1), iss = narg(args, 2), rate = narg(args, 3), yld = narg(args, 4);
  for (const v of [s, m, iss, rate, yld]) if (isError(v)) return v;
  const basis = basisArg(args, 5);
  if (isError(basis)) return basis;
  const DIM = dayCountFrac(iss as number, m as number, basis);
  const DSM = dayCountFrac(s as number, m as number, basis);
  const DIS = dayCountFrac(iss as number, s as number, basis);
  const denom = 1 + DSM * (yld as number);
  if (denom === 0) return ERR.DIV0;
  return (100 + DIM * (rate as number) * 100) / denom - DIS * (rate as number) * 100;
};
/** `YIELDMAT(settlement, maturity, issue, rate, pr, [basis])` — yield, interest-at-maturity (inverse of PRICEMAT). */
const YIELDMAT: FormulaFn = (args) => {
  const s = narg(args, 0), m = narg(args, 1), iss = narg(args, 2), rate = narg(args, 3), pr = narg(args, 4);
  for (const v of [s, m, iss, rate, pr]) if (isError(v)) return v;
  const basis = basisArg(args, 5);
  if (isError(basis)) return basis;
  const DIM = dayCountFrac(iss as number, m as number, basis);
  const DSM = dayCountFrac(s as number, m as number, basis);
  const DIS = dayCountFrac(iss as number, s as number, basis);
  if (DSM === 0) return ERR.DIV0;
  const base = (pr as number) / 100 + DIS * (rate as number);
  if (base === 0) return ERR.DIV0;
  return ((1 + DIM * (rate as number)) / base - 1) / DSM;
};

// ---------------------------------------------------------------------------
// Odd-period-coupon bonds (v1.7). Priced by the standard fixed-income
// discounted-cash-flow method (ODDFPRICE/ODDLPRICE conventions): the odd first
// coupon is accrued over its actual period, later coupons are regular, and all
// flows are discounted at the yield in coupon-period time. Yields root-solve the
// monotone price. Public-domain financial math; own implementation.
// Validated against the published reference values (ODDFPRICE ≈ 113.5976,
// ODDLPRICE ≈ 99.878286).
// ---------------------------------------------------------------------------

/**
 * Clean price per 100 face of an odd-FIRST-coupon bond (discounted cash flow).
 * Odd-long first period (DFC > E) reuses the single prorated first coupon of the
 * odd-short case — a documented ODDFPRICE-style simplification.
 */
function oddFirstBondPrice(settle: number, maturity: number, issue: number, firstCoupon: number, rate: number, yld: number, redemption: number, freq: number, basis: number): number {
  const c = (100 * rate) / freq; // regular coupon per period
  const disc = 1 + yld / freq;
  const step = 12 / freq;
  if (settle < firstCoupon) {
    // Case A: settlement within/before the odd first period.
    let m = 1;
    let d = firstCoupon;
    while (d < maturity) { m += 1; d = addMonths(firstCoupon, step * (m - 1), false); }
    const periodStart = addMonths(firstCoupon, -step, false);
    const E = coupDayDiff(periodStart, firstCoupon, basis);
    const t = coupDayDiff(settle, firstCoupon, basis) / E;
    const oddCoupon = c * (coupDayDiff(issue, firstCoupon, basis) / E); // prorated first coupon
    let dirty = oddCoupon / Math.pow(disc, t);
    for (let k = 2; k <= m; k++) dirty += c / Math.pow(disc, t + k - 1);
    dirty += redemption / Math.pow(disc, t + m - 1);
    const accrued = c * (coupDayDiff(issue, settle, basis) / E);
    return dirty - accrued;
  }
  // Case B: odd first period elapsed → price as a regular bond.
  const coupons: number[] = [maturity];
  let cursor = maturity;
  let back = 0;
  while (cursor > settle) { back += 1; cursor = addMonths(maturity, -step * back, false); coupons.push(cursor); }
  const pcd = coupons[coupons.length - 1] as number;
  const ncd = coupons[coupons.length - 2] as number;
  const n = coupons.length - 1;
  const E = coupDayDiff(pcd, ncd, basis);
  const T = coupDayDiff(settle, ncd, basis) / E;
  let price = redemption / Math.pow(disc, n - 1 + T);
  for (let k = 1; k <= n; k++) price += c / Math.pow(disc, k - 1 + T);
  price -= c * (coupDayDiff(pcd, settle, basis) / E);
  return price;
}
/** Read the first `count` numeric args + the basis at `count+1`; validates freq ∈ {1,2,4}. */
function bondArgs(args: EvalResult[], count: number): { v: number[]; freq: number; basis: number } | FormulaError {
  const v: number[] = [];
  for (let i = 0; i < count; i++) { const n = numAt(args, i); if (isError(n)) return n; v.push(n); }
  const basis = basisArg(args, count + 1);
  if (isError(basis)) return basis;
  const freq = Math.trunc(v[count - 1] as number);
  if (freq !== 1 && freq !== 2 && freq !== 4) return ERR.NUM;
  return { v, freq, basis };
}
const ODDFPRICE: FormulaFn = (args) => {
  const r = bondArgs(args, 8);
  if (isError(r)) return r;
  const [s, m, iss, fc, rate, yld, red] = r.v as number[];
  if (!(iss! < s! && s! < fc! && fc! < m!)) return ERR.NUM;
  return oddFirstBondPrice(s!, m!, iss!, fc!, rate!, yld!, red!, r.freq, r.basis);
};
const ODDFYIELD: FormulaFn = (args) => {
  const r = bondArgs(args, 8);
  if (isError(r)) return r;
  const [s, m, iss, fc, rate, pr, red] = r.v as number[];
  if (!(iss! < s! && s! < fc! && fc! < m!)) return ERR.NUM;
  return solveRoot((y) => oddFirstBondPrice(s!, m!, iss!, fc!, rate!, y, red!, r.freq, r.basis) - pr!, rate!);
};
const ODDLPRICE: FormulaFn = (args) => {
  const r = bondArgs(args, 7);
  if (isError(r)) return r;
  const [s, m, li, rate, yld, red] = r.v as number[];
  if (!(li! < s! && s! < m!)) return ERR.NUM;
  const fDCi = dayCountFrac(li!, m!, r.basis) * r.freq;
  const fDSCi = dayCountFrac(s!, m!, r.basis) * r.freq;
  const fAi = dayCountFrac(li!, s!, r.basis) * r.freq;
  let p = red! + (fDCi * 100 * rate!) / r.freq;
  p /= (fDSCi * yld!) / r.freq + 1;
  p -= (fAi * 100 * rate!) / r.freq;
  return p;
};
const ODDLYIELD: FormulaFn = (args) => {
  const r = bondArgs(args, 7);
  if (isError(r)) return r;
  const [s, m, li, rate, pr, red] = r.v as number[];
  if (!(li! < s! && s! < m!)) return ERR.NUM;
  const fDCi = dayCountFrac(li!, m!, r.basis) * r.freq;
  const fDSCi = dayCountFrac(s!, m!, r.basis) * r.freq;
  const fAi = dayCountFrac(li!, s!, r.basis) * r.freq;
  let y = red! + (fDCi * 100 * rate!) / r.freq;
  y /= pr! + (fAi * 100 * rate!) / r.freq;
  y -= 1;
  return (y * r.freq) / fDSCi;
};

// T-bills — actual/360, must mature within a year of settlement.
const TBILLPRICE: FormulaFn = (args) => {
  const s = narg(args, 0), m = narg(args, 1), d = narg(args, 2);
  for (const v of [s, m, d]) if (isError(v)) return v;
  const dsm = (m as number) - (s as number);
  if (dsm <= 0 || dsm > 366) return ERR.NUM;
  return 100 * (1 - (d as number) * dsm / 360);
};
const TBILLYIELD: FormulaFn = (args) => {
  const s = narg(args, 0), m = narg(args, 1), pr = narg(args, 2);
  for (const v of [s, m, pr]) if (isError(v)) return v;
  const dsm = (m as number) - (s as number);
  if (dsm <= 0 || dsm > 366) return ERR.NUM;
  return ((100 - (pr as number)) / (pr as number)) * (360 / dsm);
};
const TBILLEQ: FormulaFn = (args) => {
  const s = narg(args, 0), m = narg(args, 1), d = narg(args, 2);
  for (const v of [s, m, d]) if (isError(v)) return v;
  const dsm = (m as number) - (s as number);
  if (dsm <= 0 || dsm > 366) return ERR.NUM;
  return (365 * (d as number)) / (360 - (d as number) * dsm);
};

// Coupon-schedule inspectors.
const coupFn = (pick: (sch: { pcd: number; ncd: number; n: number }, settle: number, freq: number, basis: number) => number): FormulaFn => (args) => {
  const s = narg(args, 0), m = narg(args, 1), freq = narg(args, 2);
  for (const v of [s, m, freq]) if (isError(v)) return v;
  const f = Math.trunc(freq as number);
  if (f !== 1 && f !== 2 && f !== 4) return ERR.NUM;
  const basis = basisArg(args, 3);
  if (isError(basis)) return basis;
  return pick(couponSchedule(s as number, m as number, f), s as number, f, basis);
};
const COUPNUM = coupFn((sch) => sch.n);
const COUPPCD = coupFn((sch) => sch.pcd);
const COUPNCD = coupFn((sch) => sch.ncd);
const COUPDAYBS = coupFn((sch, settle, _f, basis) => coupDayDiff(sch.pcd, settle, basis));
const COUPDAYSNC = coupFn((sch, settle, _f, basis) => coupDayDiff(settle, sch.ncd, basis));
const COUPDAYS = coupFn((sch, _s, f, basis) => coupDaysInPeriod(sch.pcd, sch.ncd, f, basis));

/** Excel PRICE — present value of a coupon bond per 100 face. */
function bondPrice(settle: number, maturity: number, rate: number, yld: number, redemption: number, freq: number, basis: number): number {
  const { pcd, ncd, n } = couponSchedule(settle, maturity, freq);
  const E = coupDaysInPeriod(pcd, ncd, freq, basis);
  const DSC = coupDayDiff(settle, ncd, basis);
  const A = coupDayDiff(pcd, settle, basis);
  const T = DSC / E;
  const disc = 1 + yld / freq;
  const coupon = (100 * rate) / freq;
  let price = redemption / Math.pow(disc, n - 1 + T);
  for (let k = 1; k <= n; k++) price += coupon / Math.pow(disc, k - 1 + T);
  return price - coupon * (A / E);
}
const PRICE: FormulaFn = (args) => {
  const nums: number[] = [];
  for (let i = 0; i < 6; i++) { const v = numAt(args, i); if (isError(v)) return v; nums.push(v); }
  const basis = basisArg(args, 6);
  if (isError(basis)) return basis;
  const [s, m, rate, yld, red, freq] = nums as [number, number, number, number, number, number];
  const f = Math.trunc(freq);
  if (f !== 1 && f !== 2 && f !== 4) return ERR.NUM;
  return bondPrice(s, m, rate, yld, red, f, basis);
};
const YIELDFN: FormulaFn = (args) => {
  const nums: number[] = [];
  for (let i = 0; i < 6; i++) { const v = numAt(args, i); if (isError(v)) return v; nums.push(v); }
  const basis = basisArg(args, 6);
  if (isError(basis)) return basis;
  const [s, m, rate, pr, red, freq] = nums as [number, number, number, number, number, number];
  const f = Math.trunc(freq);
  if (f !== 1 && f !== 2 && f !== 4) return ERR.NUM;
  // PRICE is monotone-decreasing in yield → Newton from the coupon rate + bisection fallback.
  return solveRoot((y) => bondPrice(s, m, rate, y, red, f, basis) - pr, rate);
};
/** Macaulay duration (years) — the weighted-average time to the bond's cash flows. */
function bondDuration(settle: number, maturity: number, rate: number, yld: number, freq: number, basis: number, modified: boolean): number {
  const { pcd, ncd, n } = couponSchedule(settle, maturity, freq);
  const E = coupDaysInPeriod(pcd, ncd, freq, basis);
  const DSC = coupDayDiff(settle, ncd, basis);
  const T = DSC / E;
  const disc = 1 + yld / freq;
  const coupon = (100 * rate) / freq;
  let pv = 0;
  let weighted = 0;
  for (let k = 1; k <= n; k++) {
    const t = k - 1 + T;
    const cf = coupon + (k === n ? 100 : 0);
    const d = cf / Math.pow(disc, t);
    pv += d;
    weighted += (t / freq) * d;
  }
  const mac = weighted / pv;
  return modified ? mac / disc : mac;
}
const DURATION: FormulaFn = (args) => {
  const nums: number[] = [];
  for (let i = 0; i < 5; i++) { const v = numAt(args, i); if (isError(v)) return v; nums.push(v); }
  const basis = basisArg(args, 5);
  if (isError(basis)) return basis;
  const [s, m, rate, yld, freq] = nums as [number, number, number, number, number];
  return bondDuration(s, m, rate, yld, Math.trunc(freq), basis, false);
};
const MDURATION: FormulaFn = (args) => {
  const nums: number[] = [];
  for (let i = 0; i < 5; i++) { const v = numAt(args, i); if (isError(v)) return v; nums.push(v); }
  const basis = basisArg(args, 5);
  if (isError(basis)) return basis;
  const [s, m, rate, yld, freq] = nums as [number, number, number, number, number];
  return bondDuration(s, m, rate, yld, Math.trunc(freq), basis, true);
};
/** Variable declining-balance depreciation over [start, end], with the SL switch. */
const VDB: FormulaFn = (args) => {
  const nums: number[] = [];
  for (let i = 0; i < 5; i++) { const v = numAt(args, i); if (isError(v)) return v; nums.push(v); }
  const [cost, salvage, life, start, end] = nums as [number, number, number, number, number];
  const factor = args.length > 5 && scalarOf(argAt(args, 5)) != null ? numAt(args, 5) : 2;
  if (isError(factor)) return factor;
  const noSwitch = args.length > 6 ? toBoolean(scalarOf(argAt(args, 6))) : false;
  if (isError(noSwitch)) return noSwitch;
  const rate = factor / life;
  let book = cost;
  let total = 0;
  for (let p = 1; p <= Math.ceil(end); p++) {
    const db = Math.min(book * rate, book - salvage);
    let dep = db;
    if (!noSwitch) {
      const remainingLife = life - (p - 1);
      const sl = remainingLife > 0 ? (book - salvage) / remainingLife : 0;
      if (sl > db) dep = sl;
    }
    dep = Math.max(0, dep);
    // Fractional overlap of period p with the [start, end] window.
    const lo = Math.max(start, p - 1);
    const hi = Math.min(end, p);
    if (hi > lo) total += dep * (hi - lo);
    book -= dep;
  }
  return total;
};
/** French straight-line depreciation with a prorated first period (AMORLINC). */
const AMORLINC: FormulaFn = (args) => {
  const nums: number[] = [];
  for (let i = 0; i < 6; i++) { const v = numAt(args, i); if (isError(v)) return v; nums.push(v); }
  const [cost, purchased, firstPeriod, salvage, period, rate] = nums as [number, number, number, number, number, number];
  const basis = basisArg(args, 6);
  if (isError(basis)) return basis;
  const annual = cost * rate;
  const per = Math.trunc(period);
  let remaining = cost - salvage;
  let dep = Math.min(cost * rate * dayCountFrac(purchased, firstPeriod, basis), remaining);
  if (per === 0) return dep;
  remaining -= dep;
  for (let p = 1; p <= per; p++) {
    dep = Math.min(annual, remaining);
    if (dep <= 0) return 0;
    if (p === per) return dep;
    remaining -= dep;
  }
  return 0;
};
/** French declining-balance depreciation, coefficient by asset life (AMORDEGRC). */
const AMORDEGRC: FormulaFn = (args) => {
  const nums: number[] = [];
  for (let i = 0; i < 6; i++) { const v = numAt(args, i); if (isError(v)) return v; nums.push(v); }
  const [cost, purchased, firstPeriod, salvage, period, rate] = nums as [number, number, number, number, number, number];
  const basis = basisArg(args, 6);
  if (isError(basis)) return basis;
  const life = 1 / rate;
  const coef = life < 3 ? 1 : life <= 4 ? 1.5 : life <= 6 ? 2 : 2.5;
  const degRate = rate * coef;
  const per = Math.trunc(period);
  let book = cost;
  let dep = Math.round(cost * degRate * dayCountFrac(purchased, firstPeriod, basis));
  if (per === 0) return dep;
  book -= dep;
  for (let p = 1; p <= per; p++) {
    dep = Math.round(book * degRate);
    if (book - dep < salvage) dep = Math.max(0, book - salvage);
    if (p === per) return dep;
    book -= dep;
  }
  return dep;
};

// ---------------------------------------------------------------------------
// Slice 45a — Dynamic arrays (spill). Functions that return a `RangeValue`.
// ---------------------------------------------------------------------------

function makeRange(grid: FormulaValue[][]): RangeValue {
  const rows = grid.length;
  const cols = rows > 0 ? (grid[0] as FormulaValue[]).length : 0;
  const values: FormulaValue[] = [];
  for (const row of grid) for (const v of row) values.push(v);
  return { kind: 'range', values, rows, cols };
}
function to2D(r: RangeValue): FormulaValue[][] {
  const g: FormulaValue[][] = [];
  for (let i = 0; i < r.rows; i++) {
    const row: FormulaValue[] = [];
    for (let j = 0; j < r.cols; j++) row.push(r.values[i * r.cols + j] as FormulaValue);
    g.push(row);
  }
  return g;
}
/** Stable key for de-dup / equality of a value. */
function valueKey(v: FormulaValue): string {
  if (v === null) return 'b ';
  if (isError(v)) return 'e ' + v.code;
  return typeof v + ' ' + String(v);
}
function truthy(v: FormulaValue): boolean {
  const b = toBoolean(v);
  return isError(b) ? false : b;
}
/** Render one cell for `ARRAYTOTEXT` — an error becomes its `#…!` code, else its display text. */
function cellToText(v: FormulaValue): string {
  if (isError(v)) return v.code;
  const t = toText(v);
  return isError(t) ? t.code : t;
}
/** `ARRAYTOTEXT(array, [format])` (v1.7) — format 0 concise (comma-joined), format 1 array literal `{a,b;c,d}`. */
const ARRAYTOTEXT: FormulaFn = (args) => {
  const a = argAt(args, 0);
  const fmt = args.length > 1 ? numAt(args, 1) : 0;
  if (isError(fmt)) return fmt;
  const literal = Math.trunc(fmt) === 1;
  if (!isRange(a)) {
    const v = scalarOf(a);
    if (isError(v)) return v;
    return literal && typeof v === 'string' ? '"' + v + '"' : cellToText(v);
  }
  const grid = to2D(a);
  if (literal) {
    const rows = grid.map((row) =>
      row.map((v) => (typeof v === 'string' ? '"' + v + '"' : cellToText(v))).join(','),
    );
    return '{' + rows.join(';') + '}';
  }
  return grid.map((row) => row.map(cellToText).join(', ')).join(', ');
};
/** `AREAS(reference)` (v1.7) — count of contiguous rectangles; mini-grid has no union operator, so a valid reference/range is always 1. */
const AREAS: FormulaFn = (args) => {
  const a = argAt(args, 0);
  return isReference(a) || isRange(a) ? 1 : ERR.VALUE;
};

const SEQUENCE: FormulaFn = (args) => {
  const rows = numAt(args, 0);
  if (isError(rows)) return rows;
  const cols = args.length > 1 ? numAt(args, 1) : 1;
  if (isError(cols)) return cols;
  const start = args.length > 2 ? numAt(args, 2) : 1;
  if (isError(start)) return start;
  const step = args.length > 3 ? numAt(args, 3) : 1;
  if (isError(step)) return step;
  const R = Math.trunc(rows);
  const C = Math.trunc(cols);
  if (R < 1 || C < 1) return ERR.VALUE;
  const values: FormulaValue[] = [];
  let v = start;
  for (let i = 0; i < R * C; i++) { values.push(v); v += step; }
  return { kind: 'range', values, rows: R, cols: C };
};
const RANDARRAY: FormulaFn = (args) => {
  const R = args.length > 0 ? numAt(args, 0) : 1;
  if (isError(R)) return R;
  const C = args.length > 1 ? numAt(args, 1) : 1;
  if (isError(C)) return C;
  const min = args.length > 2 ? numAt(args, 2) : 0;
  if (isError(min)) return min;
  const max = args.length > 3 ? numAt(args, 3) : 1;
  if (isError(max)) return max;
  const integer = args.length > 4 ? truthy(scalarOf(argAt(args, 4))) : false;
  const rr = Math.max(1, Math.trunc(R));
  const cc = Math.max(1, Math.trunc(C));
  const values: FormulaValue[] = [];
  for (let i = 0; i < rr * cc; i++) {
    const x = min + Math.random() * (max - min);
    values.push(integer ? Math.floor(x + (max >= min ? 0 : 0)) : x);
  }
  if (integer) for (let i = 0; i < values.length; i++) values[i] = min + Math.floor(Math.random() * (max - min + 1));
  return { kind: 'range', values, rows: rr, cols: cc };
};
const TRANSPOSE: FormulaFn = (args) => {
  const r = argAt(args, 0);
  if (!isRange(r)) return scalarOf(r);
  const g = to2D(r);
  const t: FormulaValue[][] = [];
  for (let j = 0; j < r.cols; j++) {
    const row: FormulaValue[] = [];
    for (let i = 0; i < r.rows; i++) row.push((g[i] as FormulaValue[])[j] as FormulaValue);
    t.push(row);
  }
  return makeRange(t);
};
const UNIQUE: FormulaFn = (args) => {
  const r = argAt(args, 0);
  if (!isRange(r)) return scalarOf(r);
  const g = to2D(r);
  const seen = new Set<string>();
  const out: FormulaValue[][] = [];
  for (const row of g) {
    const key = row.map(valueKey).join('');
    if (!seen.has(key)) { seen.add(key); out.push(row); }
  }
  return out.length === 0 ? ERR.NA : makeRange(out);
};
const FILTER: FormulaFn = (args) => {
  const r = argAt(args, 0);
  const inc = argAt(args, 1);
  if (!isRange(r)) return ERR.VALUE;
  if (!isRange(inc)) return ERR.VALUE;
  const g = to2D(r);
  const out: FormulaValue[][] = [];
  if (inc.rows === r.rows && inc.cols <= 1) {
    for (let i = 0; i < r.rows; i++) if (truthy(inc.values[i] as FormulaValue)) out.push(g[i] as FormulaValue[]);
  } else if (inc.cols === r.cols && inc.rows <= 1) {
    for (let i = 0; i < r.rows; i++) {
      const row: FormulaValue[] = [];
      for (let j = 0; j < r.cols; j++) if (truthy(inc.values[j] as FormulaValue)) row.push((g[i] as FormulaValue[])[j] as FormulaValue);
      out.push(row);
    }
  } else return ERR.VALUE;
  if (out.length === 0 || (out[0] as FormulaValue[]).length === 0) {
    return args.length > 2 ? scalarOf(argAt(args, 2)) : ERR.CALC;
  }
  return makeRange(out);
};
const SORT: FormulaFn = (args) => {
  const r = argAt(args, 0);
  if (!isRange(r)) return scalarOf(r);
  const sortIndex = args.length > 1 ? numAt(args, 1) : 1;
  if (isError(sortIndex)) return sortIndex;
  const order = args.length > 2 ? numAt(args, 2) : 1;
  if (isError(order)) return order;
  const idx = Math.trunc(sortIndex) - 1;
  const dir = order < 0 ? -1 : 1;
  const g = to2D(r);
  const sorted = g.slice().sort((a, b) => dir * compareValues((a[idx] ?? null) as FormulaValue, (b[idx] ?? null) as FormulaValue));
  return makeRange(sorted);
};
const SORTBY: FormulaFn = (args) => {
  const r = argAt(args, 0);
  const by = argAt(args, 1);
  if (!isRange(r) || !isRange(by)) return ERR.VALUE;
  if (by.values.length !== r.rows) return ERR.VALUE;
  const g = to2D(r);
  const keyed = g.map((row, i) => ({ row, k: by.values[i] as FormulaValue }));
  keyed.sort((a, b) => compareValues(a.k, b.k));
  return makeRange(keyed.map((x) => x.row));
};
const TEXTSPLIT: FormulaFn = (args) => {
  const text = textAt(args, 0);
  if (isError(text)) return text;
  const colDelim = textAt(args, 1);
  if (isError(colDelim)) return colDelim;
  const rowDelim = args.length > 2 && scalarOf(argAt(args, 2)) != null ? textAt(args, 2) : '';
  if (isError(rowDelim)) return rowDelim;
  const rowsSrc = rowDelim ? text.split(rowDelim) : [text];
  const grid = rowsSrc.map((line) => (colDelim ? line.split(colDelim) : [line]) as FormulaValue[]);
  const width = grid.reduce((m, row) => Math.max(m, row.length), 0);
  for (const row of grid) while (row.length < width) row.push('');
  return makeRange(grid);
};
const TOROW: FormulaFn = (args) => {
  const r = argAt(args, 0);
  if (!isRange(r)) return scalarOf(r);
  return { kind: 'range', values: r.values.slice(), rows: 1, cols: r.values.length };
};
const TOCOL: FormulaFn = (args) => {
  const r = argAt(args, 0);
  if (!isRange(r)) return scalarOf(r);
  return { kind: 'range', values: r.values.slice(), rows: r.values.length, cols: 1 };
};

/** Coerce a (dereferenced) arg to a 2-D grid, or `null` if it isn't gridable. */
function asGrid(r: EvalResult | undefined): FormulaValue[][] | null {
  if (r === undefined || isReference(r) || isLambda(r)) return null;
  if (isRange(r)) return to2D(r);
  return [[r as FormulaValue]]; // a scalar acts as a 1×1 grid
}
const TAKE: FormulaFn = (args) => {
  const g = asGrid(argAt(args, 0));
  if (!g) return ERR.VALUE;
  let out = g;
  if (scalarOf(argAt(args, 1)) != null) {
    const rn = numAt(args, 1);
    if (isError(rn)) return rn;
    const R = Math.trunc(rn);
    out = R >= 0 ? out.slice(0, R) : out.slice(R);
  }
  if (args.length > 2 && scalarOf(argAt(args, 2)) != null) {
    const cn = numAt(args, 2);
    if (isError(cn)) return cn;
    const C = Math.trunc(cn);
    out = out.map((row) => (C >= 0 ? row.slice(0, C) : row.slice(C)));
  }
  return out.length === 0 || (out[0] as FormulaValue[]).length === 0 ? ERR.CALC : makeRange(out);
};
const DROP: FormulaFn = (args) => {
  const g = asGrid(argAt(args, 0));
  if (!g) return ERR.VALUE;
  let out = g;
  if (scalarOf(argAt(args, 1)) != null) {
    const rn = numAt(args, 1);
    if (isError(rn)) return rn;
    const R = Math.trunc(rn);
    out = R >= 0 ? out.slice(R) : out.slice(0, out.length + R);
  }
  if (args.length > 2 && scalarOf(argAt(args, 2)) != null) {
    const cn = numAt(args, 2);
    if (isError(cn)) return cn;
    const C = Math.trunc(cn);
    out = out.map((row) => (C >= 0 ? row.slice(C) : row.slice(0, row.length + C)));
  }
  return out.length === 0 || (out[0] as FormulaValue[]).length === 0 ? ERR.CALC : makeRange(out);
};
const HSTACK: FormulaFn = (args) => {
  const gs: FormulaValue[][][] = [];
  for (let i = 0; i < args.length; i++) { const g = asGrid(argAt(args, i)); if (!g) return ERR.VALUE; gs.push(g); }
  const maxRows = Math.max(...gs.map((g) => g.length));
  const out: FormulaValue[][] = [];
  for (let r = 0; r < maxRows; r++) {
    const row: FormulaValue[] = [];
    for (const g of gs) {
      const width = (g[0] as FormulaValue[]).length;
      const gr = g[r];
      for (let c = 0; c < width; c++) row.push(gr ? (gr[c] as FormulaValue) : ERR.NA);
    }
    out.push(row);
  }
  return makeRange(out);
};
const VSTACK: FormulaFn = (args) => {
  const gs: FormulaValue[][][] = [];
  for (let i = 0; i < args.length; i++) { const g = asGrid(argAt(args, i)); if (!g) return ERR.VALUE; gs.push(g); }
  const maxCols = Math.max(...gs.map((g) => (g[0] as FormulaValue[]).length));
  const out: FormulaValue[][] = [];
  for (const g of gs) for (const gr of g) {
    const row = gr.slice();
    while (row.length < maxCols) row.push(ERR.NA);
    out.push(row);
  }
  return makeRange(out);
};
const wrapFn = (byRow: boolean): FormulaFn => (args) => {
  const g = asGrid(argAt(args, 0));
  if (!g) return ERR.VALUE;
  const count = numAt(args, 1);
  if (isError(count)) return count;
  const width = Math.max(1, Math.trunc(count));
  const pad = args.length > 2 && scalarOf(argAt(args, 2)) != null ? scalarOf(argAt(args, 2)) : ERR.NA;
  const flat = g.flat();
  const lines: FormulaValue[][] = [];
  for (let i = 0; i < flat.length; i += width) {
    const line = flat.slice(i, i + width);
    while (line.length < width) line.push(pad);
    lines.push(line);
  }
  if (byRow) return makeRange(lines);
  // WRAPCOLS fills column-by-column → the transpose of the row-wrapped grid.
  const t: FormulaValue[][] = [];
  for (let r = 0; r < width; r++) {
    const row: FormulaValue[] = [];
    for (let c = 0; c < lines.length; c++) row.push((lines[c] as FormulaValue[])[r] as FormulaValue);
    t.push(row);
  }
  return makeRange(t);
};
const CHOOSEROWS: FormulaFn = (args) => {
  const g = asGrid(argAt(args, 0));
  if (!g) return ERR.VALUE;
  const out: FormulaValue[][] = [];
  for (let i = 1; i < args.length; i++) {
    const idx = numAt(args, i);
    if (isError(idx)) return idx;
    const n = Math.trunc(idx);
    const r = n > 0 ? n - 1 : g.length + n;
    if (r < 0 || r >= g.length) return ERR.VALUE;
    out.push((g[r] as FormulaValue[]).slice());
  }
  return makeRange(out);
};
const CHOOSECOLS: FormulaFn = (args) => {
  const g = asGrid(argAt(args, 0));
  if (!g) return ERR.VALUE;
  const width = (g[0] as FormulaValue[]).length;
  const picks: number[] = [];
  for (let i = 1; i < args.length; i++) {
    const idx = numAt(args, i);
    if (isError(idx)) return idx;
    const n = Math.trunc(idx);
    const c = n > 0 ? n - 1 : width + n;
    if (c < 0 || c >= width) return ERR.VALUE;
    picks.push(c);
  }
  return makeRange(g.map((row) => picks.map((c) => row[c] as FormulaValue)));
};
const EXPAND: FormulaFn = (args) => {
  const g = asGrid(argAt(args, 0));
  if (!g) return ERR.VALUE;
  const rn = numAt(args, 1);
  if (isError(rn)) return rn;
  const R = Math.trunc(rn);
  const curCols = (g[0] as FormulaValue[]).length;
  const cn = args.length > 2 && scalarOf(argAt(args, 2)) != null ? numAt(args, 2) : curCols;
  if (isError(cn)) return cn;
  const C = Math.trunc(cn);
  const pad = args.length > 3 && scalarOf(argAt(args, 3)) != null ? scalarOf(argAt(args, 3)) : ERR.NA;
  if (R < g.length || C < curCols) return ERR.VALUE;
  const out: FormulaValue[][] = [];
  for (let r = 0; r < R; r++) {
    const row: FormulaValue[] = [];
    for (let c = 0; c < C; c++) row.push(r < g.length && c < curCols ? ((g[r] as FormulaValue[])[c] as FormulaValue) : pad);
    out.push(row);
  }
  return makeRange(out);
};
const MMULT: FormulaFn = (args) => {
  const A = asGrid(argAt(args, 0));
  const B = asGrid(argAt(args, 1));
  if (!A || !B) return ERR.VALUE;
  const m = A.length;
  const n = (A[0] as FormulaValue[]).length;
  const p = (B[0] as FormulaValue[]).length;
  if (B.length !== n) return ERR.VALUE;
  const out: FormulaValue[][] = [];
  for (let i = 0; i < m; i++) {
    const row: FormulaValue[] = [];
    for (let j = 0; j < p; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) {
        const a = toNumber((A[i] as FormulaValue[])[k] as FormulaValue);
        if (isError(a)) return a;
        const b = toNumber((B[k] as FormulaValue[])[j] as FormulaValue);
        if (isError(b)) return b;
        s += a * b;
      }
      row.push(s);
    }
    out.push(row);
  }
  return makeRange(out);
};

// ---------------------------------------------------------------------------
// v1.7 bucket B — linear algebra core + matrix / regression functions.
// ---------------------------------------------------------------------------

/** Coerce a grid to `number[][]`, erroring on any non-numeric cell. */
function numMatrix(g: FormulaValue[][]): number[][] | FormulaError {
  const out: number[][] = [];
  for (const row of g) {
    const r: number[] = [];
    for (const v of row) {
      const n = toNumber(v);
      if (isError(n)) return n;
      r.push(n);
    }
    out.push(r);
  }
  return out;
}
/** Determinant via Gaussian elimination with partial pivoting (0 if singular). */
function determinant(a: number[][]): number {
  const n = a.length;
  const m = a.map((r) => r.slice());
  let det = 1;
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[piv]![col]!)) piv = r;
    if (Math.abs(m[piv]![col]!) < 1e-14) return 0;
    if (piv !== col) { const t = m[col]!; m[col] = m[piv]!; m[piv] = t; det = -det; }
    det *= m[col]![col]!;
    for (let r = col + 1; r < n; r++) {
      const f = m[r]![col]! / m[col]![col]!;
      for (let j = col; j < n; j++) m[r]![j]! -= f * m[col]![j]!;
    }
  }
  return det;
}
/** Inverse via Gauss–Jordan; returns null if singular. */
function invert(a: number[][]): number[][] | null {
  const n = a.length;
  const m = a.map((r) => r.slice());
  const inv = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[piv]![col]!)) piv = r;
    if (Math.abs(m[piv]![col]!) < 1e-12) return null;
    if (piv !== col) {
      const t = m[col]!; m[col] = m[piv]!; m[piv] = t;
      const u = inv[col]!; inv[col] = inv[piv]!; inv[piv] = u;
    }
    const p = m[col]![col]!;
    for (let j = 0; j < n; j++) { m[col]![j]! /= p; inv[col]![j]! /= p; }
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r]![col]!;
      if (f === 0) continue;
      for (let j = 0; j < n; j++) { m[r]![j]! -= f * m[col]![j]!; inv[r]![j]! -= f * inv[col]![j]!; }
    }
  }
  return inv;
}
const MUNIT: FormulaFn = (args) => {
  const n = numAt(args, 0);
  if (isError(n)) return n;
  const N = Math.trunc(n);
  if (N < 1) return ERR.VALUE;
  const grid: FormulaValue[][] = Array.from({ length: N }, (_, i) =>
    Array.from({ length: N }, (_, j) => (i === j ? 1 : 0)),
  );
  return makeRange(grid);
};
const MDETERM: FormulaFn = (args) => {
  const g = asGrid(argAt(args, 0));
  if (!g) return ERR.VALUE;
  if (g.length === 0 || g.length !== (g[0] as FormulaValue[]).length) return ERR.VALUE;
  const m = numMatrix(g);
  if (isError(m)) return m;
  return determinant(m);
};
const MINVERSE: FormulaFn = (args) => {
  const g = asGrid(argAt(args, 0));
  if (!g) return ERR.VALUE;
  if (g.length === 0 || g.length !== (g[0] as FormulaValue[]).length) return ERR.VALUE;
  const m = numMatrix(g);
  if (isError(m)) return m;
  const inv = invert(m);
  return inv === null ? ERR.NUM : makeRange(inv);
};

/**
 * Build the regression design: observations as rows of `[x…, (1)]`, plus `y`.
 * `known_x` omitted → `{1,2,…,n}`. Orientation-tolerant: a `known_x` whose row
 * count ≠ n is transposed. Returns an error on a shape mismatch.
 */
function regressionDesign(
  yArg: EvalResult | undefined,
  xArg: EvalResult | undefined,
  useConst: boolean,
): { X: number[][]; k: number } | FormulaError {
  const yg = asGrid(yArg);
  if (!yg) return ERR.VALUE;
  const ym = numMatrix(yg);
  if (isError(ym)) return ym;
  const n = ym.flat().length;
  if (n === 0) return ERR.NA;
  let cols: number[][]; // cols[v] = the v-th independent variable, length n
  if (xArg === undefined || scalarOf(xArg) == null) {
    cols = [Array.from({ length: n }, (_, i) => i + 1)];
  } else {
    const xg = asGrid(xArg);
    if (!xg) return ERR.VALUE;
    const xm = numMatrix(xg);
    if (isError(xm)) return xm;
    let obsRows: number[][];
    if (xm.length === n) obsRows = xm;
    else if ((xm[0]?.length ?? 0) === n) obsRows = xm[0]!.map((_, j) => xm.map((r) => r[j]!));
    else return ERR.REF;
    const kk = obsRows[0]!.length;
    cols = Array.from({ length: kk }, (_, v) => obsRows.map((r) => r[v]!));
  }
  const k = cols.length;
  const X = Array.from({ length: n }, (_, i) => {
    const row = cols.map((c) => c[i]!);
    if (useConst) row.push(1);
    return row;
  });
  return { X, k };
}
/** Solve least-squares `Xb = y` via the normal equations; returns `b` or an error. */
/** Least-squares fit via the normal equations; returns the coefficients + `(XᵀX)⁻¹` (for std errors). */
function lstsqFull(X: number[][], y: number[]): { b: number[]; inv: number[][] } | FormulaError {
  const p = X[0]!.length;
  const ata = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const aty = new Array<number>(p).fill(0);
  for (let i = 0; i < X.length; i++) {
    for (let a = 0; a < p; a++) {
      aty[a]! += X[i]![a]! * y[i]!;
      for (let b = 0; b < p; b++) ata[a]![b]! += X[i]![a]! * X[i]![b]!;
    }
  }
  const inv = invert(ata);
  if (inv === null) return ERR.NUM;
  return { b: inv.map((row) => row.reduce((s, v, j) => s + v * aty[j]!, 0)), inv };
}
function lstsq(X: number[][], y: number[]): number[] | FormulaError {
  const r = lstsqFull(X, y);
  return isError(r) ? r : r.b;
}
/**
 * `LINEST`/`LOGEST` — coefficient row `[m_k … m_1, b]` (Excel reverse-column order),
 * or the full 5-row statistics block when `stats` (arg 3) is TRUE. `LOGEST` fits
 * `ln(y)`; its coefficient row is exponentiated, the stats rows are in the log model.
 */
const linestFn = (log: boolean): FormulaFn => (args) => {
  const useConst = args.length > 2 && scalarOf(argAt(args, 2)) != null ? truthy(scalarOf(argAt(args, 2))) : true;
  const wantStats = args.length > 3 && scalarOf(argAt(args, 3)) != null ? truthy(scalarOf(argAt(args, 3))) : false;
  const yg = asGrid(argAt(args, 0));
  if (!yg) return ERR.VALUE;
  const yRaw = numMatrix(yg);
  if (isError(yRaw)) return yRaw;
  const yFlat = yRaw.flat();
  if (log && yFlat.some((v) => v <= 0)) return ERR.NUM;
  const y = log ? yFlat.map((v) => Math.log(v)) : yFlat;
  const design = regressionDesign(argAt(args, 0), argAt(args, 1), useConst);
  if (isError(design)) return design;
  const fit = lstsqFull(design.X, y);
  if (isError(fit)) return fit;
  const { b, inv } = fit;
  const k = design.k;
  const ms = b.slice(0, k).reverse();
  const coeffs = (useConst ? [...ms, b[k]!] : [...ms, 0]).map((c) => (log ? Math.exp(c) : c));
  if (!wantStats) return makeRange([coeffs]);
  // Full statistics block (5 rows × (k+1) cols; rows 3–5 use 2 cols, padded with #N/A).
  const n = design.X.length;
  const p = design.X[0]!.length; // fitted params
  const dfresid = n - p;
  let ssresid = 0;
  for (let i = 0; i < n; i++) {
    const yhat = design.X[i]!.reduce((s, v, j) => s + v * b[j]!, 0);
    ssresid += (y[i]! - yhat) ** 2;
  }
  const ybar = useConst ? y.reduce((s, v) => s + v, 0) / n : 0;
  const sstot = y.reduce((s, v) => s + (v - ybar) ** 2, 0);
  const ssreg = sstot - ssresid;
  const msresid = dfresid > 0 ? ssresid / dfresid : 0;
  const seB = inv.map((row, j) => Math.sqrt(Math.max(0, row[j]!) * msresid));
  const seMs = seB.slice(0, k).reverse();
  const seRow = useConst ? [...seMs, seB[k]!] : [...seMs, 0];
  const r2 = sstot === 0 ? 1 : ssreg / sstot;
  const sey = Math.sqrt(msresid);
  const F = dfresid > 0 && msresid > 0 ? ssreg / k / msresid : ssreg > 0 ? Infinity : 0;
  const nc = coeffs.length;
  const pad = (row: FormulaValue[]): FormulaValue[] => {
    while (row.length < nc) row.push(ERR.NA);
    return row;
  };
  return makeRange([coeffs, seRow, pad([r2, sey]), pad([F, dfresid]), pad([ssreg, ssresid])]);
};
/** Design rows for prediction at `new_x` (k independent variables), orientation-tolerant. */
function predictDesign(xArg: EvalResult | undefined, k: number, useConst: boolean): number[][] | FormulaError {
  const xg = asGrid(xArg);
  if (!xg) return ERR.VALUE;
  const xm = numMatrix(xg);
  if (isError(xm)) return xm;
  let obsRows: number[][];
  if ((xm[0]?.length ?? 0) === k) obsRows = xm;
  else if (xm.length === k) obsRows = xm[0]!.map((_, j) => xm.map((r) => r[j]!));
  else if (k === 1) obsRows = xm.flat().map((v) => [v]);
  else return ERR.REF;
  return obsRows.map((r) => (useConst ? [...r, 1] : [...r]));
}
/** `TREND`/`GROWTH` — fit on known_x/known_y, predict at new_x (default known_x). */
const trendFn = (log: boolean): FormulaFn => (args) => {
  const useConst = args.length > 3 && scalarOf(argAt(args, 3)) != null ? truthy(scalarOf(argAt(args, 3))) : true;
  const yg = asGrid(argAt(args, 0));
  if (!yg) return ERR.VALUE;
  const yRaw = numMatrix(yg);
  if (isError(yRaw)) return yRaw;
  const yFlat = yRaw.flat();
  if (log && yFlat.some((v) => v <= 0)) return ERR.NUM;
  const y = log ? yFlat.map((v) => Math.log(v)) : yFlat;
  const design = regressionDesign(argAt(args, 0), argAt(args, 1), useConst);
  if (isError(design)) return design;
  const b = lstsq(design.X, y);
  if (isError(b)) return b;
  let predX: number[][];
  if (args.length > 2 && scalarOf(argAt(args, 2)) != null) {
    const pd = predictDesign(argAt(args, 2), design.k, useConst);
    if (isError(pd)) return pd;
    predX = pd;
  } else {
    predX = design.X; // predict at known_x
  }
  const preds = predX.map((row) => {
    const p = row.reduce((s, v, j) => s + v * b[j]!, 0);
    return log ? Math.exp(p) : p;
  });
  return makeRange(preds.map((v) => [v]));
};

// ---------------------------------------------------------------------------
// v1.7 bucket D — GROUPBY / PIVOTBY (aggregation by named reducer).
// The aggregation is named (a string, e.g. "SUM") and dispatched to the built
// reducer in FUNCTIONS — mini-grid has no bare function-reference value, so a
// The aggregation is a named reducer (a string) OR a LAMBDA (applied via ctx).
// ---------------------------------------------------------------------------

/** Apply an aggregation — a named reducer (`"SUM"`/…) or a `LAMBDA(v, …)` — to a group's values. */
type Reducer = (values: FormulaValue[]) => FormulaValue | FormulaError;
/** Resolve the aggregation (a named reducer or a `LAMBDA`) to a reusable reducer, **once** per call. */
function resolveAgg(agg: EvalResult | undefined, ctx: FnContext): Reducer | FormulaError {
  const collapse = (r: EvalResult): FormulaValue | FormulaError =>
    isRange(r) || isReference(r) || isLambda(r) ? ERR.CALC : (r as FormulaValue);
  if (isLambda(agg)) {
    if (!ctx.applyLambda) return ERR.CALC;
    const apply = ctx.applyLambda;
    return (values) => collapse(apply(agg, [{ kind: 'range', values, rows: values.length, cols: 1 }]));
  }
  const name = scalarOf(agg);
  if (typeof name !== 'string') return ERR.VALUE;
  const fn = FUNCTIONS[name.trim().toUpperCase()];
  if (!fn) return ERR.NAME;
  return (values) => collapse(fn([{ kind: 'range', values, rows: values.length, cols: 1 }], ctx));
}
/** Group key for a row-field tuple — no `.map().join()` alloc for the common single-column case. */
function groupKey(tuple: FormulaValue[]): string {
  return tuple.length === 1 ? valueKey(tuple[0] as FormulaValue) : tuple.map(valueKey).join('\x00');
}
const GROUPBY: FormulaFn = (args, ctx) => {
  const rf = asGrid(argAt(args, 0));
  const vg = asGrid(argAt(args, 1));
  if (!rf || !vg) return ERR.VALUE;
  const n = rf.length;
  if (vg.length !== n || n === 0) return ERR.VALUE;
  const reduce = resolveAgg(argAt(args, 2), ctx);
  if (isError(reduce)) return reduce;
  const order: string[] = [];
  const groups = new Map<string, { key: FormulaValue[]; vals: FormulaValue[] }>();
  for (let i = 0; i < n; i++) {
    const keyTuple = rf[i]!;
    const kk = groupKey(keyTuple);
    let g = groups.get(kk);
    if (!g) { g = { key: keyTuple, vals: [] }; groups.set(kk, g); order.push(kk); }
    g.vals.push(vg[i]![0] as FormulaValue);
  }
  const out: FormulaValue[][] = [];
  for (const kk of order) {
    const g = groups.get(kk)!;
    const val = reduce(g.vals);
    if (isError(val)) return val;
    out.push([...g.key, val]);
  }
  return makeRange(out);
};
const PIVOTBY: FormulaFn = (args, ctx) => {
  const rf = asGrid(argAt(args, 0));
  const cf = asGrid(argAt(args, 1));
  const vg = asGrid(argAt(args, 2));
  if (!rf || !cf || !vg) return ERR.VALUE;
  const n = rf.length;
  if (cf.length !== n || vg.length !== n || n === 0) return ERR.VALUE;
  const reduce = resolveAgg(argAt(args, 3), ctx);
  if (isError(reduce)) return reduce;
  const rowOrder: FormulaValue[] = [];
  const colOrder: FormulaValue[] = [];
  const seenR = new Set<string>();
  const seenC = new Set<string>();
  const cells = new Map<string, FormulaValue[]>();
  for (let i = 0; i < n; i++) {
    const rk = rf[i]![0] as FormulaValue;
    const ck = cf[i]![0] as FormulaValue;
    const rKey = valueKey(rk);
    const cKey = valueKey(ck);
    if (!seenR.has(rKey)) { seenR.add(rKey); rowOrder.push(rk); }
    if (!seenC.has(cKey)) { seenC.add(cKey); colOrder.push(ck); }
    const key = rKey + '\x00' + cKey;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key)!.push(vg[i]![0] as FormulaValue);
  }
  const out: FormulaValue[][] = [['', ...colOrder]];
  for (const rk of rowOrder) {
    const row: FormulaValue[] = [rk];
    for (const ck of colOrder) {
      const g = cells.get(valueKey(rk) + '\x00' + valueKey(ck));
      if (!g) { row.push(''); continue; }
      const val = reduce(g);
      if (isError(val)) return val;
      row.push(val);
    }
    out.push(row);
  }
  return makeRange(out);
};
const FREQUENCY: FormulaFn = (args) => {
  const data = collectNumbers([argAt(args, 0) as EvalResult]);
  if (isError(data)) return data;
  const binsRaw = collectNumbers([argAt(args, 1) as EvalResult]);
  if (isError(binsRaw)) return binsRaw;
  const bins = binsRaw.slice().sort((a, b) => a - b);
  const counts = new Array<number>(bins.length + 1).fill(0);
  for (const x of data) {
    let placed = false;
    for (let i = 0; i < bins.length; i++) {
      if (x <= (bins[i] as number)) { counts[i] = (counts[i] ?? 0) + 1; placed = true; break; }
    }
    if (!placed) counts[bins.length] = (counts[bins.length] ?? 0) + 1;
  }
  return { kind: 'range', values: counts, rows: counts.length, cols: 1 };
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const FUNCTIONS: Record<string, FormulaFn> = {
  // math / agg
  SUM,
  AVERAGE,
  AVG: AVERAGE,
  COUNT,
  COUNTA,
  MIN: MINFN,
  MAX: MAXFN,
  PRODUCT,
  ROUND,
  ROUNDUP,
  ROUNDDOWN,
  INT: unaryNum((n) => Math.floor(n)),
  ABS: unaryNum((n) => Math.abs(n)),
  SQRT: unaryNum((n) => (n < 0 ? ERR.NUM : Math.sqrt(n))),
  POWER: POWERFN,
  MOD: MODFN,
  CEILING: CEILINGFN,
  FLOOR: FLOORFN,
  EXP: unaryNum((n) => { const e = Math.exp(n); return Number.isFinite(e) ? e : ERR.NUM; }),
  LN: unaryNum((n) => (n <= 0 ? ERR.NUM : Math.log(n))),
  LOG: LOGFN,
  LOG10: unaryNum((n) => (n <= 0 ? ERR.NUM : Math.log10(n))),
  SIGN: unaryNum((n) => Math.sign(n)),
  TRUNC: unaryNum((n) => Math.trunc(n)),
  SUMPRODUCT,
  SUMSQ,
  SUMIF: (args) => ifReduce(args, 'sum'),
  COUNTIF: (args) => ifReduce(args, 'count'),
  AVERAGEIF: (args) => ifReduce(args, 'average'),
  // slice 42a — *IFS family (N criteria) + COUNTBLANK + SUBTOTAL
  SUMIFS: (args) => ifsReduce(args, 'sum'),
  COUNTIFS: (args) => ifsReduce(args, 'count'),
  AVERAGEIFS: (args) => ifsReduce(args, 'average'),
  MAXIFS: (args) => ifsReduce(args, 'max'),
  MINIFS: (args) => ifsReduce(args, 'min'),
  COUNTBLANK,
  SUBTOTAL,
  // slice 42a — database (D*) functions
  DSUM: (args) => dbReduce(args, 'sum'),
  DCOUNT: (args) => dbReduce(args, 'count'),
  DCOUNTA: (args) => dbReduce(args, 'counta'),
  DGET: (args) => dbReduce(args, 'get'),
  DMAX: (args) => dbReduce(args, 'max'),
  DMIN: (args) => dbReduce(args, 'min'),
  DPRODUCT: (args) => dbReduce(args, 'product'),
  DAVERAGE: (args) => dbReduce(args, 'average'),
  DSTDEV: (args) => dbReduce(args, 'stdev'),
  DSTDEVP: (args) => dbReduce(args, 'stdevp'),
  DVAR: (args) => dbReduce(args, 'var'),
  DVARP: (args) => dbReduce(args, 'varp'),

  // slice 42b — financial (TVM / depreciation / rate conversion)
  PMT,
  PV,
  FV,
  NPER,
  RATE,
  IPMT,
  PPMT,
  CUMIPMT: (args) => cumulate(args, 'interest'),
  CUMPRINC: (args) => cumulate(args, 'principal'),
  ISPMT,
  NPV,
  IRR,
  MIRR,
  XNPV,
  XIRR,
  FVSCHEDULE,
  SLN,
  SYD,
  DDB,
  DB,
  EFFECT,
  NOMINAL,
  PDURATION,
  RRI,
  DOLLARDE,
  DOLLARFR,

  // slice 42c-1 — statistical (descriptive, ranking, regression) + AGGREGATE
  MEDIAN,
  'MODE.SNGL': MODESNGL,
  MODE: MODESNGL, // compat alias
  'MODE.MULT': MODEMULT,
  PROB,
  LARGE,
  SMALL,
  'RANK.EQ': rankFn(false),
  'RANK.AVG': rankFn(true),
  RANK: rankFn(false), // compat alias
  'PERCENTILE.INC': pctileFn(false),
  'PERCENTILE.EXC': pctileFn(true),
  PERCENTILE: pctileFn(false), // compat alias
  'QUARTILE.INC': quartileFn(false),
  'QUARTILE.EXC': quartileFn(true),
  QUARTILE: quartileFn(false), // compat alias
  'PERCENTRANK.INC': percentRankFn(false),
  'PERCENTRANK.EXC': percentRankFn(true),
  PERCENTRANK: percentRankFn(false), // compat alias
  'STDEV.S': (args) => stdev(args, true),
  'STDEV.P': (args) => stdev(args, false),
  STDEV: (args) => stdev(args, true), // compat alias
  STDEVP: (args) => stdev(args, false), // compat alias
  STDEVA: (args) => { const n = collectNumbersA(args); return isError(n) ? n : stdevOfNums(n, true); },
  STDEVPA: (args) => { const n = collectNumbersA(args); return isError(n) ? n : stdevOfNums(n, false); },
  'VAR.S': (args) => variance(args, true),
  'VAR.P': (args) => variance(args, false),
  VAR: (args) => variance(args, true), // compat alias
  VARP: (args) => variance(args, false), // compat alias
  VARA: (args) => { const n = collectNumbersA(args); return isError(n) ? n : varOfNums(n, true); },
  VARPA: (args) => { const n = collectNumbersA(args); return isError(n) ? n : varOfNums(n, false); },
  AVEDEV,
  DEVSQ,
  GEOMEAN,
  HARMEAN,
  KURT: (args) => { const n = collectNumbers(args); return isError(n) ? n : kurtosis(n); },
  SKEW: (args) => { const n = collectNumbers(args); return isError(n) ? n : skewness(n, false); },
  'SKEW.P': (args) => { const n = collectNumbers(args); return isError(n) ? n : skewness(n, true); },
  TRIMMEAN,
  STANDARDIZE,
  AVERAGEA: statA('avg'),
  MAXA: statA('max'),
  MINA: statA('min'),
  CORREL,
  PEARSON: CORREL, // alias
  'COVARIANCE.P': covFn(false),
  'COVARIANCE.S': covFn(true),
  COVAR: covFn(false), // compat alias
  SLOPE,
  INTERCEPT,
  RSQ,
  STEYX,
  'FORECAST.LINEAR': FORECASTLINEAR,
  FORECAST: FORECASTLINEAR, // compat alias
  AGGREGATE,

  // slice 42d — math & trigonometry
  PI: () => Math.PI,
  DEGREES: unaryNum((n) => (n * 180) / Math.PI),
  RADIANS: unaryNum((n) => (n * Math.PI) / 180),
  SQRTPI: unaryNum((n) => (n < 0 ? ERR.NUM : Math.sqrt(n * Math.PI))),
  SIN: unaryNum(Math.sin),
  COS: unaryNum(Math.cos),
  TAN: unaryNum(Math.tan),
  ASIN: unaryNum((n) => (Math.abs(n) > 1 ? ERR.NUM : Math.asin(n))),
  ACOS: unaryNum((n) => (Math.abs(n) > 1 ? ERR.NUM : Math.acos(n))),
  ATAN: unaryNum(Math.atan),
  ATAN2,
  SINH: unaryNum(Math.sinh),
  COSH: unaryNum(Math.cosh),
  TANH: unaryNum(Math.tanh),
  ASINH: unaryNum(Math.asinh),
  ACOSH: unaryNum((n) => (n < 1 ? ERR.NUM : Math.acosh(n))),
  ATANH: unaryNum((n) => (Math.abs(n) >= 1 ? ERR.NUM : Math.atanh(n))),
  SEC: unaryNum((n) => 1 / Math.cos(n)),
  CSC: unaryNum((n) => 1 / Math.sin(n)),
  COT: unaryNum((n) => 1 / Math.tan(n)),
  SECH: unaryNum((n) => 1 / Math.cosh(n)),
  CSCH: unaryNum((n) => 1 / Math.sinh(n)),
  COTH: unaryNum((n) => Math.cosh(n) / Math.sinh(n)),
  ACOT: unaryNum((n) => Math.PI / 2 - Math.atan(n)),
  ACOTH: unaryNum((n) => (Math.abs(n) <= 1 ? ERR.NUM : Math.atanh(1 / n))),
  GCD,
  LCM,
  QUOTIENT,
  EVEN: unaryNum((n) => { const m = Math.ceil(Math.abs(n) / 2) * 2; return n < 0 ? -m : m; }),
  ODD: unaryNum((n) => { let m = Math.ceil(Math.abs(n)); if (m % 2 === 0) m += 1; if (m === 0) m = 1; return n < 0 ? -m : m; }),
  FACT: unaryNum(factOf),
  FACTDOUBLE: unaryNum(factDoubleOf),
  COMBIN: binomFn(combinOf),
  COMBINA: binomFn((n, k) => combinOf(n + k - 1, k)),
  PERMUT: binomFn(permutOf),
  PERMUTATIONA: binomFn((n, k) => Math.pow(Math.trunc(n), Math.trunc(k))),
  MULTINOMIAL,
  GAMMALN: unaryNum((n) => (n <= 0 ? ERR.NUM : gammaln(n))),
  'GAMMALN.PRECISE': unaryNum((n) => (n <= 0 ? ERR.NUM : gammaln(n))),
  SERIESSUM,
  SUMX2MY2: sumPairFn((x, y) => x * x - y * y),
  SUMX2PY2: sumPairFn((x, y) => x * x + y * y),
  SUMXMY2: sumPairFn((x, y) => (x - y) * (x - y)),
  ROMAN,
  ARABIC,
  BASE,
  DECIMAL,
  MROUND,
  'CEILING.MATH': ceilFloorMath('ceil'),
  'FLOOR.MATH': ceilFloorMath('floor'),
  'CEILING.PRECISE': precise('ceil'),
  'FLOOR.PRECISE': precise('floor'),
  'ISO.CEILING': precise('ceil'),

  // slice 42e — date/time
  TIME,
  HOUR: timeGetter('h'),
  MINUTE: timeGetter('m'),
  SECOND: timeGetter('s'),
  DATEVALUE,
  TIMEVALUE,
  DATEDIF,
  DAYS,
  DAYS360,
  EDATE,
  EOMONTH,
  WEEKDAY,
  WEEKNUM,
  ISOWEEKNUM,
  YEARFRAC,
  NETWORKDAYS: NETWORKDAYS(false),
  'NETWORKDAYS.INTL': NETWORKDAYS(true),
  WORKDAY: WORKDAY(false),
  'WORKDAY.INTL': WORKDAY(true),

  // slice 42e — text
  FIXED,
  DOLLAR,
  NUMBERVALUE,
  CLEAN,
  T: TFN,
  UNICHAR,
  UNICODE,
  TEXTBEFORE: (args) => textBeforeAfter(args, false),
  TEXTAFTER: (args) => textBeforeAfter(args, true),
  VALUETOTEXT,
  ARRAYTOTEXT,
  REGEXTEST,
  REGEXEXTRACT,
  REGEXREPLACE,

  // slice 42f — engineering: base conversions
  DEC2BIN: dec2(2, 10),
  DEC2OCT: dec2(8, 10),
  DEC2HEX: dec2(16, 10),
  BIN2DEC: from2to(2, null),
  BIN2OCT: from2to(2, 8),
  BIN2HEX: from2to(2, 16),
  OCT2DEC: from2to(8, null),
  OCT2BIN: from2to(8, 2),
  OCT2HEX: from2to(8, 16),
  HEX2DEC: from2to(16, null),
  HEX2BIN: from2to(16, 2),
  HEX2OCT: from2to(16, 8),
  // bitwise
  BITAND: bitFn((a, b) => a & b),
  BITOR: bitFn((a, b) => a | b),
  BITXOR: bitFn((a, b) => a ^ b),
  BITLSHIFT,
  BITRSHIFT,
  // step / error functions
  DELTA,
  GESTEP,
  BESSELJ: besselFn(besselJ),
  BESSELY: besselFn(besselY),
  BESSELI: besselFn(besselI),
  BESSELK: besselFn(besselK),
  ERF,
  'ERF.PRECISE': (args) => { const a = numAt(args, 0); return isError(a) ? a : erf(a); },
  ERFC: (args) => { const a = numAt(args, 0); return isError(a) ? a : 1 - erf(a); },
  'ERFC.PRECISE': (args) => { const a = numAt(args, 0); return isError(a) ? a : 1 - erf(a); },
  CONVERT,
  // complex numbers
  COMPLEX,
  IMREAL: imUnary((re) => re),
  IMAGINARY: imUnary((_re, im) => im),
  IMABS: imUnary((re, im) => Math.hypot(re, im)),
  IMARGUMENT: imUnary((re, im) => Math.atan2(im, re)),
  IMCONJUGATE: imMap((re, im) => ({ re, im: -im })),
  IMSUM: imCombine((a, b) => ({ re: a.re + b.re, im: a.im + b.im })),
  IMSUB: imCombine((a, b) => ({ re: a.re - b.re, im: a.im - b.im })),
  IMPRODUCT: imCombine((a, b) => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re })),
  IMDIV: imCombine((a, b) => {
    const d = b.re * b.re + b.im * b.im;
    return d === 0 ? null : { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
  }),
  IMSQRT: imMap((re, im) => {
    const r = Math.hypot(re, im);
    const arg = Math.atan2(im, re) / 2;
    const sr = Math.sqrt(r);
    return { re: sr * Math.cos(arg), im: sr * Math.sin(arg) };
  }),
  IMEXP: imMap((re, im) => ({ re: Math.exp(re) * Math.cos(im), im: Math.exp(re) * Math.sin(im) })),
  IMLN: imMap((re, im) => ({ re: Math.log(Math.hypot(re, im)), im: Math.atan2(im, re) })),
  IMSIN: imMap((re, im) => ({ re: Math.sin(re) * Math.cosh(im), im: Math.cos(re) * Math.sinh(im) })),
  IMCOS: imMap((re, im) => ({ re: Math.cos(re) * Math.cosh(im), im: -Math.sin(re) * Math.sinh(im) })),
  IMTAN: imMap((a, b) => cdiv(cSin(a, b), cCos(a, b))),
  IMSEC: imMap((a, b) => cdiv(ONE, cCos(a, b))),
  IMCSC: imMap((a, b) => cdiv(ONE, cSin(a, b))),
  IMCOT: imMap((a, b) => cdiv(cCos(a, b), cSin(a, b))),
  IMSINH: imMap((a, b) => cSinh(a, b)),
  IMCOSH: imMap((a, b) => cCosh(a, b)),
  IMSECH: imMap((a, b) => cdiv(ONE, cCosh(a, b))),
  IMCSCH: imMap((a, b) => cdiv(ONE, cSinh(a, b))),
  IMLOG10: imMap((re, im) => ({ re: Math.log(Math.hypot(re, im)) / Math.LN10, im: Math.atan2(im, re) / Math.LN10 })),
  IMLOG2: imMap((re, im) => ({ re: Math.log(Math.hypot(re, im)) / Math.LN2, im: Math.atan2(im, re) / Math.LN2 })),
  IMPOWER,

  // slice 42g — lookup-pure + info-pure
  XLOOKUP,
  XMATCH,
  AREAS,
  LOOKUP,
  ADDRESS,
  HYPERLINK,
  ISODD,
  ISEVEN,
  ISLOGICAL: (args) => typeof scalarOf(argAt(args, 0)) === 'boolean',
  ISNONTEXT: (args) => typeof scalarOf(argAt(args, 0)) !== 'string',
  TYPE: TYPEFN,
  'ERROR.TYPE': ERRORTYPE,

  // slice 42c-2 — statistical distributions + inverses + variants
  'NORM.DIST': NORM_DIST,
  'NORM.INV': NORM_INV,
  'NORM.S.DIST': NORM_S_DIST,
  'NORM.S.INV': (args) => { const p = numAt(args, 0); return isError(p) ? p : numOrNum(normSInv(p)); },
  NORMDIST: NORM_DIST,
  NORMINV: NORM_INV,
  NORMSDIST: (args) => { const z = numAt(args, 0); return isError(z) ? z : normCdf(z); },
  NORMSINV: (args) => { const p = numAt(args, 0); return isError(p) ? p : numOrNum(normSInv(p)); },
  'LOGNORM.DIST': (args) => {
    const d = distArgs(args, 3);
    if (isError(d)) return d;
    const [x, m, s] = d.nums as [number, number, number];
    if (x <= 0 || s <= 0) return ERR.NUM;
    return d.cum ? normCdf((Math.log(x) - m) / s) : normPdf((Math.log(x) - m) / s) / (x * s);
  },
  'LOGNORM.INV': (args) => {
    const p = numAt(args, 0), m = numAt(args, 1), s = numAt(args, 2);
    for (const v of [p, m, s]) if (isError(v)) return v;
    return numOrNum(Math.exp((m as number) + (s as number) * normSInv(p as number)));
  },
  LOGNORMDIST: (args) => {
    const x = numAt(args, 0), m = numAt(args, 1), s = numAt(args, 2);
    for (const v of [x, m, s]) if (isError(v)) return v;
    return (x as number) <= 0 ? ERR.NUM : normCdf((Math.log(x as number) - (m as number)) / (s as number));
  },
  LOGINV: (args) => {
    const p = numAt(args, 0), m = numAt(args, 1), s = numAt(args, 2);
    for (const v of [p, m, s]) if (isError(v)) return v;
    return numOrNum(Math.exp((m as number) + (s as number) * normSInv(p as number)));
  },
  'EXPON.DIST': EXPON_DIST,
  EXPONDIST: EXPON_DIST,
  GAMMA: (args) => { const x = numAt(args, 0); if (isError(x)) return x; return x <= 0 ? ERR.NUM : numOrNum(Math.exp(gammaln(x))); },
  'GAMMA.DIST': GAMMA_DIST,
  GAMMADIST: GAMMA_DIST,
  'GAMMA.INV': (args) => {
    const p = numAt(args, 0), a = numAt(args, 1), b = numAt(args, 2);
    for (const v of [p, a, b]) if (isError(v)) return v;
    return numOrNum((b as number) * bisectInv((x) => gammaP(a as number, x), p as number, 0, 1e7));
  },
  GAMMAINV: (args) => {
    const p = numAt(args, 0), a = numAt(args, 1), b = numAt(args, 2);
    for (const v of [p, a, b]) if (isError(v)) return v;
    return numOrNum((b as number) * bisectInv((x) => gammaP(a as number, x), p as number, 0, 1e7));
  },
  'BETA.DIST': BETA_DIST,
  BETADIST: BETA_DIST,
  'BETA.INV': (args) => {
    const p = numAt(args, 0), a = numAt(args, 1), b = numAt(args, 2);
    for (const v of [p, a, b]) if (isError(v)) return v;
    const A = args.length > 3 ? numAt(args, 3) : 0;
    if (isError(A)) return A;
    const B = args.length > 4 ? numAt(args, 4) : 1;
    if (isError(B)) return B;
    return numOrNum(A + (B - A) * bisectInv((x) => betaReg(x, a as number, b as number), p as number, 0, 1));
  },
  BETAINV: (args) => {
    const p = numAt(args, 0), a = numAt(args, 1), b = numAt(args, 2);
    for (const v of [p, a, b]) if (isError(v)) return v;
    return numOrNum(bisectInv((x) => betaReg(x, a as number, b as number), p as number, 0, 1));
  },
  'POISSON.DIST': POISSON_DIST,
  POISSON: POISSON_DIST,
  'BINOM.DIST': BINOM_DIST,
  BINOMDIST: BINOM_DIST,
  'BINOM.INV': (args) => {
    const n = numAt(args, 0), p = numAt(args, 1), alpha = numAt(args, 2);
    for (const v of [n, p, alpha]) if (isError(v)) return v;
    const nn = Math.trunc(n as number);
    let cum = 0;
    for (let k = 0; k <= nn; k++) { cum += binomPmf(k, nn, p as number); if (cum >= (alpha as number)) return k; }
    return nn;
  },
  'NEGBINOM.DIST': (args) => {
    const d = distArgs(args, 3);
    if (isError(d)) return d;
    const [k, r, p] = d.nums as [number, number, number];
    const pmf = (kk: number): number => Math.exp(logCombin(kk + r - 1, kk) + r * Math.log(p) + kk * Math.log(1 - p));
    if (d.cum) { let s = 0; for (let i = 0; i <= Math.trunc(k); i++) s += pmf(i); return s; }
    return pmf(Math.trunc(k));
  },
  NEGBINOMDIST: (args) => {
    const k = numAt(args, 0), r = numAt(args, 1), p = numAt(args, 2);
    for (const v of [k, r, p]) if (isError(v)) return v;
    return Math.exp(logCombin((k as number) + (r as number) - 1, k as number) + (r as number) * Math.log(p as number) + (k as number) * Math.log(1 - (p as number)));
  },
  'HYPGEOM.DIST': (args) => {
    const cum = args.length > 4 ? toBoolean(scalarOf(argAt(args, 4))) : false;
    if (isError(cum)) return cum;
    const k = numAt(args, 0), n = numAt(args, 1), K = numAt(args, 2), N = numAt(args, 3);
    for (const v of [k, n, K, N]) if (isError(v)) return v;
    const pmf = (kk: number): number => Math.exp(logCombin(K as number, kk) + logCombin((N as number) - (K as number), (n as number) - kk) - logCombin(N as number, n as number));
    if (cum) { let s = 0; for (let i = 0; i <= Math.trunc(k as number); i++) s += pmf(i); return s; }
    return pmf(Math.trunc(k as number));
  },
  HYPGEOMDIST: (args) => {
    const k = numAt(args, 0), n = numAt(args, 1), K = numAt(args, 2), N = numAt(args, 3);
    for (const v of [k, n, K, N]) if (isError(v)) return v;
    return Math.exp(logCombin(K as number, k as number) + logCombin((N as number) - (K as number), (n as number) - (k as number)) - logCombin(N as number, n as number));
  },
  'WEIBULL.DIST': WEIBULL_DIST,
  WEIBULL: WEIBULL_DIST,
  'CHISQ.DIST': CHISQ_DIST,
  'CHISQ.DIST.RT': (args) => { const x = numAt(args, 0), df = numAt(args, 1); for (const v of [x, df]) if (isError(v)) return v; return 1 - gammaP((df as number) / 2, (x as number) / 2); },
  'CHISQ.INV': (args) => { const p = numAt(args, 0), df = numAt(args, 1); for (const v of [p, df]) if (isError(v)) return v; return numOrNum(2 * bisectInv((x) => gammaP((df as number) / 2, x), p as number, 0, 1e7)); },
  'CHISQ.INV.RT': (args) => { const p = numAt(args, 0), df = numAt(args, 1); for (const v of [p, df]) if (isError(v)) return v; return numOrNum(2 * bisectInv((x) => gammaP((df as number) / 2, x), 1 - (p as number), 0, 1e7)); },
  CHIDIST: (args) => { const x = numAt(args, 0), df = numAt(args, 1); for (const v of [x, df]) if (isError(v)) return v; return 1 - gammaP((df as number) / 2, (x as number) / 2); },
  CHIINV: (args) => { const p = numAt(args, 0), df = numAt(args, 1); for (const v of [p, df]) if (isError(v)) return v; return numOrNum(2 * bisectInv((x) => gammaP((df as number) / 2, x), 1 - (p as number), 0, 1e7)); },
  'T.DIST': T_DIST,
  'T.DIST.RT': (args) => { const t = numAt(args, 0), df = numAt(args, 1); for (const v of [t, df]) if (isError(v)) return v; return 1 - tCdf(t as number, df as number); },
  'T.DIST.2T': (args) => { const t = numAt(args, 0), df = numAt(args, 1); for (const v of [t, df]) if (isError(v)) return v; return 2 * (1 - tCdf(Math.abs(t as number), df as number)); },
  'T.INV': (args) => { const p = numAt(args, 0), df = numAt(args, 1); for (const v of [p, df]) if (isError(v)) return v; return numOrNum(bisectInv((t) => tCdf(t, df as number), p as number, -1e6, 1e6)); },
  'T.INV.2T': (args) => { const p = numAt(args, 0), df = numAt(args, 1); for (const v of [p, df]) if (isError(v)) return v; return numOrNum(bisectInv((t) => tCdf(t, df as number), 1 - (p as number) / 2, -1e6, 1e6)); },
  TDIST: (args) => { const x = numAt(args, 0), df = numAt(args, 1), tails = numAt(args, 2); for (const v of [x, df, tails]) if (isError(v)) return v; const rt = 1 - tCdf(x as number, df as number); return Math.trunc(tails as number) === 2 ? 2 * (1 - tCdf(Math.abs(x as number), df as number)) : rt; },
  TINV: (args) => { const p = numAt(args, 0), df = numAt(args, 1); for (const v of [p, df]) if (isError(v)) return v; return numOrNum(bisectInv((t) => tCdf(t, df as number), 1 - (p as number) / 2, -1e6, 1e6)); },
  'F.DIST': F_DIST,
  'F.DIST.RT': (args) => { const x = numAt(args, 0), d1 = numAt(args, 1), d2 = numAt(args, 2); for (const v of [x, d1, d2]) if (isError(v)) return v; return 1 - betaReg(((d1 as number) * (x as number)) / ((d1 as number) * (x as number) + (d2 as number)), (d1 as number) / 2, (d2 as number) / 2); },
  'F.INV': (args) => { const p = numAt(args, 0), d1 = numAt(args, 1), d2 = numAt(args, 2); for (const v of [p, d1, d2]) if (isError(v)) return v; return numOrNum(bisectInv((x) => betaReg(((d1 as number) * x) / ((d1 as number) * x + (d2 as number)), (d1 as number) / 2, (d2 as number) / 2), p as number, 0, 1e7)); },
  'F.INV.RT': (args) => { const p = numAt(args, 0), d1 = numAt(args, 1), d2 = numAt(args, 2); for (const v of [p, d1, d2]) if (isError(v)) return v; return numOrNum(bisectInv((x) => betaReg(((d1 as number) * x) / ((d1 as number) * x + (d2 as number)), (d1 as number) / 2, (d2 as number) / 2), 1 - (p as number), 0, 1e7)); },
  FDIST: (args) => { const x = numAt(args, 0), d1 = numAt(args, 1), d2 = numAt(args, 2); for (const v of [x, d1, d2]) if (isError(v)) return v; return 1 - betaReg(((d1 as number) * (x as number)) / ((d1 as number) * (x as number) + (d2 as number)), (d1 as number) / 2, (d2 as number) / 2); },
  FINV: (args) => { const p = numAt(args, 0), d1 = numAt(args, 1), d2 = numAt(args, 2); for (const v of [p, d1, d2]) if (isError(v)) return v; return numOrNum(bisectInv((x) => betaReg(((d1 as number) * x) / ((d1 as number) * x + (d2 as number)), (d1 as number) / 2, (d2 as number) / 2), 1 - (p as number), 0, 1e7)); },
  'CONFIDENCE.NORM': CONFIDENCE_NORM,
  'CONFIDENCE.T': CONFIDENCE_T,
  CONFIDENCE: CONFIDENCE_NORM,
  'Z.TEST': ZTEST,
  ZTEST,
  'T.TEST': TTEST,
  TTEST,
  'F.TEST': FTEST,
  FTEST,
  'CHISQ.TEST': CHITEST,
  CHITEST,
  'FORECAST.ETS': FORECAST_ETS,
  'FORECAST.ETS.SEASONALITY': FORECAST_ETS_SEASONALITY,
  'FORECAST.ETS.STAT': FORECAST_ETS_STAT,
  'FORECAST.ETS.CONFINT': FORECAST_ETS_CONFINT,
  GAUSS: (args) => { const z = numAt(args, 0); return isError(z) ? z : normCdf(z) - 0.5; },
  PHI: (args) => { const z = numAt(args, 0); return isError(z) ? z : normPdf(z); },
  FISHER: (args) => { const x = numAt(args, 0); if (isError(x)) return x; return Math.abs(x) >= 1 ? ERR.NUM : 0.5 * Math.log((1 + x) / (1 - x)); },
  FISHERINV: (args) => { const y = numAt(args, 0); return isError(y) ? y : Math.tanh(y); },

  // slice 43 — volatile (Math.random is allowed product code; see SEC-NO-EVAL scope)
  RAND: () => Math.random(),
  RANDBETWEEN: (args) => {
    const lo = numAt(args, 0);
    if (isError(lo)) return lo;
    const hi = numAt(args, 1);
    if (isError(hi)) return hi;
    const a = Math.ceil(lo);
    const b = Math.floor(hi);
    return a + Math.floor(Math.random() * (b - a + 1));
  },

  // logical
  IF,
  AND,
  OR,
  NOT,
  XOR,
  IFERROR,
  IFNA,
  IFS,
  SWITCH,
  TRUE: () => true,
  FALSE: () => false,

  // text
  CONCAT,
  CONCATENATE: CONCAT,
  TEXTJOIN,
  LEN,
  LEFT,
  RIGHT,
  MID,
  UPPER: textXform((s) => s.toUpperCase()),
  LOWER: textXform((s) => s.toLowerCase()),
  PROPER,
  TRIM: textXform((s) => s.replace(/\s+/g, ' ').trim()),
  TEXT: TEXTFN,
  VALUE: VALUEFN,
  FIND: FINDFN(true),
  SEARCH: FINDFN(false),
  REPLACE,
  SUBSTITUTE,
  REPT,
  EXACT,
  CHAR,
  CODE,

  // lookup / ref
  VLOOKUP,
  HLOOKUP,
  INDEX: INDEXFN,
  MATCH: MATCHFN,
  CHOOSE,
  ROW: ROWFN,
  COLUMN: COLUMNFN,
  ROWS: ROWSFN,
  COLUMNS: COLUMNSFN,
  // slice 44 — reference values (CAP-FORMULA-REFVAL)
  OFFSET,
  INDIRECT,
  ISFORMULA,
  FORMULATEXT,
  ISREF,
  CELL: CELLFN,

  // slice 42b-2 — bond / coupon / day-count
  DISC,
  PRICEDISC,
  YIELDDISC,
  INTRATE,
  RECEIVED,
  ACCRINTM,
  ACCRINT,
  PRICEMAT,
  YIELDMAT,
  ODDFPRICE,
  ODDFYIELD,
  ODDLPRICE,
  ODDLYIELD,
  TBILLPRICE,
  TBILLYIELD,
  TBILLEQ,
  COUPNUM,
  COUPPCD,
  COUPNCD,
  COUPDAYBS,
  COUPDAYSNC,
  COUPDAYS,
  PRICE,
  YIELD: YIELDFN,
  DURATION,
  MDURATION,
  VDB,
  AMORLINC,
  AMORDEGRC,

  // slice 45a — dynamic arrays / spill (CAP-FORMULA-ARRAY)
  SEQUENCE,
  RANDARRAY,
  TRANSPOSE,
  UNIQUE,
  FILTER,
  SORT,
  SORTBY,
  TEXTSPLIT,
  TOROW,
  TOCOL,
  TAKE,
  DROP,
  HSTACK,
  VSTACK,
  WRAPROWS: wrapFn(true),
  WRAPCOLS: wrapFn(false),
  CHOOSEROWS,
  CHOOSECOLS,
  EXPAND,
  MMULT,
  MINVERSE,
  MDETERM,
  MUNIT,
  LINEST: linestFn(false),
  LOGEST: linestFn(true),
  TREND: trendFn(false),
  GROWTH: trendFn(true),
  GROUPBY,
  PIVOTBY,
  FREQUENCY,

  // date
  TODAY,
  NOW: NOWFN,
  DATE: DATEFN,
  YEAR: datePart('y'),
  MONTH: datePart('m'),
  DAY: datePart('d'),

  // info
  ISNUMBER,
  ISTEXT,
  ISBLANK,
  ISERROR,
  ISERR,
  ISNA,
  N: NFN,
  NA: () => ERR.NA,
};

/** The set of supported function names (for tooling / diagnostics). */
export const FUNCTION_NAMES: readonly string[] = Object.keys(FUNCTIONS);

/**
 * `CAP-FORMULA-VOLATILE` — functions whose result can change without any
 * precedent changing, so a cell containing one must recompute on *every* recalc.
 * The engine seeds these into every incremental pass.
 */
export const VOLATILE_FUNCTIONS: ReadonlySet<string> = new Set([
  'RAND', 'RANDBETWEEN', 'RANDARRAY', 'NOW', 'TODAY', 'OFFSET', 'INDIRECT', 'INFO', 'CELL',
]);

/**
 * `CAP-FORMULA-REFVAL` — functions that receive their arguments as raw
 * `ReferenceValue`s (addresses) rather than dereferenced values, so they can
 * produce/inspect references. Every other function gets values/ranges.
 */
export const REF_AWARE_FUNCTIONS: ReadonlySet<string> = new Set([
  'OFFSET', 'INDIRECT', 'INDEX', 'ROW', 'COLUMN', 'ROWS', 'COLUMNS',
  'ISFORMULA', 'FORMULATEXT', 'ISREF', 'CELL', 'AREAS',
]);

// Reference `firstError` to keep it available for future strict-propagation paths.
void firstError;
