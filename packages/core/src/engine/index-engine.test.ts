import { describe, expect, it } from 'vitest';

import { IndexEngine } from './index-engine.js';
import type { EngineColumn } from './index-engine.js';
import type { FilterSpec } from '../types.js';

const columns: EngineColumn[] = [
  { id: 'name', field: 'name', type: 'text' },
  { id: 'age', field: 'age', type: 'number' },
];

function makeEngine(rows: Array<Record<string, unknown>>, keyField = 'id') {
  const engine = new IndexEngine();
  engine.load(rows, { keyField, columns });
  return engine;
}

const people = [
  { id: 'a', name: 'Charlie', age: 30 },
  { id: 'b', name: 'Alice', age: 25 },
  { id: 'c', name: 'Bob', age: 40 },
];

describe('IndexEngine', () => {
  it('loads rows and reports counts', () => {
    const engine = makeEngine(people);
    expect(engine.getCounts()).toEqual({ rowCount: 3, totalRowCount: 3 });
    const win = engine.getWindow(0, 3);
    expect(win.rows.map((r) => r.key)).toEqual(['a', 'b', 'c']);
  });

  it('uses the positional index as key when keyField is null', () => {
    const engine = new IndexEngine();
    engine.load(people, { keyField: null, columns });
    expect(engine.getWindow(0, 3).rows.map((r) => r.key)).toEqual([0, 1, 2]);
  });

  it('sorts ascending and descending by a column', () => {
    const engine = makeEngine(people);
    engine.setSort({ entries: [{ columnId: 'age', direction: 'asc' }] });
    expect(engine.getWindow(0, 3).rows.map((r) => r.data.age)).toEqual([25, 30, 40]);

    engine.setSort({ entries: [{ columnId: 'age', direction: 'desc' }] });
    expect(engine.getWindow(0, 3).rows.map((r) => r.data.age)).toEqual([40, 30, 25]);
  });

  it('sorts with a custom comparator', () => {
    const engine = new IndexEngine();
    // Comparator sorts by name length, then default.
    engine.load(people, {
      keyField: 'id',
      columns: [
        { id: 'name', field: 'name', comparator: (a, b) => String(a).length - String(b).length },
      ],
    });
    engine.setSort({ entries: [{ columnId: 'name', direction: 'asc' }] });
    expect(engine.getWindow(0, 3).rows.map((r) => r.data.name)).toEqual([
      'Bob',
      'Alice',
      'Charlie',
    ]);
  });

  it('filters with a predicate; empty filter = all rows', () => {
    const engine = makeEngine(people);
    const spec: FilterSpec = {
      perColumn: { age: (value) => typeof value === 'number' && value >= 30 },
    };
    engine.setFilter(spec);
    expect(engine.getCounts()).toEqual({ rowCount: 2, totalRowCount: 3 });
    expect(engine.getWindow(0, 10).rows.map((r) => r.key)).toEqual(['a', 'c']);

    engine.setFilter({ perColumn: {} });
    expect(engine.getCounts().rowCount).toBe(3);
  });

  it('ADR-SORT-FILTER-SEAM: the engine compiles a serializable BuiltinFilter descriptor', () => {
    const engine = makeEngine(people);
    // A plain, JSON-round-trippable descriptor (no function) — the shape that
    // crosses the worker seam. The engine compiles it internally.
    const spec: FilterSpec = { perColumn: { age: { op: 'gt', value: 28 } } };
    expect(JSON.parse(JSON.stringify(spec))).toEqual(spec);
    engine.setFilter(spec);
    expect(engine.getWindow(0, 10).rows.map((r) => r.key)).toEqual(['a', 'c']);
  });

  it('sorts with a per-entry comparator (SortSpec.entries[].comparator)', () => {
    const engine = makeEngine(people);
    // Sort by name LENGTH via a per-entry comparator (no column comparator).
    engine.setSort({
      entries: [
        {
          columnId: 'name',
          direction: 'asc',
          comparator: (a, b) => String(a).length - String(b).length,
        },
      ],
    });
    expect(engine.getWindow(0, 3).rows.map((r) => r.data.name)).toEqual([
      'Bob',
      'Alice',
      'Charlie',
    ]);
  });

  it('exportRows returns every canonical row in natural order (seam custom-fn path)', () => {
    const engine = makeEngine(people);
    engine.setSort({ entries: [{ columnId: 'age', direction: 'desc' }] });
    // exportRows ignores the active sort/filter — canonical (load) order.
    expect(engine.exportRows().map((r) => r.key)).toEqual(['a', 'b', 'c']);
  });

  it('setExplicitIndex installs a main-thread-computed order (MSG-SET-INDEX)', () => {
    const engine = makeEngine(people);
    // Install an explicit filtered+ordered view by key (as the main thread would).
    engine.setExplicitIndex(['c', 'a'], { entries: [] }, { perColumn: {} });
    expect(engine.getCounts()).toEqual({ rowCount: 2, totalRowCount: 3 });
    expect(engine.getWindow(0, 10).rows.map((r) => r.key)).toEqual(['c', 'a']);
  });

  it('windows by ordered index and clamps out-of-range requests', () => {
    const engine = makeEngine(people);
    expect(engine.getWindow(1, 2).rows.map((r) => r.key)).toEqual(['b']);
    const clamped = engine.getWindow(2, 999);
    expect(clamped.startIndex).toBe(2);
    expect(clamped.rows.map((r) => r.key)).toEqual(['c']);
    expect(engine.getWindow(999, 1000).rows).toEqual([]);
  });

  it('bumps the monotonic version on load and each mutation', () => {
    const engine = makeEngine(people);
    const afterLoad = engine.version;
    engine.setSort({ entries: [{ columnId: 'age', direction: 'asc' }] });
    engine.setFilter({ perColumn: {} });
    expect(engine.version).toBeGreaterThan(afterLoad);
  });

  it('INV-CELL-DERIVED: cell value derives from row data after an edit', () => {
    const engine = makeEngine(people);
    const result = engine.applyEdit('b', 'age', 99);
    expect(result).toMatchObject({ rowKey: 'b', field: 'age', oldValue: 25, newValue: 99 });
    // The window projects the value straight from row.data (no dense cell store).
    const row = engine.getWindow(0, 3).rows.find((r) => r.key === 'b');
    expect(row?.data.age).toBe(99);
  });

  it('insertRows inserts a keyed block at an ordered index + bumps version', () => {
    const engine = makeEngine(people);
    const v0 = engine.version;
    const res = engine.insertRows(1, [{ key: 'x', data: { id: 'x', name: 'Xander', age: 1 } }]);
    expect(res.atIndex).toBe(1);
    expect(res.counts).toEqual({ rowCount: 4, totalRowCount: 4 });
    expect(engine.getWindow(0, 4).rows.map((r) => r.key)).toEqual(['a', 'x', 'b', 'c']);
    expect(engine.version).toBeGreaterThan(v0);
  });

  it('insertRows rejects a duplicate key (INV-ROWKEY-UNIQUE)', () => {
    const engine = makeEngine(people);
    expect(() => engine.insertRows(0, [{ key: 'a', data: { id: 'a' } }])).toThrowError(
      /Duplicate row key/,
    );
  });

  it('removeRows returns removed rows with pre-removal ordered index (undo restore)', () => {
    const engine = makeEngine(people);
    const res = engine.removeRows(['a', 'c']);
    expect(res.removed.map((e) => [e.index, e.row.key])).toEqual([
      [0, 'a'],
      [2, 'c'],
    ]);
    expect(res.counts.rowCount).toBe(1);
    expect(engine.getWindow(0, 3).rows.map((r) => r.key)).toEqual(['b']);
  });

  it('insertColumn writes a blank field to every row; removeColumn deletes it back', () => {
    const engine = makeEngine(people);
    engine.insertColumn({ id: 'notes', field: 'notes', type: 'text' });
    for (const row of engine.getWindow(0, 3).rows) {
      expect(Object.prototype.hasOwnProperty.call(row.data, 'notes')).toBe(true);
      expect(row.data.notes).toBeNull();
    }
    const res = engine.removeColumn('name', 'name');
    expect(res.removedField).toBe('name');
    expect(res.values.map((v) => v.value)).toEqual(['Charlie', 'Alice', 'Bob']);
    for (const row of engine.getWindow(0, 3).rows) {
      expect(Object.prototype.hasOwnProperty.call(row.data, 'name')).toBe(false);
    }
  });
});

// P11 (SCALE-AGG-TOPN): the bounded top-N selection must match a full sort+slice.
describe('IndexEngine.aggregate (SCALE-AGG-TOPN)', () => {
  const nums = (vals: number[]) =>
    makeEngine(vals.map((v, i) => ({ id: `r${i}`, name: `n${i}`, age: v })));

  it('min / max over a numeric column', () => {
    const e = nums([30, 25, 40, 5, 18]);
    expect(e.aggregate('age', 'min')).toBe(5);
    expect(e.aggregate('age', 'max')).toBe(40);
  });

  it('topN returns the n largest DESCENDING; bottomN the |n| smallest ASCENDING', () => {
    const e = nums([30, 25, 40, 5, 18, 33]);
    expect(e.aggregate('age', 'topN', 3)).toEqual([40, 33, 30]);
    expect(e.aggregate('age', 'topN', -3)).toEqual([5, 18, 25]); // bottom 3 ascending
  });

  it('matches a full sort+slice, including ties at the cutoff', () => {
    const vals = [5, 5, 4, 5, 9, 1, 9, 7, 5, 2];
    const e = nums(vals);
    for (const k of [1, 2, 4, 7]) {
      const top = [...vals].sort((a, b) => b - a).slice(0, k);
      const bot = [...vals].sort((a, b) => a - b).slice(0, k);
      expect(e.aggregate('age', 'topN', k)).toEqual(top);
      expect(e.aggregate('age', 'topN', -k)).toEqual(bot);
    }
  });

  it('count ≥ dataset returns all values sorted; empty → NaN / []', () => {
    const e = nums([3, 1, 2]);
    expect(e.aggregate('age', 'topN', 10)).toEqual([3, 2, 1]);
    const empty = nums([]);
    expect(Number.isNaN(empty.aggregate('age', 'min') as number)).toBe(true);
    expect(empty.aggregate('age', 'topN', 5)).toEqual([]);
  });
});

describe('IndexEngine formula locale (COMPONENT-I18N)', () => {
  const fcols: EngineColumn[] = [
    { id: 'amount', field: 'amount', type: 'number' },
    { id: 'formatted', field: 'formatted', type: 'text' },
  ];
  it('FIXED formats under the loaded locale, then follows setFormulaLocale + recalc', () => {
    const engine = new IndexEngine();
    engine.load([{ id: 'r1', amount: 1234.5, formatted: '=FIXED(1234.5,2)' }], {
      keyField: 'id',
      columns: fcols,
      formula: true,
      locale: 'de-DE',
    });
    expect(engine.getWindow(0, 1).rows[0]!.data.formatted).toBe('1.234,50'); // de-DE separators
    engine.setFormulaLocale('en-US');
    engine.recalcAllFormulas();
    expect(engine.getWindow(0, 1).rows[0]!.data.formatted).toBe('1,234.50'); // en-US
  });
});

describe('IndexEngine formula reference rewriting (INV-FORMULA-REBUILD)', () => {
  const fcols: EngineColumn[] = [
    { id: 'v', field: 'v', type: 'number' },
    { id: 'f', field: 'f', type: 'text' },
  ];
  it('insertRows shifts a formula that references a shifted row', () => {
    const engine = new IndexEngine();
    engine.load(
      [
        { id: 'r0', v: 10, f: null },
        { id: 'r1', v: 20, f: '=A1*2' }, // references A1 (row0, v=10) → 20
      ],
      { keyField: 'id', columns: fcols, formula: true },
    );
    expect(engine.getFormulaSource('r1', 'f')).toBe('=A1*2');
    engine.insertRows(0, [{ key: 'rx', data: { v: 99, f: null } }]);
    // A1's data moved down to row 2 → the formula rewrites to =A2*2 and still yields 20.
    expect(engine.getFormulaSource('r1', 'f')).toBe('=A2*2');
    const r1 = engine.getWindow(0, 3).rows.find((r) => r.key === 'r1');
    expect(r1!.data.f).toBe(20);
  });

  it('removeRows #REF!s a deleted reference and shifts the rest', () => {
    const engine = new IndexEngine();
    engine.load(
      [
        { id: 'r0', v: 10, f: null },
        { id: 'r1', v: 20, f: null },
        { id: 'r2', v: 0, f: '=A1+A2' }, // 10 + 20 = 30
      ],
      { keyField: 'id', columns: fcols, formula: true },
    );
    const before = engine.getWindow(0, 3).rows.find((r) => r.key === 'r2');
    expect(before!.data.f).toBe(30);
    engine.removeRows(['r0']); // A1 deleted → #REF!; A2 (row1) → A1
    expect(engine.getFormulaSource('r2', 'f')).toBe('=#REF!+A1');
    const r2 = engine.getWindow(0, 2).rows.find((r) => r.key === 'r2');
    expect(r2!.data.f).toBe('#REF!'); // error propagates
  });
});
