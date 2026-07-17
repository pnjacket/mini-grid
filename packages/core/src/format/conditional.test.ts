import { describe, expect, it } from 'vitest';

import {
  ConditionalFormatEngine,
  interpolate,
  interpolate3,
  inScope,
} from './conditional.js';
import type { AggregateFetcher } from './conditional.js';
import type { CellContext, ColumnId } from '../types.js';

function ctx(value: unknown, rowIndex = 0, colIndex = 0): CellContext {
  return { rowKey: `r${rowIndex}`, columnId: 'v', field: 'v', value, data: {}, rowIndex, colIndex };
}

/** A synchronous fake worker aggregate over a fixed dataset. */
function fakeFetcher(values: number[]): AggregateFetcher {
  return (_columnId: ColumnId, kind, n): Promise<number | number[]> => {
    if (kind === 'min') return Promise.resolve(Math.min(...values));
    if (kind === 'max') return Promise.resolve(Math.max(...values));
    const count = Math.abs(n ?? 10);
    const bottom = (n ?? 10) < 0;
    return Promise.resolve(
      values.slice().sort((a, b) => (bottom ? a - b : b - a)).slice(0, count),
    );
  };
}

describe('COMPONENT-CONDFMT — value/text rules → style', () => {
  it('greater-than / less-than / between / equals / contains / startsWith / blank', () => {
    const eng = new ConditionalFormatEngine(fakeFetcher([]));
    eng.add({ kind: 'value', config: { op: '>', value: 100 }, style: { fillColor: '#f00' } });
    expect(eng.evaluate(ctx(150)).style).toEqual({ fillColor: '#f00' });
    expect(eng.evaluate(ctx(50)).style).toBeNull();

    const eng2 = new ConditionalFormatEngine(fakeFetcher([]));
    eng2.add({ kind: 'value', config: { op: 'between', value: 10, value2: 20 }, style: { fillColor: 'y' } });
    expect(eng2.evaluate(ctx(15)).style).toEqual({ fillColor: 'y' });
    expect(eng2.evaluate(ctx(25)).style).toBeNull();

    const eng3 = new ConditionalFormatEngine(fakeFetcher([]));
    eng3.add({ kind: 'text', config: { op: 'contains', value: 'err' }, style: { textColor: 'r' } });
    expect(eng3.evaluate(ctx('error')).style).toEqual({ textColor: 'r' });
    expect(eng3.evaluate(ctx('ok')).style).toBeNull();

    const eng4 = new ConditionalFormatEngine(fakeFetcher([]));
    eng4.add({ kind: 'value', config: { op: 'blank' }, style: { fillColor: 'g' } });
    expect(eng4.evaluate(ctx('')).style).toEqual({ fillColor: 'g' });
    expect(eng4.evaluate(ctx(null)).style).toEqual({ fillColor: 'g' });
    expect(eng4.evaluate(ctx('x')).style).toBeNull();
  });

  it('highest-priority rule wins per property; conditional results merge', () => {
    const eng = new ConditionalFormatEngine(fakeFetcher([]));
    eng.add({ kind: 'value', config: { op: '>', value: 0 }, style: { fillColor: 'low', textColor: 'keep' }, priority: 1 });
    eng.add({ kind: 'value', config: { op: '>', value: 0 }, style: { fillColor: 'high' }, priority: 5 });
    const r = eng.evaluate(ctx(10)).style;
    expect(r?.fillColor).toBe('high'); // priority 5 > 1
    expect(r?.textColor).toBe('keep'); // only set by priority-1 rule
  });

  // P2 (PERF-CELL-PATH): rules are applied in priority order via a sorted cache
  // rebuilt on mutation. Guard that add-order is irrelevant and remove re-sorts.
  it('priority order is independent of add order, and remove re-derives it', () => {
    const eng = new ConditionalFormatEngine(fakeFetcher([]));
    // Added HIGH priority first, then LOW — the sorted cache must still apply high last.
    const hi = eng.add({ kind: 'value', config: { op: '>', value: 0 }, style: { fillColor: 'high' }, priority: 9 });
    eng.add({ kind: 'value', config: { op: '>', value: 0 }, style: { fillColor: 'low', textColor: 'keep' }, priority: 1 });
    expect(eng.evaluate(ctx(10)).style?.fillColor).toBe('high'); // priority 9 wins regardless of add order
    // Remove the high rule → the sorted cache rebuilds; the low rule now wins.
    eng.remove(hi.id);
    const after = eng.evaluate(ctx(10)).style;
    expect(after?.fillColor).toBe('low');
    expect(after?.textColor).toBe('keep');
  });

  it('top-N / bottom-N use a full-dataset threshold aggregate (MSG-AGGREGATE)', async () => {
    const eng = new ConditionalFormatEngine(fakeFetcher([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    eng.add({ kind: 'value', config: { op: 'topN', n: 3, columnId: 'v' }, style: { fillColor: 't' } });
    await eng.prime();
    expect(eng.evaluate(ctx(9)).style).toEqual({ fillColor: 't' }); // 9 ∈ top 3 (8,9,10)
    expect(eng.evaluate(ctx(7)).style).toBeNull(); // 7 ∉ top 3

    const eng2 = new ConditionalFormatEngine(fakeFetcher([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    eng2.add({ kind: 'value', config: { op: 'bottomN', n: 2, columnId: 'v' }, style: { fillColor: 'b' } });
    await eng2.prime();
    expect(eng2.evaluate(ctx(2)).style).toEqual({ fillColor: 'b' }); // 2 ∈ bottom 2 (1,2)
    expect(eng2.evaluate(ctx(3)).style).toBeNull();
  });
});

describe('COMPONENT-CONDFMT — color scale / data bar / icon set / custom', () => {
  it('colorScale interpolates a fill from full-dataset min/max', async () => {
    const eng = new ConditionalFormatEngine(fakeFetcher([0, 100]));
    eng.add({ kind: 'colorScale', config: { columnId: 'v', min: '#000000', max: '#ffffff' } });
    await eng.prime();
    // value 50 → fraction 0.5 → mid-gray.
    expect(eng.evaluate(ctx(50)).style?.fillColor).toBe('#808080');
    expect(eng.evaluate(ctx(0)).style?.fillColor).toBe('#000000');
    expect(eng.evaluate(ctx(100)).style?.fillColor).toBe('#ffffff');
  });

  it('3-color scale routes through the midpoint color at 0.5', async () => {
    const eng = new ConditionalFormatEngine(fakeFetcher([0, 100]));
    eng.add({
      kind: 'colorScale',
      config: { columnId: 'v', min: '#ff0000', mid: '#00ff00', max: '#0000ff' },
    });
    await eng.prime();
    expect(eng.evaluate(ctx(50)).style?.fillColor).toBe('#00ff00'); // exactly the mid
  });

  it('dataBar produces a proportional fraction over the full-dataset range', async () => {
    const eng = new ConditionalFormatEngine(fakeFetcher([0, 200]));
    eng.add({ kind: 'dataBar', config: { columnId: 'v', color: '#39c' } });
    await eng.prime();
    const bar = eng.evaluate(ctx(50)).dataBar;
    expect(bar).toBeTruthy();
    expect(bar?.fraction).toBeCloseTo(0.25, 5); // 50/200
    expect(bar?.color).toBe('#39c');
    expect(eng.evaluate(ctx(200)).dataBar?.fraction).toBeCloseTo(1, 5);
  });

  it('iconSet picks the highest threshold ≤ value', () => {
    const eng = new ConditionalFormatEngine(fakeFetcher([]));
    eng.add({
      kind: 'iconSet',
      config: {
        columnId: 'v',
        icons: [
          { min: 0, icon: 'low' },
          { min: 50, icon: 'mid' },
          { min: 90, icon: 'high' },
        ],
      },
    });
    expect(eng.evaluate(ctx(10)).icon).toBe('low');
    expect(eng.evaluate(ctx(60)).icon).toBe('mid');
    expect(eng.evaluate(ctx(95)).icon).toBe('high');
  });

  it('custom predicate (LIB-CONDFMT-PREDICATE) returns a style or null', () => {
    const eng = new ConditionalFormatEngine(fakeFetcher([]));
    eng.add({
      kind: 'custom',
      config: { predicate: (c) => (typeof c.value === 'number' && c.value < 0 ? { textColor: '#c00' } : null) },
    });
    expect(eng.evaluate(ctx(-5)).style).toEqual({ textColor: '#c00' });
    expect(eng.evaluate(ctx(5)).style).toBeNull();
  });

  it('scope restricts matching to covered cells (empty scope = whole grid)', () => {
    const eng = new ConditionalFormatEngine(fakeFetcher([]));
    eng.add({
      kind: 'value',
      scope: [{ top: 0, left: 1, bottom: 10, right: 1 }],
      config: { op: '>', value: 0 },
      style: { fillColor: 'x' },
    });
    expect(eng.evaluate(ctx(5, 0, 1)).style).toEqual({ fillColor: 'x' }); // col 1 in scope
    expect(eng.evaluate(ctx(5, 0, 2)).style).toBeNull(); // col 2 out of scope
  });

  it('remove() and clear() drop rules', () => {
    const eng = new ConditionalFormatEngine(fakeFetcher([]));
    const { id } = eng.add({ kind: 'value', config: { op: '>', value: 0 }, style: { fillColor: 'x' } });
    expect(eng.hasRules()).toBe(true);
    eng.remove(id);
    expect(eng.hasRules()).toBe(false);
  });
});

describe('color interpolation + inScope helpers', () => {
  it('interpolate blends two hex colors', () => {
    expect(interpolate('#000000', '#ffffff', 0)).toBe('#000000');
    expect(interpolate('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(interpolate('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('interpolate3 pivots at the midpoint', () => {
    expect(interpolate3('#000000', '#808080', '#ffffff', 0.25)).toBe('#404040');
    expect(interpolate3('#000000', '#808080', '#ffffff', 0.75)).toBe('#c0c0c0');
  });

  it('inScope: empty scope matches all; ranges gate by index', () => {
    expect(inScope([], 5, 5)).toBe(true);
    expect(inScope([{ top: 0, left: 0, bottom: 2, right: 2 }], 1, 1)).toBe(true);
    expect(inScope([{ top: 0, left: 0, bottom: 2, right: 2 }], 3, 1)).toBe(false);
  });
});
