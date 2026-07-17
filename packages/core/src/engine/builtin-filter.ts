/**
 * `BuiltinFilter` compile + build — the **serializable** filter descriptor path
 * (`ADR-SORT-FILTER-SEAM`, `PATTERN-WORKER-PROTOCOL`).
 *
 * This module is DOM-free and function-free at the wire boundary: a
 * `BuiltinFilter` is a plain, JSON-round-trippable object that crosses the worker
 * seam. The engine calls `compileBuiltinFilter` **inside the worker** to turn a
 * descriptor into a `FilterPredicate`; the filter menu calls `buildBuiltinFilter`
 * on the main thread to emit a descriptor from `(type, operator, value[, value2])`.
 *
 * Comparison ops (`gt`/`lt`/`between`/`equals`/`notEquals`) carry a pre-coerced
 * comparable value (a number for number/date columns; a string for text). The
 * compile step re-derives a comparable from each row value with `asComparable`,
 * which handles numbers, `Date`s, and date-parseable strings uniformly — so a
 * numeric descriptor filters both number columns and date columns correctly
 * (dates were coerced to epoch-millis at build time).
 */
import type { BuiltinFilter, ColumnType, FilterPredicate } from '../types.js';

/** A per-column filter is a `BuiltinFilter` descriptor iff it is a non-null object. */
export function isBuiltinFilter(cf: unknown): cf is BuiltinFilter {
  return (
    typeof cf === 'object' &&
    cf !== null &&
    typeof (cf as { op?: unknown }).op === 'string'
  );
}

function isBlank(v: unknown): boolean {
  return v == null || v === '';
}

/** Comparable projection: numbers as-is, `Date`s/date-strings as epoch millis. */
function asComparable(v: unknown): number {
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  return Date.parse(String(v));
}

/**
 * Compile a serializable `BuiltinFilter` into a `FilterPredicate`. Runs on
 * whichever thread owns the engine (the worker for the off-thread path). The
 * behaviour matches the legacy per-operator predicates exactly (blank handling,
 * case-insensitive text, numeric/time comparison).
 */
export function compileBuiltinFilter(f: BuiltinFilter): FilterPredicate {
  switch (f.op) {
    case 'blank':
      return (v) => isBlank(v);
    case 'notBlank':
      return (v) => !isBlank(v);
    case 'equals': {
      if (typeof f.value === 'number') {
        const q = f.value;
        return (v) => !isBlank(v) && asComparable(v) === q;
      }
      const q = String(f.value).toLowerCase();
      return (v) => !isBlank(v) && String(v).toLowerCase() === q;
    }
    case 'notEquals': {
      if (typeof f.value === 'number') {
        const q = f.value;
        return (v) => !isBlank(v) && asComparable(v) !== q;
      }
      const q = String(f.value).toLowerCase();
      return (v) => isBlank(v) || String(v).toLowerCase() !== q;
    }
    case 'contains': {
      const q = String(f.value).toLowerCase();
      return (v) => !isBlank(v) && String(v).toLowerCase().includes(q);
    }
    case 'startsWith': {
      const q = String(f.value).toLowerCase();
      return (v) => !isBlank(v) && String(v).toLowerCase().startsWith(q);
    }
    case 'endsWith': {
      const q = String(f.value).toLowerCase();
      return (v) => !isBlank(v) && String(v).toLowerCase().endsWith(q);
    }
    case 'gt': {
      const q = Number(f.value);
      return (v) => {
        if (isBlank(v)) return false;
        const n = asComparable(v);
        return Number.isFinite(n) && n > q;
      };
    }
    case 'lt': {
      const q = Number(f.value);
      return (v) => {
        if (isBlank(v)) return false;
        const n = asComparable(v);
        return Number.isFinite(n) && n < q;
      };
    }
    case 'between': {
      const lo = Number(f.values?.[0]);
      const hi = Number(f.values?.[1]);
      const min = Math.min(lo, hi);
      const max = Math.max(lo, hi);
      return (v) => {
        if (isBlank(v)) return false;
        const n = asComparable(v);
        return Number.isFinite(n) && n >= min && n <= max;
      };
    }
    case 'in': {
      const set = new Set((f.values ?? []).map((s) => String(s).toLowerCase()));
      return (v) => !isBlank(v) && set.has(String(v).toLowerCase());
    }
    default:
      return () => true;
  }
}

/** The built-in filter operators offered by `LAYER-FILTER-MENU` (type-aware). */
export type FilterOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'eq'
  | 'neq'
  | 'gt'
  | 'lt'
  | 'between'
  | 'in'
  | 'blank'
  | 'notBlank';

function asTime(v: string): number {
  return Date.parse(v);
}

/**
 * Build a serializable `BuiltinFilter` for `(type, operator, value[, value2])`.
 * Returns `null` when the operator needs a value and none was given — i.e.
 * **empty value = no filter** (the caller drops that column's descriptor). The
 * type-aware coercion happens here (main thread, where the column `type` is
 * known) so the descriptor that crosses the seam is fully self-describing.
 */
export function buildBuiltinFilter(
  type: ColumnType | undefined,
  op: FilterOperator,
  value: string,
  value2 = '',
): BuiltinFilter | null {
  switch (op) {
    case 'blank':
      return { op: 'blank' };
    case 'notBlank':
      return { op: 'notBlank' };
    case 'equals':
      return value.trim() === '' ? null : { op: 'equals', value };
    case 'notEquals':
      return value.trim() === '' ? null : { op: 'notEquals', value };
    case 'contains':
      return value.trim() === '' ? null : { op: 'contains', value };
    case 'startsWith':
      return value.trim() === '' ? null : { op: 'startsWith', value };
    case 'endsWith':
      return value.trim() === '' ? null : { op: 'endsWith', value };
    case 'in': {
      const values = value
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '');
      return values.length === 0 ? null : { op: 'in', values };
    }
    case 'eq':
    case 'neq':
    case 'gt':
    case 'lt': {
      if (value.trim() === '') return null;
      const numeric = type !== 'date';
      const q = numeric ? Number(value) : asTime(value);
      if (!Number.isFinite(q)) return null;
      const mapped =
        op === 'eq' ? 'equals' : op === 'neq' ? 'notEquals' : op;
      return { op: mapped, value: q };
    }
    case 'between': {
      if (value.trim() === '' || value2.trim() === '') return null;
      const numeric = type !== 'date';
      const lo = numeric ? Number(value) : asTime(value);
      const hi = numeric ? Number(value2) : asTime(value2);
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
      return { op: 'between', values: [lo, hi] };
    }
    default:
      return null;
  }
}
