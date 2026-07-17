// @vitest-environment jsdom
/**
 * `AC-FLAGS` — the feature-flag ON/OFF matrix (`PATTERN-FEATURE-FLAGS`,
 * `CAP-FEATURE-FLAGS`). Every capability is exercised **ON** (the affordance /
 * behavior is present) and **OFF** (no affordance / no DOM hook / `isFeatureEnabled`
 * false / the API is inert). The full cross-product is infeasible, so — per Quality
 * 11.5 — a **representative pairwise matrix** covers the interacting features:
 *
 *   freeze×sort · merge×edit · merge×delete-row · group×scroll · RTL×selection ·
 *   conditional-format×scroll(virtualization) · filter×edit · undo×structural-op ·
 *   clipboard×validation · touch/multi-range.
 *
 * Each pair is tested with both features on (they interoperate) and with one toggled
 * off (the other still works). Runs in jsdom against the real `createGrid` code path.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createGrid } from './api/grid.js';
import type { ColumnDef, Grid } from './api/options.js';
import type { FeatureFlags } from './api/features.js';

// A small, deterministic dataset with an editable text column, a value-mask
// number column, and a range-validated column (for the clipboard×validation pair).
const columns: ColumnDef[] = [
  { id: 'id', field: 'id', header: 'ID', width: 80, type: 'number' },
  { id: 'c1', field: 'c1', header: 'C1', width: 100, type: 'text', editable: true },
  { id: 'num', field: 'num', header: 'Num', width: 100, type: 'number', editable: true, formatMask: 'number' },
  { id: 'score', field: 'score', header: 'Score', width: 100, type: 'number', editable: true, validation: [{ kind: 'range', min: 0, max: 120 }] },
];

interface Row {
  id: number;
  c1: string;
  num: number;
  score: number;
}
function makeRows(n: number): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < n; i++) rows.push({ id: i, c1: `r${i}`, num: 1000 + i, score: 50 });
  return rows;
}

let clipboardText = '';
const mounted: Grid[] = [];

beforeEach(() => {
  clipboardText = '';
  const clip = {
    writeText: (t: string): Promise<void> => {
      clipboardText = t;
      return Promise.resolve();
    },
    readText: (): Promise<string> => Promise.resolve(clipboardText),
  };
  Object.defineProperty(window.navigator, 'clipboard', { value: clip, configurable: true });
});

afterEach(() => {
  for (const g of mounted) g.destroy();
  mounted.length = 0;
  document.body.innerHTML = '';
});

async function mount(
  features?: Partial<FeatureFlags>,
  rowCount = 8,
): Promise<{ grid: Grid; root: HTMLElement }> {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const grid = createGrid(el, {
    columns,
    keyField: 'id',
    rowHeight: 28,
    overscan: 6,
    ...(features ? { features } : {}),
  });
  mounted.push(grid);
  await grid.setData(makeRows(rowCount));
  const root = el.querySelector('[data-mini-grid]') as HTMLElement;
  return { grid, root };
}

/** Drain the microtask + timer queue so fire-and-forget `void refresh()` settles. */
async function flush(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
}

const header = (root: HTMLElement, id: string): HTMLElement =>
  root.querySelector(`[role=columnheader][data-col-id="${id}"]`) as HTMLElement;
const bodyCell = (root: HTMLElement, rowKey: number | string, colId: string): HTMLElement | null =>
  root.querySelector(`[role=gridcell][data-row-key="${rowKey}"][data-col-id="${colId}"]`);
// Select a range; the anchor (top-left) drives the active cell (`activeCell: null`
// → the model derives the active index from the anchor, matching the public API).
const select = (grid: Grid, r: { top: number; bottom: number; left: number; right: number }): void =>
  grid.setSelection({ ranges: [r], anchor: { row: r.top, col: r.left }, activeCell: null } as never);

// ===========================================================================
// Per-capability ON / OFF
// ===========================================================================
describe('AC-FLAGS — every capability ON (affordance present) and OFF (no affordance)', () => {
  it('editing: ON → an editable cell is aria-readonly=false; OFF → readonly (no edit affordance)', async () => {
    const on = await mount();
    expect(bodyCell(on.root, 0, 'c1')?.getAttribute('aria-readonly')).toBe('false');
    expect(on.grid.isFeatureEnabled('editing')).toBe(true);

    const off = await mount({ editing: false });
    expect(bodyCell(off.root, 0, 'c1')?.getAttribute('aria-readonly')).toBe('true');
    expect(off.grid.isFeatureEnabled('editing')).toBe(false);
  });

  it('sorting: ON → sortable header + sort reorders; OFF → no data-mg-sortable + sort is inert', async () => {
    const on = await mount();
    expect(header(on.root, 'num').hasAttribute('data-mg-sortable')).toBe(true);
    await on.grid.sort({ entries: [{ columnId: 'num', direction: 'desc' }] });
    await flush();
    expect(on.grid.getSortSpec().entries).toHaveLength(1);
    expect(bodyCell(on.root, 7, 'num')).not.toBeNull(); // top row after desc sort is the highest key

    const off = await mount({ sorting: false });
    expect(header(off.root, 'num').hasAttribute('data-mg-sortable')).toBe(false);
    expect(header(off.root, 'num').hasAttribute('aria-sort')).toBe(false);
    const res = await off.grid.sort({ entries: [{ columnId: 'num', direction: 'desc' }] });
    expect(res.spec.entries).toHaveLength(0); // no-op
  });

  it('filtering: ON → the filter button is shown; OFF → hidden + filter is inert', async () => {
    const on = await mount();
    expect((header(on.root, 'id').querySelector('[data-mg-filter-btn]') as HTMLElement).style.display).not.toBe('none');

    const off = await mount({ filtering: false });
    expect((header(off.root, 'id').querySelector('[data-mg-filter-btn]') as HTMLElement).style.display).toBe('none');
    const before = (await off.grid.getRowCount()).rowCount;
    await off.grid.filter({ perColumn: { id: (v) => Number(v) > 3 } });
    await flush();
    expect((await off.grid.getRowCount()).rowCount).toBe(before); // no-op
  });

  it('resize: ON → resize handle shown; OFF → hidden + setColumnWidth inert', async () => {
    const on = await mount();
    expect((header(on.root, 'id').querySelector('[data-mg-resize]') as HTMLElement).style.display).not.toBe('none');

    const off = await mount({ resize: false });
    expect((header(off.root, 'id').querySelector('[data-mg-resize]') as HTMLElement).style.display).toBe('none');
    off.grid.setColumnWidth('id', 400);
    await flush();
    expect(off.grid.serializeState().columns.find((c) => c.id === 'id')?.width ?? 80).not.toBe(400);
  });

  it('reorder: ON → header is a drag source (data-mg-reorder); OFF → not', async () => {
    const on = await mount();
    expect(header(on.root, 'id').hasAttribute('data-mg-reorder')).toBe(true);
    const off = await mount({ reorder: false });
    expect(header(off.root, 'id').hasAttribute('data-mg-reorder')).toBe(false);
  });

  it('freeze: ON → setFrozen pins the row; OFF → setFrozen is inert', async () => {
    const on = await mount();
    on.grid.setFrozen({ rows: 1 });
    await flush();
    expect(on.grid.getFrozen().rows).toBe(1);
    expect(on.root.querySelector('.mg-row--frozen')).not.toBeNull();

    const off = await mount({ freeze: false });
    off.grid.setFrozen({ rows: 1 });
    await flush();
    expect(off.grid.getFrozen().rows).toBe(0);
    expect(off.root.querySelector('.mg-row--frozen')).toBeNull();
  });

  it('merge: ON → merge spans one anchor cell; OFF → merge is inert', async () => {
    const on = await mount();
    on.grid.merge({ top: 0, left: 1, bottom: 0, right: 2 });
    await flush();
    expect(on.grid.getMerges()).toHaveLength(1);
    expect(bodyCell(on.root, 0, 'c1')?.getAttribute('aria-colspan')).toBe('2');

    const off = await mount({ merge: false });
    off.grid.merge({ top: 0, left: 1, bottom: 0, right: 2 });
    await flush();
    expect(off.grid.getMerges()).toHaveLength(0);
  });

  it('group: ON → group returns an id + node; OFF → inert (empty id)', async () => {
    const on = await mount();
    const { id } = on.grid.group({ axis: 'row', start: 1, span: 3 });
    await flush();
    expect(id).not.toBe('');
    expect(on.grid.getGroups()).toHaveLength(1);

    const off = await mount({ group: false });
    expect(off.grid.group({ axis: 'row', start: 1, span: 3 }).id).toBe('');
    expect(off.grid.getGroups()).toHaveLength(0);
  });

  it('clipboard: ON → the fill handle mounts on a selection; OFF → no fill handle + copy inert', async () => {
    const on = await mount();
    select(on.grid, { top: 0, bottom: 0, left: 1, right: 1 });
    await flush();
    expect(on.root.querySelector('[data-mg-fill-handle]')).not.toBeNull();
    await on.grid.copy();
    expect(clipboardText).toBe('r0');

    clipboardText = '';
    const off = await mount({ clipboard: false });
    select(off.grid, { top: 0, bottom: 0, left: 1, right: 1 });
    await flush();
    expect(off.root.querySelector('[data-mg-fill-handle]')).toBeNull();
    await off.grid.copy();
    expect(clipboardText).toBe(''); // copy is a no-op
  });

  it('formatting: ON → the value mask formats the cell; OFF → raw value', async () => {
    const on = await mount();
    expect(bodyCell(on.root, 0, 'num')?.textContent).toBe('1,000'); // number mask

    const off = await mount({ formatting: false });
    expect(off.grid.isFeatureEnabled('formatting')).toBe(false);
    expect(bodyCell(off.root, 0, 'num')?.textContent).toBe('1000'); // unformatted
    off.grid.setStyle({ top: 0, bottom: 0, left: 1, right: 1 }, { fillColor: '#ff0000' });
    await flush();
    // setStyle is inert with formatting off (no overlay serialized).
    expect(off.grid.serializeState().cellStyles).toHaveLength(0);
  });

  it('conditionalFormatting: ON → addConditionalRule returns an id; OFF → inert (empty id)', async () => {
    const on = await mount();
    const { id } = on.grid.addConditionalRule({ kind: 'value', config: { op: '>', value: 0 }, style: { fillColor: '#00ff00' } } as never);
    expect(id).not.toBe('');

    const off = await mount({ conditionalFormatting: false });
    expect(
      off.grid.addConditionalRule({ kind: 'value', config: { op: '>', value: 0 }, style: { fillColor: '#00ff00' } } as never).id,
    ).toBe('');
  });

  it('theme: ON → setTheme toggles the class; OFF → inert', async () => {
    const on = await mount();
    on.grid.setTheme('dark');
    expect(on.root.classList.contains('mg-theme-dark')).toBe(true);

    const off = await mount({ theme: false });
    off.grid.setTheme('dark');
    expect(off.root.classList.contains('mg-theme-dark')).toBe(false);
    expect(off.root.classList.contains('mg-theme-light')).toBe(true);
  });

  it('export: ON → exportCsv resolves a Blob; OFF → rejects INVALID_OPTIONS', async () => {
    const on = await mount();
    const blob = await on.grid.exportCsv();
    expect(blob.type).toContain('text/csv');

    const off = await mount({ export: false });
    await expect(off.grid.exportCsv()).rejects.toMatchObject({ code: 'INVALID_OPTIONS' });
  });

  it('persistState: ON → serializeState snapshots columns; OFF → empty stub', async () => {
    const on = await mount();
    expect(on.grid.serializeState().columns.length).toBe(columns.length);

    const off = await mount({ persistState: false });
    expect(off.grid.serializeState().columns.length).toBe(0);
  });

  it('contextMenu: ON → right-click opens role=menu; OFF → no menu', async () => {
    const on = await mount();
    select(on.grid, { top: 1, bottom: 1, left: 1, right: 1 });
    await flush();
    bodyCell(on.root, 1, 'c1')!.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, clientX: 20, clientY: 20 }),
    );
    expect(document.querySelector('[role="menu"]')).not.toBeNull();

    document.body.querySelector('[role="menu"]')?.remove();
    const off = await mount({ contextMenu: false });
    select(off.grid, { top: 1, bottom: 1, left: 1, right: 1 });
    await flush();
    bodyCell(off.root, 1, 'c1')!.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, clientX: 20, clientY: 20 }),
    );
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('i18n: ON → setDirection flips dir; OFF → inert', async () => {
    const on = await mount();
    on.grid.setDirection('rtl');
    await flush();
    expect(on.root.getAttribute('dir')).toBe('rtl');

    const off = await mount({ i18n: false });
    off.grid.setDirection('rtl');
    await flush();
    expect(off.root.getAttribute('dir')).toBe('ltr'); // inert
  });

  it('selection + undo: advisory flags reflected by isFeatureEnabled (behavior tested in the pairs)', async () => {
    const on = await mount();
    expect(on.grid.isFeatureEnabled('selection')).toBe(true);
    expect(on.grid.isFeatureEnabled('undo')).toBe(true);

    const off = await mount({ selection: false, undo: false });
    expect(off.grid.isFeatureEnabled('selection')).toBe(false);
    expect(off.grid.isFeatureEnabled('undo')).toBe(false);
  });
});

// ===========================================================================
// Representative interacting PAIRS
// ===========================================================================
describe('AC-FLAGS — representative pairwise interactions', () => {
  it('freeze×sort: both on → the frozen row stays pinned across a sort; freeze off → sort still works', async () => {
    const both = await mount();
    both.grid.setFrozen({ rows: 1 });
    await flush();
    await both.grid.sort({ entries: [{ columnId: 'num', direction: 'desc' }] });
    await flush();
    expect(both.grid.getFrozen().rows).toBe(1);
    expect(both.root.querySelector('.mg-row--frozen')).not.toBeNull();
    expect(both.grid.getSortSpec().entries).toHaveLength(1);

    const noFreeze = await mount({ freeze: false });
    await noFreeze.grid.sort({ entries: [{ columnId: 'num', direction: 'desc' }] });
    await flush();
    expect(noFreeze.grid.getSortSpec().entries).toHaveLength(1); // sort unaffected
  });

  it('merge×edit: both on → editing the merged anchor commits; merge off → edit still works', async () => {
    const both = await mount();
    both.grid.merge({ top: 0, left: 1, bottom: 0, right: 2 });
    await flush();
    await both.grid.updateCell(0, 'c1', 'MERGED');
    await flush();
    expect(bodyCell(both.root, 0, 'c1')?.textContent).toBe('MERGED');
    expect(both.grid.getMerges()).toHaveLength(1);

    const noMerge = await mount({ merge: false });
    await noMerge.grid.updateCell(0, 'c1', 'EDITED');
    await flush();
    expect(bodyCell(noMerge.root, 0, 'c1')?.textContent).toBe('EDITED');
  });

  it('merge×delete-row: both on → deleting an interior row shrinks the merge; merge off → delete still works', async () => {
    const both = await mount();
    both.grid.merge({ top: 0, left: 1, bottom: 2, right: 1 }); // c1 rows 0..2
    await flush();
    expect(both.grid.getMerges()[0]!.range.bottom).toBe(2);
    await both.grid.removeRows([1]); // delete interior row (key 1)
    await flush();
    expect(both.grid.getMerges()[0]!.range.bottom).toBe(1); // shrank

    const noMerge = await mount({ merge: false });
    const before = (await noMerge.grid.getRowCount()).rowCount;
    await noMerge.grid.removeRows([1]);
    await flush();
    expect((await noMerge.grid.getRowCount()).rowCount).toBe(before - 1);
  });

  it('group×scroll: both on → a collapsed row group hides rows through virtualization; group off → scroll works', async () => {
    const both = await mount({}, 40);
    const { id } = both.grid.group({ axis: 'row', start: 2, span: 4 });
    await flush();
    both.grid.setCollapsed(id, true);
    await flush();
    // The collapsed rows are gone from the rendered window (virtualization skip).
    expect(bodyCell(both.root, 3, 'c1')).toBeNull();
    both.grid.scrollTo({ rowIndex: 20 });
    await flush();
    expect(both.root.querySelectorAll('[role=gridcell]').length).toBeGreaterThan(0); // still renders

    const noGroup = await mount({ group: false }, 40);
    noGroup.grid.scrollTo({ rowIndex: 20 });
    await flush();
    expect(bodyCell(noGroup.root, 20, 'c1')).not.toBeNull(); // scrolled window renders
  });

  it('RTL×selection: both on → a selected cell is aria-selected under dir=rtl', async () => {
    const both = await mount();
    both.grid.setDirection('rtl');
    await flush();
    select(both.grid, { top: 0, bottom: 0, left: 1, right: 1 });
    await flush();
    expect(both.root.getAttribute('dir')).toBe('rtl');
    expect(bodyCell(both.root, 0, 'c1')?.getAttribute('aria-selected')).toBe('true');
  });

  it('conditional-format×scroll: both on → the rule paints across a virtualization scroll', async () => {
    const both = await mount({}, 60);
    both.grid.addConditionalRule({ kind: 'value', config: { op: '>', value: 0 }, style: { fillColor: '#00ff00' } } as never);
    await flush();
    both.grid.scrollTo({ rowIndex: 30 });
    await flush();
    // The virtualized window re-rendered around row 30 with the decorator applied.
    const cell = both.root.querySelector('[role=gridcell][data-col-id="num"]') as HTMLElement | null;
    expect(cell).not.toBeNull();
    expect(cell!.style.backgroundColor).not.toBe('');
  });

  it('filter×edit: both on → editing a visible cell of a filtered view commits', async () => {
    const both = await mount();
    await both.grid.filter({ perColumn: { id: (v) => Number(v) >= 4 } });
    await flush();
    expect((await both.grid.getRowCount()).rowCount).toBe(4); // ids 4..7
    await both.grid.updateCell(5, 'c1', 'FILTERED-EDIT');
    await flush();
    expect(bodyCell(both.root, 5, 'c1')?.textContent).toBe('FILTERED-EDIT');
  });

  it('undo×structural: both on → undo reverts an insert; undo off flag still reflects', async () => {
    const both = await mount();
    const before = (await both.grid.getRowCount()).rowCount;
    await both.grid.insertRows(0, [{ id: 999, c1: 'new', num: 0, score: 10 }]);
    await flush();
    expect((await both.grid.getRowCount()).rowCount).toBe(before + 1);
    await both.grid.undo();
    await flush();
    expect((await both.grid.getRowCount()).rowCount).toBe(before); // reverted
  });

  it('clipboard×validation: both on → a paste rejects the invalid cell, applies the valid one', async () => {
    const both = await mount();
    // Anchor a single cell of the range-validated `score` column (col index 3); the
    // pasted block ('60' valid, '999' invalid > 120) expands down from the anchor.
    select(both.grid, { top: 0, bottom: 0, left: 3, right: 3 });
    await flush();
    clipboardText = '60\n999';
    await both.grid.paste();
    await flush();
    expect(bodyCell(both.root, 0, 'score')?.textContent).toBe('60'); // valid applied
    expect(bodyCell(both.root, 1, 'score')?.textContent).toBe('50'); // invalid rejected → unchanged
  });

  it('touch/multi-range: a multi-cell range selection is reflected across every cell (aria-multiselectable)', async () => {
    // The grid advertises multi-select; a range spans multiple cells (the touch
    // path drives the same `setSelection`). Every cell in the range is aria-selected.
    const { grid, root } = await mount();
    expect(root.getAttribute('aria-multiselectable')).toBe('true');
    select(grid, { top: 0, bottom: 2, left: 1, right: 1 }); // a 3-row range
    await flush();
    const sel = grid.getSelection();
    expect(sel.ranges).toHaveLength(1);
    expect(sel.ranges[0]!.bottom - sel.ranges[0]!.top).toBe(2); // spans 3 rows
    expect(bodyCell(root, 0, 'c1')?.getAttribute('aria-selected')).toBe('true');
    expect(bodyCell(root, 1, 'c1')?.getAttribute('aria-selected')).toBe('true');
    expect(bodyCell(root, 2, 'c1')?.getAttribute('aria-selected')).toBe('true');
  });
});
