import { describe, expect, it } from 'vitest';

import {
  buildColumnFilter,
  buildFilterPredicate,
  operatorsForType,
  operatorArity,
} from './filter-menu.js';
import type { FilterContext } from '../types.js';

const ctx: FilterContext = { rowKey: 0, columnId: 'c', field: 'c', data: {} };
const keep = (
  pred: ReturnType<typeof buildFilterPredicate>,
  values: unknown[],
): unknown[] => values.filter((v) => pred!(v, ctx));

describe('buildFilterPredicate — type-aware built-in operators (CAP-FILTER)', () => {
  it('text operators subset rows (equals/notEquals/contains/startsWith/endsWith)', () => {
    const words = ['apple', 'apricot', 'banana', 'grape', ''];
    expect(keep(buildFilterPredicate('text', 'equals', 'apple'), words)).toEqual(['apple']);
    expect(keep(buildFilterPredicate('text', 'notEquals', 'apple'), words)).toEqual([
      'apricot',
      'banana',
      'grape',
      '',
    ]);
    expect(keep(buildFilterPredicate('text', 'contains', 'ap'), words)).toEqual([
      'apple',
      'apricot',
      'grape',
    ]);
    expect(keep(buildFilterPredicate('text', 'startsWith', 'ap'), words)).toEqual([
      'apple',
      'apricot',
    ]);
    expect(keep(buildFilterPredicate('text', 'endsWith', 'e'), words)).toEqual([
      'apple',
      'grape',
    ]);
  });

  it('blank / notBlank operators (0-arity, no value needed)', () => {
    const vals = ['x', '', null, 'y', undefined];
    expect(keep(buildFilterPredicate('text', 'blank', ''), vals)).toEqual(['', null, undefined]);
    expect(keep(buildFilterPredicate('text', 'notBlank', ''), vals)).toEqual(['x', 'y']);
  });

  it('the set/list operator (`in`, comma-separated) matches membership', () => {
    const vals = ['a', 'b', 'c', 'd'];
    expect(keep(buildFilterPredicate('text', 'in', 'a, c'), vals)).toEqual(['a', 'c']);
  });

  it('number operators subset rows (=, !=, >, <, between)', () => {
    const nums = [1, 2, 3, 4, 5];
    expect(keep(buildFilterPredicate('number', 'eq', '3'), nums)).toEqual([3]);
    expect(keep(buildFilterPredicate('number', 'neq', '3'), nums)).toEqual([1, 2, 4, 5]);
    expect(keep(buildFilterPredicate('number', 'gt', '3'), nums)).toEqual([4, 5]);
    expect(keep(buildFilterPredicate('number', 'lt', '3'), nums)).toEqual([1, 2]);
    expect(keep(buildFilterPredicate('number', 'between', '2', '4'), nums)).toEqual([2, 3, 4]);
  });

  it('date operators compare by timestamp (>, between)', () => {
    const dates = ['2020-01-01', '2021-06-15', '2022-12-31'];
    expect(keep(buildFilterPredicate('date', 'gt', '2021-01-01'), dates)).toEqual([
      '2021-06-15',
      '2022-12-31',
    ]);
    expect(
      keep(buildFilterPredicate('date', 'between', '2020-06-01', '2022-01-01'), dates),
    ).toEqual(['2021-06-15']);
  });

  it('AC-FILTER-EMPTY: an empty value builds NO predicate (returns null → column unfiltered)', () => {
    expect(buildFilterPredicate('text', 'contains', '')).toBeNull();
    expect(buildFilterPredicate('number', 'gt', '')).toBeNull();
    expect(buildFilterPredicate('number', 'between', '2', '')).toBeNull();
    expect(buildFilterPredicate('text', 'in', '')).toBeNull();
    // …but a 0-arity operator still builds one (blank/notBlank need no value).
    expect(buildFilterPredicate('text', 'blank', '')).not.toBeNull();
  });

  it('ADR-SORT-FILTER-SEAM: the menu EMITS serializable BuiltinFilter descriptors (no functions)', () => {
    // The value the menu hands to the grid is a plain descriptor, never a function,
    // so a fully-built-in filter crosses the worker seam and runs off-thread.
    const descriptors = [
      buildColumnFilter('text', 'contains', 'ap'),
      buildColumnFilter('number', 'gt', '500000'),
      buildColumnFilter('number', 'between', '2', '4'),
      buildColumnFilter('text', 'in', 'a, c'),
      buildColumnFilter('text', 'blank', ''),
    ];
    for (const d of descriptors) {
      expect(d).not.toBeNull();
      expect(typeof d).toBe('object');
      for (const v of Object.values(d!)) expect(typeof v).not.toBe('function');
      // JSON-round-trippable (serializable across `postMessage`).
      expect(JSON.parse(JSON.stringify(d))).toEqual(d);
    }
    // Empty value = no descriptor (column unfiltered).
    expect(buildColumnFilter('text', 'contains', '')).toBeNull();
  });

  it('operatorsForType offers the type-aware standard set + arity', () => {
    expect(operatorsForType('text').map((m) => m.op)).toContain('startsWith');
    expect(operatorsForType('number').map((m) => m.op)).toContain('between');
    expect(operatorsForType('date').map((m) => m.op)).toContain('lt');
    expect(operatorArity('between')).toBe(2);
    expect(operatorArity('blank')).toBe(0);
    expect(operatorArity('contains')).toBe(1);
  });
});
