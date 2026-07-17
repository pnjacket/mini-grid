/**
 * Slice 6b — pure-model unit tests for `MergeModel` (`ENTITY-MERGE-REGION`,
 * `INV-MERGE-NONOVERLAP`, `INV-MERGE-MIN2`) and `GroupModel`
 * (`ENTITY-GROUP-NODE`, `INV-GROUP-NEST`) — DOM-free, so the invariants are
 * checked in isolation against the runnable predicates.
 */
import { describe, expect, it } from 'vitest';

import { GridError } from '../errors.js';
import { MergeModel, mergeInvariantHolds } from './merge.js';
import { GroupModel, groupInvariantHolds } from './group.js';
import type { Range } from '../types.js';

const R = (top: number, left: number, bottom: number, right: number): Range => ({
  top,
  left,
  bottom,
  right,
});

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof GridError ? e.code : `not-grid:${String(e)}`;
  }
  return undefined;
}

describe('MergeModel — INV-MERGE-NONOVERLAP / INV-MERGE-MIN2', () => {
  it('add creates a region with anchor = top-left; ≥2 cells required', () => {
    const m = new MergeModel();
    const region = m.add(R(0, 0, 2, 0)); // A1:A3
    expect(region.anchor).toEqual({ row: 0, col: 0 });
    expect(m.isCovered(1, 0)).toBe(true);
    expect(m.isCovered(0, 0)).toBe(false); // the anchor is not covered
    expect(mergeInvariantHolds(m.list())).toBe(true);
  });

  it('a single-cell merge is rejected (INV-MERGE-MIN2 → MERGE_OVERLAP)', () => {
    const m = new MergeModel();
    expect(code(() => m.add(R(1, 1, 1, 1)))).toBe('MERGE_OVERLAP');
  });

  it('an overlapping merge is rejected (INV-MERGE-NONOVERLAP → MERGE_OVERLAP)', () => {
    const m = new MergeModel();
    m.add(R(0, 0, 1, 1));
    expect(code(() => m.add(R(1, 1, 2, 2)))).toBe('MERGE_OVERLAP');
    expect(m.list().length).toBe(1); // the overlap was not added
    expect(mergeInvariantHolds(m.list())).toBe(true);
  });

  it('row delete inside a 3-row merge shrinks to 2, then dissolves', () => {
    const m = new MergeModel();
    m.add(R(0, 0, 2, 0)); // A1:A3
    m.adjustRowDelete([1]); // delete middle row → A1:A2
    expect(m.list()[0]!.range).toEqual(R(0, 0, 1, 0));
    m.adjustRowDelete([1]); // delete again → 1 cell → dissolve
    expect(m.list().length).toBe(0);
  });

  it('row insert inside a merge expands it (Excel parity)', () => {
    const m = new MergeModel();
    m.add(R(0, 0, 2, 0)); // rows 0..2
    m.adjustRowInsert(1, 1); // insert one row at index 1 (inside)
    expect(m.list()[0]!.range).toEqual(R(0, 0, 3, 0)); // rows 0..3
  });

  it('column delete intersecting a merge shrinks/dissolves; anchor tracks top-left', () => {
    const m = new MergeModel();
    m.add(R(0, 0, 0, 2)); // A1:C1 (3 cols)
    m.adjustColDelete([0]); // drop the anchor column → survivors renumber to 0..1
    expect(m.list()[0]!.range).toEqual(R(0, 0, 0, 1));
    expect(m.list()[0]!.anchor).toEqual({ row: 0, col: 0 });
  });
});

describe('GroupModel — INV-GROUP-NEST', () => {
  it('add nests a contained group (level increments); disjoint stays level 0', () => {
    const g = new GroupModel();
    const outer = g.add({ axis: 'row', start: 0, span: 10 });
    const inner = g.add({ axis: 'row', start: 2, span: 3 }); // nested
    const other = g.add({ axis: 'row', start: 20, span: 2 }); // disjoint
    expect(outer.level).toBe(0);
    expect(inner.level).toBe(1);
    expect(other.level).toBe(0);
    expect(groupInvariantHolds(g.list())).toBe(true);
  });

  it('a partial same-axis overlap is rejected (GROUP_OVERLAP)', () => {
    const g = new GroupModel();
    g.add({ axis: 'row', start: 0, span: 5 }); // 0..4
    expect(code(() => g.add({ axis: 'row', start: 3, span: 5 }))).toBe('GROUP_OVERLAP'); // 3..7 partial
    expect(g.list().length).toBe(1);
    expect(groupInvariantHolds(g.list())).toBe(true);
  });

  it('a partial overlap on a DIFFERENT axis is allowed (axes independent)', () => {
    const g = new GroupModel();
    g.add({ axis: 'row', start: 0, span: 5 });
    g.add({ axis: 'column', start: 3, span: 5 }); // no conflict (other axis)
    expect(g.list().length).toBe(2);
  });

  it('collapse hides the spanned rows; expand restores', () => {
    const g = new GroupModel();
    const n = g.add({ axis: 'row', start: 2, span: 3 });
    g.setCollapsed(n.id, true);
    expect([...g.hiddenRows()].sort((a, b) => a - b)).toEqual([2, 3, 4]);
    g.setCollapsed(n.id, false);
    expect(g.hiddenRows().size).toBe(0);
  });

  it('row delete shrinks a group span; span → 0 removes the node', () => {
    const g = new GroupModel();
    const n = g.add({ axis: 'row', start: 2, span: 3 }); // rows 2..4
    g.adjustRowDelete([3]); // one interior row → span 2
    expect(g.get(n.id)!.span).toBe(2);
    g.adjustRowDelete([2, 3]); // remove both survivors (new indices 2,3) → removed
    expect(g.get(n.id)).toBeUndefined();
  });

  it('row insert inside a group expands; before it shifts', () => {
    const g = new GroupModel();
    const inside = g.add({ axis: 'row', start: 5, span: 3 }); // 5..7
    g.adjustRowInsert(6, 2); // inside → expand
    expect(g.get(inside.id)!.span).toBe(5);
    g.adjustRowInsert(0, 1); // before → shift
    expect(g.get(inside.id)!.start).toBe(6);
  });
});
