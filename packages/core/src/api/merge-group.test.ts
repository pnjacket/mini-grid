// @vitest-environment jsdom
/**
 * Slice 6b — `CAP-MERGE` + `CAP-GROUP` through the public `Grid` facade against
 * the in-process engine: merge renders one spanning anchor cell (covered cells
 * suppressed + non-editable), overlap rejection (`MERGE_OVERLAP`), structural
 * shrink/dissolve/expand of merges, row-group collapse hiding rows,
 * partial-overlap group rejection (`GROUP_OVERLAP`), freeze re-clamp, and undo.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { createGrid } from './grid.js';
import type { Grid, ColumnDef } from './options.js';
import { GridError } from '../errors.js';
import type { RowKey } from '../types.js';

const columns: ColumnDef[] = [
  { id: 'a', field: 'a', header: 'A', width: 80, type: 'text', editable: true },
  { id: 'b', field: 'b', header: 'B', width: 90, type: 'text', editable: true },
  { id: 'c', field: 'c', header: 'C', width: 90, type: 'text', editable: true },
];

function makeRows(n: number): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < n; i++) rows.push({ id: i, a: `a${i}`, b: `b${i}`, c: `c${i}` });
  return rows;
}

function container(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

function cellAt(el: HTMLElement, r1: number, c1: number): HTMLElement | null {
  return el.querySelector(`[role=gridcell][aria-rowindex="${r1}"][aria-colindex="${c1}"]`);
}

async function flush(rounds = 12): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
}

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof GridError ? e.code : `not-grid:${String(e)}`;
  }
  return undefined;
}

let mounted: Grid | undefined;
afterEach(() => {
  mounted?.destroy();
  mounted = undefined;
  document.body.innerHTML = '';
});

async function makeGrid(rows: number): Promise<{ grid: Grid; el: HTMLElement }> {
  const el = container();
  const grid = createGrid(el, { columns, keyField: 'id', rowHeight: 28, overscan: 4 });
  mounted = grid;
  await grid.setData(makeRows(rows));
  await flush();
  return { grid, el };
}

async function keyAt(grid: Grid, index: number): Promise<RowKey> {
  const res = await grid.getRows({ startIndex: index, endIndex: index + 1 });
  return res.rows[0]!.key;
}

describe('CAP-MERGE — merge/unmerge + spanning render (LIB-MERGE, ENTITY-MERGE-REGION)', () => {
  it('merge renders one spanning anchor cell; covered cells are suppressed', async () => {
    const { grid, el } = await makeGrid(5);
    grid.merge({ top: 0, left: 0, bottom: 0, right: 1 }); // A1:B1
    await flush();

    const anchor = cellAt(el, 1, 1)!; // aria 1-based → logical (0,0)
    expect(anchor).toBeTruthy();
    expect(anchor.textContent).toBe('a0'); // the anchor value
    expect(anchor.classList.contains('mg-cell--merged')).toBe(true);
    expect(anchor.style.width).toBe('170px'); // 80 + 90 (spans two columns)
    expect(anchor.getAttribute('aria-colspan')).toBe('2');
    // The covered (non-anchor) cell is not a queryable/rendered gridcell.
    expect(cellAt(el, 1, 2)).toBeNull();
    expect(grid.getMerges()).toHaveLength(1);
  });

  it('an overlapping merge throws MERGE_OVERLAP (INV-MERGE-NONOVERLAP)', async () => {
    const { grid } = await makeGrid(5);
    grid.merge({ top: 0, left: 0, bottom: 1, right: 1 });
    await flush();
    expect(code(() => grid.merge({ top: 1, left: 1, bottom: 2, right: 2 }))).toBe('MERGE_OVERLAP');
    expect(grid.getMerges()).toHaveLength(1);
  });

  it('unmerge dissolves the region (covered cell renders again)', async () => {
    const { grid, el } = await makeGrid(5);
    grid.merge({ top: 0, left: 0, bottom: 0, right: 1 });
    await flush();
    expect(cellAt(el, 1, 2)).toBeNull();

    grid.unmerge({ top: 0, left: 0, bottom: 0, right: 1 });
    await flush();
    expect(grid.getMerges()).toHaveLength(0);
    expect(cellAt(el, 1, 2)!.textContent).toBe('b0');
  });

  it('deleting a row inside a 3-row merge shrinks to 2, then dissolves (INV-MERGE-MIN2)', async () => {
    const { grid } = await makeGrid(5);
    grid.merge({ top: 0, left: 0, bottom: 2, right: 0 }); // A1:A3
    await flush();

    await grid.removeRows([await keyAt(grid, 1)]); // delete interior row
    await flush();
    expect(grid.getMerges()[0]!.range).toEqual({ top: 0, left: 0, bottom: 1, right: 0 });

    await grid.removeRows([await keyAt(grid, 1)]); // delete again → 1 cell → dissolve
    await flush();
    expect(grid.getMerges()).toHaveLength(0);
  });

  it('inserting a row inside a merge expands it', async () => {
    const { grid } = await makeGrid(5);
    grid.merge({ top: 0, left: 0, bottom: 2, right: 0 }); // rows 0..2
    await flush();
    await grid.insertRows(1, [{ id: 'x', a: 'ax', b: 'bx', c: 'cx' }]);
    await flush();
    expect(grid.getMerges()[0]!.range).toEqual({ top: 0, left: 0, bottom: 3, right: 0 });
  });

  it('merge is an undoable command', async () => {
    const { grid } = await makeGrid(5);
    grid.merge({ top: 0, left: 0, bottom: 0, right: 1 });
    await flush();
    expect(grid.getMerges()).toHaveLength(1);
    await grid.undo();
    await flush();
    expect(grid.getMerges()).toHaveLength(0);
    await grid.redo();
    await flush();
    expect(grid.getMerges()).toHaveLength(1);
  });

  it('a vetoed EVT-BEFORE-MERGE-CHANGE aborts the merge', async () => {
    const { grid } = await makeGrid(5);
    const off = grid.on('beforeMergeChange', (e) => e.preventDefault());
    grid.merge({ top: 0, left: 0, bottom: 0, right: 1 });
    await flush();
    expect(grid.getMerges()).toHaveLength(0);
    off();
  });

  it('editing a covered cell redirects to the anchor (anchor-only editable)', async () => {
    const { grid, el } = await makeGrid(5);
    grid.merge({ top: 0, left: 0, bottom: 0, right: 1 }); // anchor (0,0)
    await flush();

    // Address the covered cell (0,1) by identity → the editor opens on the anchor.
    grid.beginEdit({ rowKey: await keyAt(grid, 0), columnId: 'b' });
    await flush();
    const anchor = cellAt(el, 1, 1)!;
    expect(anchor.hasAttribute('data-mg-editing')).toBe(true);
    expect(anchor.querySelector('input, select')).toBeTruthy();
    grid.cancelEdit();
  });
});

describe('CAP-GROUP — grouping/outline + collapse (LIB-GROUP, ENTITY-GROUP-NODE)', () => {
  it('grouping a row range + collapse hides those rows; expand restores', async () => {
    const { grid, el } = await makeGrid(6);
    const root = el.querySelector('[data-mini-grid]') as HTMLElement;
    const rendered = (): number =>
      root.querySelectorAll('[role=row].mg-row:not([style*="display: none"])').length;
    const before = rendered();
    expect(before).toBe(6);

    const { id } = grid.group({ axis: 'row', start: 1, span: 2 }); // rows 1,2
    await flush();
    const toggle = el.querySelector('[data-mg-group-toggle]') as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    grid.setCollapsed(id, true);
    await flush();
    expect(rendered()).toBe(before - 2); // two rows dropped from the window
    expect(cellAt(el, 2, 1)).toBeNull(); // logical row 1 no longer rendered
    expect(
      (el.querySelector('[data-mg-group-toggle]') as HTMLElement).getAttribute('aria-expanded'),
    ).toBe('false');

    grid.setCollapsed(id, false);
    await flush();
    expect(rendered()).toBe(before);
    expect(cellAt(el, 2, 1)!.textContent).toBe('a1');
  });

  it('the outline toggle collapses on click (keyboard-operable button)', async () => {
    const { grid, el } = await makeGrid(6);
    const root = el.querySelector('[data-mini-grid]') as HTMLElement;
    grid.group({ axis: 'row', start: 1, span: 2 });
    await flush();
    const toggle = el.querySelector('[data-mg-group-toggle]') as HTMLButtonElement;
    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(grid.getGroups()[0]!.collapsed).toBe(true);
    expect(cellAt(el, 2, 1)).toBeNull();
  });

  it('a partially-overlapping same-axis group throws GROUP_OVERLAP (INV-GROUP-NEST)', async () => {
    const { grid } = await makeGrid(10);
    grid.group({ axis: 'row', start: 0, span: 5 });
    await flush();
    expect(code(() => grid.group({ axis: 'row', start: 3, span: 5 }))).toBe('GROUP_OVERLAP');
    expect(grid.getGroups()).toHaveLength(1);
  });

  it('group is undoable', async () => {
    const { grid } = await makeGrid(6);
    const { id } = grid.group({ axis: 'row', start: 1, span: 2 });
    await flush();
    expect(grid.getGroups()).toHaveLength(1);
    await grid.undo();
    await flush();
    expect(grid.getGroups()).toHaveLength(0);
    await grid.redo();
    await flush();
    expect(grid.getGroups()).toHaveLength(1);
    expect(grid.getGroups()[0]!.id).toBe(id);
  });

  it('merge/group are gated behind their feature flags (no-op when off)', async () => {
    const el = container();
    const grid = createGrid(el, {
      columns,
      keyField: 'id',
      features: { merge: false, group: false },
    });
    mounted = grid;
    await grid.setData(makeRows(5));
    await flush();
    grid.merge({ top: 0, left: 0, bottom: 0, right: 1 });
    expect(grid.group({ axis: 'row', start: 0, span: 2 }).id).toBe('');
    expect(grid.getMerges()).toHaveLength(0);
    expect(grid.getGroups()).toHaveLength(0);
  });
});

describe('Structural adjustment — freeze re-clamp (INV-FREEZE-PREFIX)', () => {
  it('deleting rows within the frozen prefix decrements + re-clamps the freeze', async () => {
    const { grid } = await makeGrid(5);
    grid.setFrozen({ rows: 5 });
    await flush();
    expect(grid.getFrozen().rows).toBe(5);

    await grid.removeRows([await keyAt(grid, 0), await keyAt(grid, 1)]);
    await flush();
    // 5 → 3 rows; the frozen prefix decremented by the two deleted prefix rows.
    expect(grid.getFrozen().rows).toBe(3);
  });
});
