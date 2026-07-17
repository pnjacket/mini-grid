import { describe, expect, it } from 'vitest';

import { HeightIndex } from './height-index.js';
import { Viewport } from './viewport.js';

describe('HeightIndex (variable-height prefix-sum / binary search)', () => {
  it('uses the estimated default until measured', () => {
    const hi = new HeightIndex(20);
    hi.setCount(5);
    expect(hi.totalHeight()).toBe(100);
    expect(hi.offsetOf(3)).toBe(60);
    expect(hi.height(2)).toBe(20);
  });

  it('reflects measured heights in offsets and totals', () => {
    const hi = new HeightIndex(20);
    hi.setCount(5);
    hi.setMeasured(1, 50); // row 1 taller
    hi.setMeasured(3, 44);
    // offsets: 0, 20, 70, 90, 134, 154
    expect(hi.offsetOf(0)).toBe(0);
    expect(hi.offsetOf(1)).toBe(20);
    expect(hi.offsetOf(2)).toBe(70);
    expect(hi.offsetOf(4)).toBe(134);
    expect(hi.totalHeight()).toBe(154);
  });

  it('indexAt is the inverse of offsetOf under variable heights', () => {
    const hi = new HeightIndex(20);
    hi.setCount(5);
    hi.setMeasured(1, 50);
    hi.setMeasured(3, 44);
    // Bands: [0,20) row0, [20,70) row1, [70,90) row2, [90,134) row3, [134,154) row4
    expect(hi.indexAt(0)).toBe(0);
    expect(hi.indexAt(19)).toBe(0);
    expect(hi.indexAt(20)).toBe(1);
    expect(hi.indexAt(69)).toBe(1);
    expect(hi.indexAt(70)).toBe(2);
    expect(hi.indexAt(133)).toBe(3);
    expect(hi.indexAt(134)).toBe(4);
    expect(hi.indexAt(9999)).toBe(4); // clamps to last row
  });

  it('round-trips offsetOf -> indexAt for every row on a large index', () => {
    const hi = new HeightIndex(28);
    hi.setCount(10_000);
    for (const i of [0, 1, 42, 999, 5000, 9999]) {
      hi.setMeasured(i, 10 + (i % 30));
    }
    for (const i of [0, 1, 42, 999, 5000, 9999]) {
      expect(hi.indexAt(hi.offsetOf(i))).toBe(i);
    }
  });

  it('preserves measured heights when the count grows', () => {
    const hi = new HeightIndex(20);
    hi.setCount(3);
    hi.setMeasured(1, 40);
    hi.setCount(5);
    expect(hi.isMeasured(1)).toBe(true);
    expect(hi.height(1)).toBe(40);
    expect(hi.totalHeight()).toBe(40 + 20 * 4);
  });
});

describe('Viewport windowing + overscan', () => {
  it('computes the visible row window with overscan and clamps to bounds', () => {
    const hi = new HeightIndex(20);
    hi.setCount(1000);
    const vp = new Viewport(hi, [100, 100, 100]);
    // scrollTop 400 -> row 20; viewportHeight 200 -> +10 rows -> row 30
    const win = vp.computeRowWindow(400, 200, 3, 1000);
    expect(win.firstRow).toBe(17); // 20 - 3
    expect(win.lastRow).toBe(33); // 30 + 3
  });

  it('clamps the window at the top and bottom edges', () => {
    const hi = new HeightIndex(20);
    hi.setCount(50);
    const vp = new Viewport(hi, [100]);
    const top = vp.computeRowWindow(0, 200, 5, 50);
    expect(top.firstRow).toBe(0);
    const bottom = vp.computeRowWindow(20 * 50, 200, 5, 50);
    expect(bottom.lastRow).toBe(49);
  });

  it('computes the visible column window from prefix widths', () => {
    const hi = new HeightIndex(20);
    hi.setCount(10);
    const vp = new Viewport(hi, [100, 100, 100, 100, 100]);
    // offsets: 0,100,200,300,400,500
    const win = vp.computeColWindow(150, 200, 0);
    expect(win.firstCol).toBe(1); // 150 falls in col 1
    expect(win.lastCol).toBe(3); // 350 falls in col 3
  });

  it('returns an empty window for zero rows', () => {
    const hi = new HeightIndex(20);
    hi.setCount(0);
    const vp = new Viewport(hi, [100]);
    expect(vp.computeRowWindow(0, 200, 3, 0)).toEqual({ firstRow: 0, lastRow: -1 });
  });
});
