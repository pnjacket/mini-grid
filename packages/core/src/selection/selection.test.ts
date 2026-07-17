import { describe, expect, it } from 'vitest';

import {
  SelectionModel,
  EMPTY_SELECTION,
  normalizeRange,
  rangeContains,
  rangesOverlap,
  selectionInvariantHolds,
  selectionWellFormed,
} from './selection.js';

const resolveKey = (row: number): string => `k${row}`;
const resolveCol = (col: number): string | undefined =>
  ['a', 'b', 'c', 'd'][col];

describe('SelectionModel (ENTITY-SELECTION)', () => {
  it('starts empty; setActive selects a single cell + anchor', () => {
    const m = new SelectionModel();
    expect(m.isEmpty()).toBe(true);
    m.setActive(3, 2);
    expect(m.isEmpty()).toBe(false);
    expect(m.getActive()).toEqual({ row: 3, col: 2 });
    expect(m.getAnchor()).toEqual({ row: 3, col: 2 });
    expect(m.getRange()).toEqual({ top: 3, bottom: 3, left: 2, right: 2 });
  });

  it('extendTo keeps the anchor and grows a contiguous range', () => {
    const m = new SelectionModel();
    m.setActive(1, 1);
    m.extendTo(4, 1);
    expect(m.getAnchor()).toEqual({ row: 1, col: 1 });
    expect(m.getActive()).toEqual({ row: 4, col: 1 });
    expect(m.getRange()).toEqual({ top: 1, bottom: 4, left: 1, right: 1 });
  });

  it('collapse resets the range to the active cell; clear empties', () => {
    const m = new SelectionModel();
    m.setActive(2, 0);
    m.extendTo(5, 3);
    m.collapse();
    expect(m.getRange()).toEqual({ top: 5, bottom: 5, left: 3, right: 3 });
    m.clear();
    expect(m.isEmpty()).toBe(true);
    expect(m.getRange()).toBeNull();
  });

  it('toSelection projects activeCell by identity and preserves the range', () => {
    const m = new SelectionModel();
    m.setActive(1, 0);
    m.extendTo(3, 1);
    const sel = m.toSelection(resolveKey, resolveCol);
    expect(sel.activeCell).toEqual({ rowKey: 'k3', columnId: 'b' });
    expect(sel.anchor).toEqual({ row: 1, col: 0 });
    expect(sel.ranges).toEqual([{ top: 1, bottom: 3, left: 0, right: 1 }]);
  });

  it('fromSelection round-trips a range (anchor + opposite corner as active)', () => {
    const m = new SelectionModel();
    m.fromSelection({
      ranges: [{ top: 2, bottom: 5, left: 1, right: 3 }],
      activeCell: { rowKey: 'k5', columnId: 'c' },
      anchor: { row: 2, col: 1 },
    });
    expect(m.getRange()).toEqual({ top: 2, bottom: 5, left: 1, right: 3 });
    expect(m.getAnchor()).toEqual({ row: 2, col: 1 });
    expect(m.getActive()).toEqual({ row: 5, col: 3 });
  });

  it('helpers: normalizeRange normalizes corners; rangeContains is inclusive', () => {
    expect(normalizeRange({ row: 5, col: 4 }, { row: 2, col: 1 })).toEqual({
      top: 2,
      bottom: 5,
      left: 1,
      right: 4,
    });
    const r = { top: 1, bottom: 3, left: 1, right: 2 };
    expect(rangeContains(r, 1, 1)).toBe(true);
    expect(rangeContains(r, 3, 2)).toBe(true);
    expect(rangeContains(r, 0, 1)).toBe(false);
    expect(rangeContains(r, 2, 3)).toBe(false);
  });
});

describe('INV-SELECTION-ACTIVE', () => {
  it('empty selection ⇒ activeCell null; non-empty ⇒ exactly one active within a range', () => {
    const m = new SelectionModel();

    // Empty branch: no ranges, no activeCell, no anchor.
    const empty = m.toSelection(resolveKey, resolveCol);
    expect(empty).toEqual(EMPTY_SELECTION);
    expect(selectionInvariantHolds(empty, m.getActive())).toBe(true);

    // Single-cell selection.
    m.setActive(4, 2);
    let sel = m.toSelection(resolveKey, resolveCol);
    expect(sel.activeCell).not.toBeNull();
    expect(selectionInvariantHolds(sel, m.getActive())).toBe(true);

    // Extended range — the active corner stays inside the range.
    m.extendTo(7, 3);
    sel = m.toSelection(resolveKey, resolveCol);
    expect(sel.ranges).toHaveLength(1);
    expect(rangeContains(sel.ranges[0]!, 7, 3)).toBe(true); // active corner
    expect(selectionInvariantHolds(sel, m.getActive())).toBe(true);

    // Back to empty.
    m.clear();
    const cleared = m.toSelection(resolveKey, resolveCol);
    expect(cleared.activeCell).toBeNull();
    expect(cleared.ranges).toHaveLength(0);
    expect(selectionInvariantHolds(cleared, m.getActive())).toBe(true);
  });

  it('a malformed selection (ranges but null activeCell) fails the invariant check', () => {
    const bad = {
      ranges: [{ top: 0, bottom: 0, left: 0, right: 0 }],
      activeCell: null,
      anchor: { row: 0, col: 0 },
    };
    expect(selectionInvariantHolds(bad, { row: 0, col: 0 })).toBe(false);
  });

  it('keeps INV-SELECTION-ACTIVE across a multi-range set (active ∈ the active range)', () => {
    const m = new SelectionModel();
    m.setExtents(9, 3); // 4 cols (resolveCol supports a..d)
    m.setActive(0, 0);
    m.addRange({ top: 2, bottom: 3, left: 2, right: 3 }); // disjoint second range
    const sel = m.toSelection(resolveKey, resolveCol);
    expect(sel.ranges).toHaveLength(2);
    expect(sel.activeCell).not.toBeNull();
    // The active cell is the just-added range's corner and lies within a range.
    expect(selectionInvariantHolds(sel, m.getActive())).toBe(true);
  });
});

describe('INV-SELECTION-WELLFORMED (v1.3)', () => {
  it('addRange clamps an out-of-bounds range to the grid extents', () => {
    const m = new SelectionModel();
    m.setExtents(9, 4); // 10 rows × 5 cols
    m.setActive(0, 0);
    m.addRange({ top: -3, bottom: 99, left: 2, right: 88 });
    const sel = m.toSelection(resolveKey, resolveCol);
    expect(selectionWellFormed(sel, 9, 4)).toBe(true);
    // The active (added) range clamped into bounds.
    expect(sel.ranges[0]).toEqual({ top: 0, bottom: 9, left: 2, right: 4 });
  });

  it('two disjoint Ctrl+click ranges stay separate (2 ranges, disjoint)', () => {
    const m = new SelectionModel();
    m.setExtents(9, 9);
    m.setActive(0, 0);
    m.addRange({ top: 4, bottom: 4, left: 4, right: 4 });
    const sel = m.toSelection(resolveKey, resolveCol);
    expect(sel.ranges).toHaveLength(2);
    expect(rangesOverlap(sel.ranges[0]!, sel.ranges[1]!)).toBe(false);
    expect(selectionWellFormed(sel, 9, 9)).toBe(true);
  });

  it('overlapping ranges normalize (coalesce) — no double-counted cell', () => {
    const m = new SelectionModel();
    m.setExtents(9, 9);
    m.setActive(0, 0);
    m.extendTo(2, 2); // active range 0..2 × 0..2
    m.addRange({ top: 1, bottom: 3, left: 1, right: 3 }); // overlaps the prior range
    const sel = m.toSelection(resolveKey, resolveCol);
    // Coalesced into a single disjoint range (bounding box).
    expect(sel.ranges).toHaveLength(1);
    expect(sel.ranges[0]).toEqual({ top: 0, bottom: 3, left: 0, right: 3 });
    expect(selectionWellFormed(sel, 9, 9)).toBe(true);
  });

  it('rejects an add when there are no extents (empty grid)', () => {
    const m = new SelectionModel();
    m.setExtents(-1, -1); // no rows/cols
    m.selectRow(0); // no-op — line-select needs extents
    m.selectColumn(0);
    const sel = m.toSelection(resolveKey, resolveCol);
    expect(sel.ranges).toHaveLength(0);
  });
});

describe('INV-SELECTION-LINE (v1.3)', () => {
  it('selectRow materializes a full-width range + a row line entry', () => {
    const m = new SelectionModel();
    m.setExtents(9, 3); // 10 rows × 4 cols
    m.selectRow(2);
    const sel = m.toSelection(resolveKey, resolveCol);
    expect(sel.ranges[0]).toEqual({ top: 2, bottom: 2, left: 0, right: 3 }); // full width
    expect(sel.lines).toEqual([{ kind: 'row', index: 2 }]);
    expect(selectionWellFormed(sel, 9, 3)).toBe(true);
  });

  it('selectColumn materializes a full-height range + a column line entry', () => {
    const m = new SelectionModel();
    m.setExtents(9, 3);
    m.selectColumn(1);
    const sel = m.toSelection(resolveKey, resolveCol);
    expect(sel.ranges[0]).toEqual({ top: 0, bottom: 9, left: 1, right: 1 }); // full height
    expect(sel.lines).toEqual([{ kind: 'column', index: 1 }]);
  });

  it('a column line re-derives its span when the row extent grows (INV re-clamp)', () => {
    const m = new SelectionModel();
    m.setExtents(4, 3); // 5 rows
    m.selectColumn(1);
    expect(m.getActiveRange()).toEqual({ top: 0, bottom: 4, left: 1, right: 1 });
    // A row insert grows the extent; the materialized line range follows.
    m.applyRowShift((r) => r, 9); // now 10 rows
    expect(m.getActiveRange()).toEqual({ top: 0, bottom: 9, left: 1, right: 1 });
  });
});

describe('LIB-SELECTION additions (v1.3)', () => {
  it('selectAll selects the whole sheet as one range', () => {
    const m = new SelectionModel();
    m.setExtents(9, 3);
    m.selectAll();
    const sel = m.toSelection(resolveKey, resolveCol);
    expect(sel.ranges).toEqual([{ top: 0, bottom: 9, left: 0, right: 3 }]);
    expect(selectionInvariantHolds(sel, m.getActive())).toBe(true);
  });

  it('clearSelection (clear) empties the set', () => {
    const m = new SelectionModel();
    m.setExtents(9, 3);
    m.selectAll();
    m.clear();
    const sel = m.toSelection(resolveKey, resolveCol);
    expect(sel).toEqual(EMPTY_SELECTION);
  });

  it('selectColumns adds each as a disjoint line (first replaces, rest add)', () => {
    const m = new SelectionModel();
    m.setExtents(9, 5);
    m.selectColumns([0, 3]);
    const sel = m.toSelection(resolveKey, resolveCol);
    expect(sel.ranges).toHaveLength(2);
    expect(selectionWellFormed(sel, 9, 5)).toBe(true);
    expect(sel.lines?.length).toBe(2);
  });
});
