import { describe, expect, it } from 'vitest';

import {
  hasCustomFilter,
  hasCustomSort,
  needsMainThread,
  toBuiltinFilter,
  toDeclarativeSort,
} from './view-plan.js';
import type { EngineColumn } from '../engine/index-engine.js';
import type { FilterSpec, SortSpec } from '../types.js';

const columns: EngineColumn[] = [
  { id: 'name', field: 'name', type: 'text' },
  { id: 'age', field: 'age', type: 'number', comparator: (a, b) => Number(a) - Number(b) },
];

describe('view-plan — seam routing (ADR-SORT-FILTER-SEAM)', () => {
  it('a fully-built-in sort/filter stays on the WORKER (no custom fn)', () => {
    const sort: SortSpec = { entries: [{ columnId: 'name', direction: 'asc' }] };
    const filter: FilterSpec = { perColumn: { name: { op: 'contains', value: 'a' } } };
    expect(hasCustomSort(sort, columns)).toBe(false);
    expect(hasCustomFilter(filter)).toBe(false);
    expect(needsMainThread(sort, filter, columns)).toBe(false);
  });

  it('a column-level comparator forces the sort MAIN-THREAD', () => {
    // Sorting the `age` column (which defines a comparator) → main thread.
    const sort: SortSpec = { entries: [{ columnId: 'age', direction: 'asc' }] };
    expect(hasCustomSort(sort, columns)).toBe(true);
    expect(needsMainThread(sort, { perColumn: {} }, columns)).toBe(true);
    // …but sorting a column WITHOUT a comparator stays declarative.
    expect(hasCustomSort({ entries: [{ columnId: 'name', direction: 'asc' }] }, columns)).toBe(
      false,
    );
  });

  it('a per-entry comparator forces the sort MAIN-THREAD', () => {
    const sort: SortSpec = {
      entries: [{ columnId: 'name', direction: 'asc', comparator: (a, b) => (a as number) - (b as number) }],
    };
    expect(hasCustomSort(sort, columns)).toBe(true);
  });

  it('a custom FilterPredicate function forces the filter MAIN-THREAD', () => {
    const filter: FilterSpec = { perColumn: { age: (v) => Number(v) > 30 } };
    expect(hasCustomFilter(filter)).toBe(true);
    expect(needsMainThread({ entries: [] }, filter, columns)).toBe(true);
  });

  it('toDeclarativeSort strips comparators to the serializable shape', () => {
    const sort: SortSpec = {
      entries: [
        { columnId: 'age', direction: 'desc', comparator: (a, b) => (a as number) - (b as number) },
        { columnId: 'name', direction: 'asc' },
      ],
    };
    expect(toDeclarativeSort(sort)).toEqual({
      entries: [
        { columnId: 'age', direction: 'desc' },
        { columnId: 'name', direction: 'asc' },
      ],
    });
  });

  it('toBuiltinFilter keeps only the serializable BuiltinFilter entries', () => {
    const filter: FilterSpec = {
      perColumn: {
        name: { op: 'contains', value: 'a' },
        age: (v) => Number(v) > 30,
      },
    };
    const stripped = toBuiltinFilter(filter);
    expect(Object.keys(stripped.perColumn)).toEqual(['name']);
    expect(JSON.parse(JSON.stringify(stripped))).toEqual(stripped); // serializable
  });
});
