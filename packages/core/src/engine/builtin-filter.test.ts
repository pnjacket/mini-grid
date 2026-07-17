import { describe, expect, it } from 'vitest';

import {
  buildBuiltinFilter,
  compileBuiltinFilter,
  isBuiltinFilter,
} from './builtin-filter.js';
import type { BuiltinFilter, FilterContext } from '../types.js';

const ctx: FilterContext = { rowKey: 0, columnId: 'c', field: 'c', data: {} };
const keep = (f: BuiltinFilter, values: unknown[]): unknown[] => {
  const pred = compileBuiltinFilter(f);
  return values.filter((v) => pred(v, ctx));
};

describe('BuiltinFilter — serializable descriptors (ADR-SORT-FILTER-SEAM)', () => {
  it('buildBuiltinFilter emits PLAIN, JSON-round-trippable descriptors (no functions)', () => {
    const cases: BuiltinFilter[] = [
      buildBuiltinFilter('text', 'contains', 'ap')!,
      buildBuiltinFilter('text', 'in', 'a, c')!,
      buildBuiltinFilter('number', 'gt', '500000')!,
      buildBuiltinFilter('number', 'between', '2', '4')!,
      buildBuiltinFilter('date', 'gt', '2021-01-01')!,
      buildBuiltinFilter('text', 'blank', '')!,
    ];
    for (const f of cases) {
      // No value is a function anywhere in the descriptor.
      for (const v of Object.values(f)) {
        expect(typeof v).not.toBe('function');
      }
      // Fully serializable: JSON round-trip is lossless.
      expect(JSON.parse(JSON.stringify(f))).toEqual(f);
      expect(isBuiltinFilter(f)).toBe(true);
    }
    // A function predicate is NOT a BuiltinFilter.
    expect(isBuiltinFilter(() => true)).toBe(false);
    expect(isBuiltinFilter(null)).toBe(false);
  });

  it('the engine can compile a descriptor back to the SAME filtering as before', () => {
    const words = ['apple', 'apricot', 'banana', 'grape', ''];
    expect(keep(buildBuiltinFilter('text', 'equals', 'apple')!, words)).toEqual(['apple']);
    expect(keep(buildBuiltinFilter('text', 'notEquals', 'apple')!, words)).toEqual([
      'apricot',
      'banana',
      'grape',
      '',
    ]);
    expect(keep(buildBuiltinFilter('text', 'contains', 'ap')!, words)).toEqual([
      'apple',
      'apricot',
      'grape',
    ]);
    expect(keep(buildBuiltinFilter('text', 'startsWith', 'ap')!, words)).toEqual([
      'apple',
      'apricot',
    ]);
    expect(keep(buildBuiltinFilter('text', 'endsWith', 'e')!, words)).toEqual(['apple', 'grape']);
  });

  it('blank / notBlank need no value; in matches membership', () => {
    const vals = ['x', '', null, 'y', undefined];
    expect(keep(buildBuiltinFilter('text', 'blank', '')!, vals)).toEqual(['', null, undefined]);
    expect(keep(buildBuiltinFilter('text', 'notBlank', '')!, vals)).toEqual(['x', 'y']);
    expect(keep(buildBuiltinFilter('text', 'in', 'a, c')!, ['a', 'b', 'c', 'd'])).toEqual([
      'a',
      'c',
    ]);
  });

  it('number ops compare numerically (eq/neq→equals/notEquals, gt/lt/between)', () => {
    const nums = [1, 2, 3, 4, 5];
    expect(keep(buildBuiltinFilter('number', 'eq', '3')!, nums)).toEqual([3]);
    expect(keep(buildBuiltinFilter('number', 'neq', '3')!, nums)).toEqual([1, 2, 4, 5]);
    expect(keep(buildBuiltinFilter('number', 'gt', '3')!, nums)).toEqual([4, 5]);
    expect(keep(buildBuiltinFilter('number', 'lt', '3')!, nums)).toEqual([1, 2]);
    expect(keep(buildBuiltinFilter('number', 'between', '2', '4')!, nums)).toEqual([2, 3, 4]);
    // eq/neq map to the serializable `equals`/`notEquals` ops with a numeric value.
    expect(buildBuiltinFilter('number', 'eq', '3')).toEqual({ op: 'equals', value: 3 });
    expect(buildBuiltinFilter('number', 'gt', '3')).toEqual({ op: 'gt', value: 3 });
  });

  it('date ops compare by timestamp (values coerced to epoch-millis at build time)', () => {
    const dates = ['2020-01-01', '2021-06-15', '2022-12-31'];
    expect(keep(buildBuiltinFilter('date', 'gt', '2021-01-01')!, dates)).toEqual([
      '2021-06-15',
      '2022-12-31',
    ]);
    expect(
      keep(buildBuiltinFilter('date', 'between', '2020-06-01', '2022-01-01')!, dates),
    ).toEqual(['2021-06-15']);
  });

  it('AC-FILTER-EMPTY: an empty value builds NO descriptor (null → column unfiltered)', () => {
    expect(buildBuiltinFilter('text', 'contains', '')).toBeNull();
    expect(buildBuiltinFilter('number', 'gt', '')).toBeNull();
    expect(buildBuiltinFilter('number', 'between', '2', '')).toBeNull();
    expect(buildBuiltinFilter('text', 'in', '')).toBeNull();
    // …but a 0-arity operator still builds one (blank/notBlank need no value).
    expect(buildBuiltinFilter('text', 'blank', '')).not.toBeNull();
  });
});
