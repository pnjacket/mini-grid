import { describe, expect, it } from 'vitest';

import { StyleCascade, mergeStyle } from './style-cascade.js';
import type { CellContext, CellStyle } from '../types.js';

function ctx(
  rowKey: string,
  columnId: string,
  value: unknown,
  rowIndex = 0,
  colIndex = 0,
): CellContext {
  return { rowKey, columnId, field: columnId, value, data: {}, rowIndex, colIndex };
}

describe('PATTERN-STYLE-CASCADE — column default < cell overlay < conditional', () => {
  it('resolves per property with conditional winning (Domain DD#6)', () => {
    const columnDefaults: Record<string, CellStyle> = {
      c: { textColor: 'blue', fillColor: 'white', fontWeight: 'bold' },
    };
    const cascade = new StyleCascade({
      columnDefaultStyle: (id) => columnDefaults[id],
      // Conditional sets fillColor red (wins over the overlay's yellow) but
      // leaves textColor/fontWeight to the lower layers.
      evaluateConditional: () => ({ style: { fillColor: 'red' } }),
    });
    // Cell overlay: fillColor yellow, italic true.
    cascade.mergeStyle('r1', 'c', { fillColor: 'yellow', italic: true });

    const resolved = cascade.resolve(ctx('r1', 'c', 5));
    expect(resolved.style.textColor).toBe('blue'); // from column default
    expect(resolved.style.fontWeight).toBe('bold'); // from column default
    expect(resolved.style.italic).toBe(true); // from cell overlay
    expect(resolved.style.fillColor).toBe('red'); // conditional wins over overlay
  });

  it('cell overlay overrides the column default per property', () => {
    const cascade = new StyleCascade({
      columnDefaultStyle: () => ({ textColor: 'black', fontSize: 12 }),
    });
    cascade.mergeStyle('r1', 'c', { textColor: 'green' });
    const r = cascade.resolve(ctx('r1', 'c', 1));
    expect(r.style.textColor).toBe('green'); // overlay wins over default
    expect(r.style.fontSize).toBe(12); // default survives
  });

  it('memoizes per cell and recomputes when the value changes or on invalidate', () => {
    let calls = 0;
    const cascade = new StyleCascade({
      columnDefaultStyle: () => {
        calls++;
        return { textColor: 'black' };
      },
    });
    cascade.resolve(ctx('r1', 'c', 1));
    cascade.resolve(ctx('r1', 'c', 1)); // memo hit — no recompute
    expect(calls).toBe(1);
    cascade.resolve(ctx('r1', 'c', 2)); // value changed — recompute
    expect(calls).toBe(2);
    cascade.invalidate();
    cascade.resolve(ctx('r1', 'c', 2)); // generation bumped — recompute
    expect(calls).toBe(3);
  });

  it('overlay is sparse + keyed by (rowKey, columnId); setOverlay restores/undoes', () => {
    const cascade = new StyleCascade({ columnDefaultStyle: () => undefined });
    expect(cascade.getOverlay('r1', 'c')).toBeUndefined();

    // Snapshot prior (undefined), apply, then restore (undo).
    const prev = cascade.getOverlay('r1', 'c');
    cascade.mergeStyle('r1', 'c', { fillColor: '#abc' });
    expect(cascade.getOverlay('r1', 'c')).toEqual({ fillColor: '#abc' });
    expect(cascade.resolve(ctx('r1', 'c', 1)).style.fillColor).toBe('#abc');

    cascade.setOverlay('r1', 'c', prev); // undo → back to no overlay
    expect(cascade.getOverlay('r1', 'c')).toBeUndefined();
    expect(cascade.resolve(ctx('r1', 'c', 1)).style.fillColor).toBeUndefined();
  });
});

describe('mergeStyle — per-property merge (nested borders/align)', () => {
  it('merges nested border sides rather than replacing the whole object', () => {
    const base: CellStyle = {
      borders: { top: { style: 'thin', color: '#000' } },
      align: { h: 'start' },
    };
    const over: CellStyle = {
      borders: { bottom: { style: 'thick', color: '#f00' } },
      align: { v: 'middle' },
    };
    const out = mergeStyle(base, over);
    expect(out.borders?.top).toEqual({ style: 'thin', color: '#000' });
    expect(out.borders?.bottom).toEqual({ style: 'thick', color: '#f00' });
    expect(out.align).toEqual({ h: 'start', v: 'middle' });
  });

  it('ignores undefined props of the overlay', () => {
    const out = mergeStyle({ textColor: 'blue' }, { textColor: undefined, fillColor: 'red' });
    expect(out.textColor).toBe('blue');
    expect(out.fillColor).toBe('red');
  });
});
