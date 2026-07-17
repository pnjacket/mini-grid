// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { createGrid } from '../api/grid.js';
import type { Grid } from '../api/options.js';
import type { ColumnDef } from '../api/options.js';
import type { Selection } from '../selection/selection.js';

const columns: ColumnDef[] = [
  { id: 'id', field: 'id', header: 'ID', width: 80 },
  { id: 'name', field: 'name', header: 'Name', width: 120 },
  { id: 'age', field: 'age', header: 'Age', width: 60 },
];

function makeRows(n: number): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < n; i++) rows.push({ id: i, name: `Name ${i}`, age: 20 + (i % 50) });
  return rows;
}

let mounted: Grid | undefined;
function container(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

async function makeGrid(rowCount: number): Promise<{ grid: Grid; root: HTMLElement }> {
  const el = container();
  const grid = createGrid(el, { columns, keyField: 'id', rowHeight: 28, overscan: 4 });
  mounted = grid;
  await grid.setData(makeRows(rowCount));
  const root = el.querySelector('[data-mini-grid]') as HTMLElement;
  return { grid, root };
}

function cellAt(root: HTMLElement, row: number, col: number): HTMLElement | null {
  return root.querySelector(
    `[role="gridcell"][aria-rowindex="${row + 1}"][aria-colindex="${col + 1}"]`,
  );
}

function clickCell(cell: HTMLElement): void {
  cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
}

/** Ctrl+click — `BIND-POINTER` disjoint range add (`CE-MULTI-RANGE-SELECT`). */
function ctrlClickCell(cell: HTMLElement): void {
  cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, ctrlKey: true }));
}

/** Shift+click — extend the active range to the target cell. */
function shiftClickCell(cell: HTMLElement): void {
  cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, shiftKey: true }));
}

/** A plain column-header click (line-selects the whole column). */
function clickHeader(root: HTMLElement, colId: string): void {
  const h = root.querySelector(`[role="columnheader"][data-col-id="${colId}"]`) as HTMLElement;
  h.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 0 }));
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 0 }));
}

function pressKey(root: HTMLElement, key: string, mods: KeyboardEventInit = {}): void {
  root.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...mods }));
}

function selectedCount(root: HTMLElement): number {
  return root.querySelectorAll('[role="gridcell"][aria-selected="true"]').length;
}

function tabStopCount(root: HTMLElement): number {
  return root.querySelectorAll('[role="gridcell"][tabindex="0"]').length;
}

afterEach(() => {
  mounted?.destroy();
  mounted = undefined;
  document.body.innerHTML = '';
});

describe('COMPONENT-INTERACTION (jsdom)', () => {
  it('click selects a cell: aria-selected + roving focus (BIND-POINTER, DOM-CELL)', async () => {
    const { grid, root } = await makeGrid(200);
    const cell = cellAt(root, 0, 0) as HTMLElement;
    clickCell(cell);

    expect(cell.getAttribute('aria-selected')).toBe('true');
    expect(cell.getAttribute('tabindex')).toBe('0');
    expect(document.activeElement).toBe(cell);
    // Roving tabindex: exactly one cell is the tab stop, and the root steps aside.
    expect(tabStopCount(root)).toBe(1);
    expect(root.getAttribute('tabindex')).toBe('-1');

    const sel = grid.getSelection();
    expect(sel.activeCell).toEqual({ rowKey: 0, columnId: 'id' });
    expect(sel.ranges).toEqual([{ top: 0, bottom: 0, left: 0, right: 0 }]);
  });

  it('EVT-SELECTION-CHANGE fires on selection', async () => {
    const { grid, root } = await makeGrid(200);
    const events: Selection[] = [];
    grid.on('selectionChange', (e) => events.push(e.selection));
    clickCell(cellAt(root, 1, 1) as HTMLElement);

    expect(events).toHaveLength(1);
    expect(events[0]!.activeCell).toEqual({ rowKey: 1, columnId: 'name' });
  });

  it('keyboard ArrowDown/ArrowRight moves the active cell, clamped (BIND-KEYS)', async () => {
    const { grid, root } = await makeGrid(200);
    clickCell(cellAt(root, 0, 0) as HTMLElement);

    pressKey(root, 'ArrowDown');
    await flush();
    pressKey(root, 'ArrowRight');
    await flush();

    expect(grid.getSelection().activeCell).toEqual({ rowKey: 1, columnId: 'name' });
    const active = cellAt(root, 1, 1) as HTMLElement;
    expect(active.getAttribute('tabindex')).toBe('0');
    expect(document.activeElement).toBe(active);
    expect(tabStopCount(root)).toBe(1);
  });

  it('Shift+ArrowDown extends the selection into a contiguous range', async () => {
    const { grid, root } = await makeGrid(200);
    clickCell(cellAt(root, 1, 1) as HTMLElement);

    pressKey(root, 'ArrowDown', { shiftKey: true });
    await flush();

    const sel = grid.getSelection();
    expect(sel.ranges).toEqual([{ top: 1, bottom: 2, left: 1, right: 1 }]);
    expect(sel.anchor).toEqual({ row: 1, col: 1 });
    expect(sel.activeCell).toEqual({ rowKey: 2, columnId: 'name' });
    // Both cells in the range reflect aria-selected.
    expect(cellAt(root, 1, 1)!.getAttribute('aria-selected')).toBe('true');
    expect(cellAt(root, 2, 1)!.getAttribute('aria-selected')).toBe('true');
    expect(selectedCount(root)).toBe(2);
  });

  it('Escape collapses an extended range back to the active cell', async () => {
    const { grid, root } = await makeGrid(200);
    clickCell(cellAt(root, 1, 0) as HTMLElement);
    pressKey(root, 'ArrowDown', { shiftKey: true });
    await flush();
    expect(selectedCount(root)).toBe(2);

    pressKey(root, 'Escape');
    await flush();
    const sel = grid.getSelection();
    expect(sel.ranges).toEqual([{ top: 2, bottom: 2, left: 0, right: 0 }]);
    expect(selectedCount(root)).toBe(1);
  });

  it('focused cell is kept rendered: navigating off-window scrolls it into view (A11Y-GRID)', async () => {
    const { grid, root } = await makeGrid(1000);
    const scroller = root.querySelector('.mg-scroll') as HTMLElement;
    expect(scroller.scrollTop).toBe(0);
    clickCell(cellAt(root, 0, 0) as HTMLElement);

    // PageDown well past the initial ~18-row window (pageRows ≈ 13 at 400px/28).
    for (let i = 0; i < 5; i++) {
      pressKey(root, 'PageDown');
      await flush();
    }

    const active = grid.getSelection().activeCell!;
    expect(active.rowKey).toBeGreaterThan(30); // moved far down
    const activeRow = active.rowKey as number;
    // The focused/active cell must be a live rendered node (never recycled).
    const node = cellAt(root, activeRow, 0);
    expect(node).not.toBeNull();
    expect(node!.getAttribute('tabindex')).toBe('0');
    expect(document.activeElement).toBe(node);
    expect(scroller.scrollTop).toBeGreaterThan(0);
    // Virtualization still bounded — the far-away original row is gone.
    expect(cellAt(root, 0, 0)).toBeNull();
  });

  it('AC-SELECTION-SET: 2× Ctrl+click yields two disjoint highlighted ranges', async () => {
    const { grid, root } = await makeGrid(200);
    clickCell(cellAt(root, 0, 0) as HTMLElement);
    ctrlClickCell(cellAt(root, 3, 2) as HTMLElement);

    const sel = grid.getSelection();
    expect(sel.ranges).toHaveLength(2); // disjoint (INV-SELECTION-WELLFORMED)
    // The just-added range is active (primary) and carries the active cell.
    expect(sel.activeCell).toEqual({ rowKey: 3, columnId: 'age' });
    // Both clicked cells are aria-selected across the set.
    expect(cellAt(root, 0, 0)!.getAttribute('aria-selected')).toBe('true');
    expect(cellAt(root, 3, 2)!.getAttribute('aria-selected')).toBe('true');
    expect(selectedCount(root)).toBe(2);
  });

  it('EVT-SELECTION-CHANGE carries the full range-set after a disjoint add', async () => {
    const { grid, root } = await makeGrid(200);
    const events: Selection[] = [];
    grid.on('selectionChange', (e) => events.push(e.selection));
    clickCell(cellAt(root, 0, 0) as HTMLElement);
    ctrlClickCell(cellAt(root, 5, 1) as HTMLElement);

    expect(events).toHaveLength(2);
    expect(events[1]!.ranges).toHaveLength(2); // full set, not just one range
  });

  it('Shift+click extends the active range (AC-SELECTION-SET)', async () => {
    const { grid, root } = await makeGrid(200);
    clickCell(cellAt(root, 1, 0) as HTMLElement);
    shiftClickCell(cellAt(root, 3, 2) as HTMLElement);

    const sel = grid.getSelection();
    expect(sel.ranges).toEqual([{ top: 1, bottom: 3, left: 0, right: 2 }]);
    expect(selectedCount(root)).toBe(9); // 3×3 block
  });

  it('LIB-SELECTION.selectColumn line-selects a full-height range (INV-SELECTION-LINE)', async () => {
    const { grid, root } = await makeGrid(200);
    grid.selectColumn(1);
    await flush();
    const sel = grid.getSelection();
    expect(sel.ranges[0]).toEqual({ top: 0, bottom: 199, left: 1, right: 1 });
    expect(sel.lines).toEqual([{ kind: 'column', index: 1 }]);
    // Rendered cells of column 1 are aria-selected.
    expect(cellAt(root, 0, 1)!.getAttribute('aria-selected')).toBe('true');
    expect(cellAt(root, 0, 0)!.getAttribute('aria-selected')).toBe('false');
  });

  it('a column-header click line-selects the whole column (DOM-HEADER, CAP-SELECT)', async () => {
    const { grid, root } = await makeGrid(200);
    clickHeader(root, 'name'); // column index 1
    const sel = grid.getSelection();
    expect(sel.ranges[0]).toEqual({ top: 0, bottom: 199, left: 1, right: 1 });
    expect(sel.lines).toEqual([{ kind: 'column', index: 1 }]);
  });

  it('LIB-SELECTION.selectAll selects the whole sheet; clearSelection empties it', async () => {
    const { grid, root } = await makeGrid(200);
    grid.selectAll();
    await flush();
    let sel = grid.getSelection();
    expect(sel.ranges).toEqual([{ top: 0, bottom: 199, left: 0, right: 2 }]);

    grid.clearSelection();
    await flush();
    sel = grid.getSelection();
    expect(sel.ranges).toHaveLength(0);
    expect(sel.activeCell).toBeNull();
    expect(selectedCount(root)).toBe(0);
  });

  it('LIB-SELECTION: setSelection sets state + clamps ranges to extents', async () => {
    const { grid, root } = await makeGrid(200);
    grid.setSelection({
      ranges: [{ top: 2, bottom: 5, left: 0, right: 99 }], // right past colCount
      activeCell: { rowKey: 5, columnId: 'age' },
      anchor: { row: 2, col: 0 },
    });
    await flush();
    const sel = grid.getSelection();
    expect(sel.ranges[0]!.right).toBe(2); // clamped to last column index
    expect(sel.ranges[0]).toEqual({ top: 2, bottom: 5, left: 0, right: 2 });
    expect(cellAt(root, 2, 0)!.getAttribute('aria-selected')).toBe('true');
  });
});
