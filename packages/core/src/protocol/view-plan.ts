/**
 * View-op seam planner (`ADR-SORT-FILTER-SEAM`). Decides whether a sort/filter
 * runs OFF-THREAD in the worker (serializable spec) or on the MAIN THREAD
 * (because it carries a custom comparator/predicate function that can't cross
 * `postMessage`), and derives the serializable baselines that cross the seam.
 *
 * Pure + DOM-free so it is unit-testable in isolation and safe to import from the
 * data-client.
 */
import type { EngineColumn } from '../engine/index-engine.js';
import { isBuiltinFilter } from '../engine/builtin-filter.js';
import type { FilterSpec, SortSpec } from '../types.js';

/**
 * A sort carries a custom function iff any sorted entry has a per-entry
 * `comparator` OR its column defines a `comparator` (`LIB-COMPARATOR-API`).
 */
export function hasCustomSort(
  sort: SortSpec,
  columns: readonly EngineColumn[],
): boolean {
  if (sort.entries.length === 0) return false;
  const byId = new Map(columns.map((c) => [c.id, c] as const));
  return sort.entries.some(
    (e) => typeof e.comparator === 'function' || typeof byId.get(e.columnId)?.comparator === 'function',
  );
}

/** A filter carries a custom function iff any per-column entry is a function. */
export function hasCustomFilter(filter: FilterSpec): boolean {
  return Object.values(filter.perColumn).some((cf) => typeof cf === 'function');
}

/**
 * Does the EFFECTIVE view (sort ∪ filter) need the main thread? Any custom
 * function anywhere forces the whole thing main-thread (`ADR-SORT-FILTER-SEAM`).
 */
export function needsMainThread(
  sort: SortSpec,
  filter: FilterSpec,
  columns: readonly EngineColumn[],
): boolean {
  return hasCustomSort(sort, columns) || hasCustomFilter(filter);
}

/** Strip a `SortSpec` to its serializable `{ columnId, direction }` entries. */
export function toDeclarativeSort(sort: SortSpec): SortSpec {
  return {
    entries: sort.entries.map((e) => ({ columnId: e.columnId, direction: e.direction })),
  };
}

/** Keep only the serializable `BuiltinFilter` entries of a `FilterSpec`. */
export function toBuiltinFilter(filter: FilterSpec): FilterSpec {
  const perColumn: FilterSpec['perColumn'] = {};
  for (const [columnId, cf] of Object.entries(filter.perColumn)) {
    if (isBuiltinFilter(cf)) perColumn[columnId] = cf;
  }
  return { perColumn };
}
