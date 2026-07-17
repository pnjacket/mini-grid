// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { createGrid } from '../api/grid.js';
import type { ColumnDef } from '../api/options.js';
import type { FilterSpec } from '../types.js';
import { buildFilterPredicate } from './filter-menu.js';

const columns: ColumnDef[] = [
  { id: 'id', field: 'id', header: 'ID', width: 80, type: 'number' },
  { id: 'k', field: 'k', header: 'K', width: 90, type: 'number' },
  { id: 't', field: 't', header: 'T', width: 90, type: 'text' },
];

/** ids 0..4 with k values [5,3,1,4,2] (natural order ≠ k order) + text col. */
function shuffledRows(): Array<Record<string, unknown>> {
  const ks = [5, 3, 1, 4, 2];
  return ks.map((k, i) => ({ id: i, k, t: `t${i}` }));
}

function bigRows(n: number): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < n; i++) rows.push({ id: i, k: i, t: `t${i}` });
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

function headerCell(el: HTMLElement, colId: string): HTMLElement {
  return el.querySelector(`[role=columnheader][data-col-id="${colId}"]`) as HTMLElement;
}

async function flush(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
}

function fireMouse(target: EventTarget, type: string, opts: MouseEventInit = {}): void {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...opts }));
}

/** A sub-threshold header press+release = a sort click (Shift = multi-sort). */
function clickHeaderSort(el: HTMLElement, colId: string, shift = false): void {
  const label = headerCell(el, colId).querySelector('.mg-header-label') as HTMLElement;
  fireMouse(label, 'mousedown', { shiftKey: shift, clientX: 5 });
  fireMouse(document, 'mouseup', { clientX: 5 });
}

describe('CAP-SORT — public sort + header cycle + multi-sort + undo (LIB-SORT)', () => {
  it('sort(spec) reorders the visible rows and sets aria-sort', async () => {
    const el = container();
    const grid = createGrid(el, { columns, keyField: 'id' });
    await grid.setData(shuffledRows());

    const res = await grid.sort({ entries: [{ columnId: 'k', direction: 'asc' }] });
    await flush();

    expect(res).toEqual({ spec: { entries: [{ columnId: 'k', direction: 'asc' }] }, rowCount: 5 });
    // First visible row is now the smallest k (=1).
    expect(cellAt(el, 1, 2)!.textContent).toBe('1');
    expect(headerCell(el, 'k').getAttribute('aria-sort')).toBe('ascending');
    grid.destroy();
  });

  it('multi-key sort orders by primary then secondary key', async () => {
    const el = container();
    const cols: ColumnDef[] = [
      { id: 'id', field: 'id', width: 60, type: 'number' },
      { id: 'g', field: 'g', width: 60, type: 'text' },
      { id: 'v', field: 'v', width: 60, type: 'number' },
    ];
    const grid = createGrid(el, { columns: cols, keyField: 'id' });
    await grid.setData([
      { id: 0, g: 'b', v: 1 },
      { id: 1, g: 'a', v: 2 },
      { id: 2, g: 'a', v: 1 },
      { id: 3, g: 'b', v: 2 },
    ]);

    // g asc, then v desc → [a/2 (id1), a/1 (id2), b/2 (id3), b/1 (id0)].
    await grid.sort({
      entries: [
        { columnId: 'g', direction: 'asc' },
        { columnId: 'v', direction: 'desc' },
      ],
    });
    await flush();

    expect(cellAt(el, 1, 1)!.textContent).toBe('1'); // id 1
    expect(cellAt(el, 2, 1)!.textContent).toBe('2'); // id 2
    expect(cellAt(el, 3, 1)!.textContent).toBe('3'); // id 3
    expect(cellAt(el, 4, 1)!.textContent).toBe('0'); // id 0
    grid.destroy();
  });

  it('sort is an undoable command (undo restores the previous order)', async () => {
    const el = container();
    const grid = createGrid(el, { columns, keyField: 'id' });
    await grid.setData(shuffledRows());

    await grid.sort({ entries: [{ columnId: 'k', direction: 'asc' }] });
    await flush();
    expect(cellAt(el, 1, 2)!.textContent).toBe('1'); // sorted: smallest k first

    await grid.undo();
    await flush();
    // Back to natural (id) order → row 0 is id 0, whose k is 5.
    expect(cellAt(el, 1, 2)!.textContent).toBe('5');
    expect(headerCell(el, 'k').getAttribute('aria-sort')).toBe('none');
    grid.destroy();
  });

  it('header click cycles asc→desc→none; Shift-click appends a secondary key (AC-MULTISORT)', async () => {
    const el = container();
    const grid = createGrid(el, { columns, keyField: 'id' });
    await grid.setData(shuffledRows());

    clickHeaderSort(el, 'k');
    await flush();
    expect(headerCell(el, 'k').getAttribute('aria-sort')).toBe('ascending');
    expect(grid.getSortSpec().entries).toEqual([{ columnId: 'k', direction: 'asc' }]);

    clickHeaderSort(el, 'k');
    await flush();
    expect(headerCell(el, 'k').getAttribute('aria-sort')).toBe('descending');

    clickHeaderSort(el, 'k');
    await flush();
    expect(headerCell(el, 'k').getAttribute('aria-sort')).toBe('none');
    expect(grid.getSortSpec().entries).toEqual([]);

    // Shift-click builds a multi-key sort (secondary/tertiary keys).
    clickHeaderSort(el, 'k');
    await flush();
    clickHeaderSort(el, 't', true);
    await flush();
    expect(grid.getSortSpec().entries).toEqual([
      { columnId: 'k', direction: 'asc' },
      { columnId: 't', direction: 'asc' },
    ]);
    expect(headerCell(el, 't').getAttribute('aria-sort')).toBe('ascending');
    grid.destroy();
  });

  it('a vetoed EVT-BEFORE-SORT aborts the sort (state unchanged)', async () => {
    const el = container();
    const grid = createGrid(el, { columns, keyField: 'id' });
    await grid.setData(shuffledRows());

    const off = grid.on('beforeSort', (e) => e.preventDefault());
    const res = await grid.sort({ entries: [{ columnId: 'k', direction: 'asc' }] });
    await flush();
    expect(res.spec.entries).toEqual([]); // unchanged
    expect(grid.getSortSpec().entries).toEqual([]);
    expect(cellAt(el, 1, 2)!.textContent).toBe('5'); // still natural order
    off();
    grid.destroy();
  });

  it('sort is gated behind the `sorting` feature flag (no-op when off)', async () => {
    const el = container();
    const grid = createGrid(el, { columns, keyField: 'id', features: { sorting: false } });
    await grid.setData(shuffledRows());

    await grid.sort({ entries: [{ columnId: 'k', direction: 'asc' }] });
    await flush();
    expect(grid.getSortSpec().entries).toEqual([]);
    expect(cellAt(el, 1, 2)!.textContent).toBe('5'); // unchanged
    grid.destroy();
  });
});

describe('CAP-FILTER — public filter, empty = all, not undoable (LIB-FILTER)', () => {
  it('filter(spec) subsets the rows and resolves the result projection', async () => {
    const el = container();
    const grid = createGrid(el, { columns, keyField: 'id' });
    await grid.setData(shuffledRows()); // k in {5,3,1,4,2}

    const pred = buildFilterPredicate('number', 'gt', '2')!;
    const res = await grid.filter({ perColumn: { k: pred } });
    await flush();

    expect(res.rowCount).toBe(3); // k in {5,3,4}
    expect(res.totalRowCount).toBe(5);
    expect((await grid.getRowCount()).rowCount).toBe(3);
    grid.destroy();
  });

  it('AC-FILTER-EMPTY: an empty FilterSpec returns all rows (not an error)', async () => {
    const el = container();
    const grid = createGrid(el, { columns, keyField: 'id' });
    await grid.setData(shuffledRows());

    await grid.filter({ perColumn: { k: buildFilterPredicate('number', 'gt', '2')! } });
    await flush();
    expect((await grid.getRowCount()).rowCount).toBe(3);

    const res = await grid.filter({ perColumn: {} });
    await flush();
    expect(res.rowCount).toBe(5);
    expect(res.rowCount).toBe(res.totalRowCount); // all rows
    grid.destroy();
  });

  it('AC-UNDO-SCOPE: a filter is NOT on the undo stack (view state)', async () => {
    const el = container();
    const grid = createGrid(el, { columns, keyField: 'id' });
    await grid.setData(shuffledRows());

    await grid.filter({ perColumn: { k: buildFilterPredicate('number', 'gt', '2')! } });
    await flush();
    expect((await grid.getRowCount()).rowCount).toBe(3);

    await grid.undo(); // no filter command exists → nothing to undo
    await flush();
    expect((await grid.getRowCount()).rowCount).toBe(3); // filter still applied
    grid.destroy();
  });
});

describe('LAYER-FILTER-MENU + A11Y-FILTER-MENU', () => {
  it('opens focused, applies (subsets), clears (restores), Esc restores focus to the icon', async () => {
    const el = container();
    const grid = createGrid(el, { columns, keyField: 'id' });
    await grid.setData(shuffledRows());

    const btn = headerCell(el, 'k').querySelector('[data-mg-filter-btn]') as HTMLElement;

    // Open — focus moves into the menu, trigger reflects aria-expanded.
    fireMouse(btn, 'click');
    await flush();
    let menu = document.querySelector('.mg-filter-menu') as HTMLElement;
    expect(menu).toBeTruthy();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    const opSel = menu.querySelector('[data-mg-filter-op]') as HTMLSelectElement;
    expect(document.activeElement).toBe(opSel);

    // Apply `k > 2` → 3 rows, menu closes, focus returns to the icon.
    opSel.value = 'gt';
    opSel.dispatchEvent(new Event('change'));
    (menu.querySelector('[data-mg-filter-value]') as HTMLInputElement).value = '2';
    fireMouse(menu.querySelector('[data-mg-filter-apply]') as HTMLElement, 'click');
    await flush();
    expect(document.querySelector('.mg-filter-menu')).toBeNull();
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(btn);
    expect((await grid.getRowCount()).rowCount).toBe(3);
    expect(btn.classList.contains('mg-header-filter--active')).toBe(true);

    // Reopen + Clear → all rows back, icon no longer active.
    fireMouse(btn, 'click');
    await flush();
    menu = document.querySelector('.mg-filter-menu') as HTMLElement;
    fireMouse(menu.querySelector('[data-mg-filter-clear]') as HTMLElement, 'click');
    await flush();
    expect((await grid.getRowCount()).rowCount).toBe(5);
    expect(btn.classList.contains('mg-header-filter--active')).toBe(false);

    // Reopen + Esc → closes and restores focus to the filter icon.
    fireMouse(btn, 'click');
    await flush();
    menu = document.querySelector('.mg-filter-menu') as HTMLElement;
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.mg-filter-menu')).toBeNull();
    expect(document.activeElement).toBe(btn);
    grid.destroy();
  });
});

describe('CAP-RESIZE / CAP-REORDER — column width + move, undoable (LIB-RESIZE/-REORDER)', () => {
  it('setColumnWidth updates the column + undo restores it', async () => {
    const el = container();
    const grid = createGrid(el, { columns, keyField: 'id' });
    await grid.setData(shuffledRows());

    let resized: { columnId: string; width: number } | undefined;
    grid.on('afterResize', (e) => (resized = { columnId: e.columnId, width: e.width }));

    grid.setColumnWidth('k', 200);
    await flush();
    expect(headerCell(el, 'k').style.width).toBe('200px');
    expect(resized).toEqual({ columnId: 'k', width: 200 });

    await grid.undo();
    await flush();
    expect(headerCell(el, 'k').style.width).toBe('90px');
    grid.destroy();
  });

  it('moveColumn reorders (id stable) + undo restores', async () => {
    const el = container();
    const grid = createGrid(el, { columns, keyField: 'id' });
    await grid.setData(shuffledRows());

    let reordered: { fromIndex: number; toIndex: number } | undefined;
    grid.on('afterReorder', (e) => (reordered = { fromIndex: e.fromIndex, toIndex: e.toIndex }));

    grid.moveColumn('k', 0);
    await flush();
    const first = el.querySelectorAll('[role=columnheader]')[0] as HTMLElement;
    expect(first.getAttribute('data-col-id')).toBe('k');
    expect(first.getAttribute('aria-colindex')).toBe('1');
    expect(reordered).toEqual({ fromIndex: 1, toIndex: 0 });

    await grid.undo();
    await flush();
    expect(
      (el.querySelectorAll('[role=columnheader]')[0] as HTMLElement).getAttribute('data-col-id'),
    ).toBe('id');
    grid.destroy();
  });
});

describe('CAP-FREEZE — freeze pane, clamp + pinned render (LIB-FREEZE, INV-FREEZE-PREFIX)', () => {
  it('INV-FREEZE-PREFIX: setFrozen clamps counts to [0, extent]', async () => {
    const el = container();
    const grid = createGrid(el, { columns, keyField: 'id' });
    await grid.setData(shuffledRows()); // 5 rows, 3 columns

    grid.setFrozen({ rows: 999, cols: 999 });
    await flush();
    expect(grid.getFrozen()).toEqual({ rows: 5, cols: 3 });

    grid.setFrozen({ rows: -4, cols: 1 });
    await flush();
    expect(grid.getFrozen()).toEqual({ rows: 0, cols: 1 });
    grid.destroy();
  });

  it('frozen top rows render pinned and stay put when the body scrolls', async () => {
    const el = container();
    const grid = createGrid(el, { columns, keyField: 'id', rowHeight: 28 });
    await grid.setData(bigRows(200));

    grid.setFrozen({ rows: 1 });
    await flush();

    // Scroll far down; the frozen row (logical row 0) is still rendered, pinned.
    grid.scrollTo({ rowIndex: 100 });
    await flush();

    const frozenCell = cellAt(el, 1, 1); // aria-rowindex 1 = logical row 0
    expect(frozenCell).toBeTruthy();
    const rowEl = frozenCell!.parentElement as HTMLElement;
    expect(rowEl.classList.contains('mg-row--frozen')).toBe(true);
    // Pinned: top = scrollTop + offsetOf(0) = 100 * 28 = 2800px.
    expect(rowEl.style.top).toBe('2800px');
    expect(frozenCell!.classList.contains('mg-cell--frozen')).toBe(true);
    grid.destroy();
  });

  it('emits vetoable/notify freeze events', async () => {
    const el = container();
    const grid = createGrid(el, { columns, keyField: 'id' });
    await grid.setData(shuffledRows());

    let changed: { frozenRowCount: number; frozenColCount: number } | undefined;
    grid.on('afterFreezeChange', (e) => (changed = { frozenRowCount: e.frozenRowCount, frozenColCount: e.frozenColCount }));
    grid.setFrozen({ rows: 2 });
    await flush();
    expect(changed).toEqual({ frozenRowCount: 2, frozenColCount: 0 });

    // Undo restores the previous pane.
    await grid.undo();
    await flush();
    expect(grid.getFrozen()).toEqual({ rows: 0, cols: 0 });
    grid.destroy();
  });
});

describe('EVT-*-SORT/-FILTER — after events carry the applied spec', () => {
  it('afterSort + afterFilter fire with the spec + counts', async () => {
    const el = container();
    const grid = createGrid(el, { columns, keyField: 'id' });
    await grid.setData(shuffledRows());

    let sorted: { spec: { entries: unknown[] }; rowCount: number } | undefined;
    let filtered: { spec: FilterSpec; rowCount: number; totalRowCount: number } | undefined;
    grid.on('afterSort', (e) => (sorted = e));
    grid.on('afterFilter', (e) => (filtered = e));

    await grid.sort({ entries: [{ columnId: 'k', direction: 'desc' }] });
    expect(sorted!.spec.entries).toEqual([{ columnId: 'k', direction: 'desc' }]);
    expect(sorted!.rowCount).toBe(5);

    await grid.filter({ perColumn: { k: buildFilterPredicate('number', 'lt', '3')! } });
    expect(filtered!.rowCount).toBe(2); // k in {1,2}
    expect(filtered!.totalRowCount).toBe(5);
    grid.destroy();
  });
});
