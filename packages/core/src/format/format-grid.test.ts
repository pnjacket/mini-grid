// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { createGrid } from '../api/grid.js';
import type { ColumnDef } from '../api/options.js';
import type { CellContext } from '../types.js';

const columns: ColumnDef[] = [
  { id: 'a', field: 'a', header: 'A', width: 90 },
  { id: 'b', field: 'b', header: 'B', width: 90 },
  { id: 'c', field: 'c', header: 'C', width: 90, type: 'number' },
];

function makeRows(n: number): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < n; i++) rows.push({ id: i, a: `a${i}`, b: `b${i}`, c: i });
  return rows;
}

function container(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

function cellAt(el: HTMLElement, rowIndex1: number, colIndex1: number): HTMLElement {
  return el.querySelector(
    `[role=gridcell][aria-rowindex="${rowIndex1}"][aria-colindex="${colIndex1}"]`,
  ) as HTMLElement;
}

/** Let the in-process transport (microtask replies) + async refreshes settle. */
async function flush(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
}

describe('LIB-SET-STYLE — sparse overlay + undo (COMPONENT-FORMAT)', () => {
  it('writes the overlay onto a range and undo restores it', async () => {
    const el = container();
    const grid = createGrid(el, { columns, keyField: 'id' });
    await grid.setData(makeRows(20));

    grid.setStyle(
      { top: 0, left: 1, bottom: 0, right: 1 },
      { textColor: 'rgb(10, 20, 30)', fillColor: '#123456' },
    );
    await flush();

    const cell = cellAt(el, 1, 2); // row 0, column 'b'
    expect(cell.style.color).toBe('rgb(10, 20, 30)');
    expect(cell.style.background).not.toBe('');

    await grid.undo();
    await flush();
    expect(cell.style.color).toBe(''); // overlay removed
    expect(cell.style.background).toBe('');

    grid.destroy();
  });
});

describe('COMPONENT-FORMAT — column defaultStyle (P3 PERF-CELL-PATH guard)', () => {
  it("resolves a column's defaultStyle onto that column's cells; other columns unaffected", async () => {
    const el = container();
    const cols: ColumnDef[] = [
      { id: 'a', field: 'a', width: 90 },
      { id: 'b', field: 'b', width: 90, defaultStyle: { fillColor: '#123456', textColor: 'rgb(9, 8, 7)' } },
    ];
    const grid = createGrid(el, { columns: cols, keyField: 'id' });
    await grid.setData(makeRows(10));
    await flush();

    const bCell = cellAt(el, 1, 2); // row 0, column 'b' (has defaultStyle)
    expect(bCell.style.color).toBe('rgb(9, 8, 7)');
    expect(bCell.style.background).not.toBe(''); // fillColor applied

    const aCell = cellAt(el, 1, 1); // column 'a' — no defaultStyle
    expect(aCell.style.color).toBe('');
    expect(aCell.style.background).toBe('');

    grid.destroy();
  });
});

describe('CAP-COND-FMT — rules resolve to DOM (MSG-AGGREGATE end-to-end)', () => {
  it('a value rule (>) paints a fill on matching cells', async () => {
    const el = container();
    const grid = createGrid(el, { columns, keyField: 'id' });
    await grid.setData(makeRows(20));

    // Column c holds row index; c > 5 → red fill, scoped to column index 2.
    grid.addConditionalRule({
      kind: 'value',
      scope: [{ top: 0, left: 2, bottom: 1000, right: 2 }],
      config: { op: '>', value: 5 },
      style: { fillColor: 'rgb(255, 0, 0)' },
    });
    await flush();

    expect(cellAt(el, 7, 3).style.background).toBe('rgb(255, 0, 0)'); // c=6 > 5
    expect(cellAt(el, 3, 3).style.background).toBe(''); // c=2 not > 5
    grid.destroy();
  });

  it('a colorScale interpolates a fill from full-dataset min/max via the worker', async () => {
    const el = container();
    const grid = createGrid(el, { columns, keyField: 'id' });
    await grid.setData(makeRows(20)); // c ranges 0..19

    grid.addConditionalRule({
      kind: 'colorScale',
      scope: [{ top: 0, left: 2, bottom: 1000, right: 2 }],
      config: { columnId: 'c', min: '#000000', max: '#ffffff' },
    });
    await flush();

    // Row 0 (c=0) → min color; a higher row → a lighter color. Both non-empty,
    // and they differ (the scale actually varied over the dataset range).
    const low = cellAt(el, 1, 3).style.background;
    const high = cellAt(el, 10, 3).style.background;
    expect(low).not.toBe('');
    expect(high).not.toBe('');
    expect(low).not.toBe(high);
    grid.destroy();
  });

  it('a dataBar draws a proportional in-cell bar (DOM node, width %)', async () => {
    const el = container();
    const grid = createGrid(el, { columns, keyField: 'id' });
    await grid.setData(makeRows(20)); // c 0..19, max 19

    grid.addConditionalRule({
      kind: 'dataBar',
      scope: [{ top: 0, left: 2, bottom: 1000, right: 2 }],
      config: { columnId: 'c', color: 'rgb(51, 102, 204)' },
    });
    await flush();

    const bar = cellAt(el, 10, 3).querySelector('[data-mg-databar]') as HTMLElement;
    expect(bar).toBeTruthy();
    expect(bar.style.width).toMatch(/%$/);
    // Larger value → wider bar.
    const wLow = parseFloat((cellAt(el, 2, 3).querySelector('[data-mg-databar]') as HTMLElement).style.width);
    const wHigh = parseFloat((cellAt(el, 15, 3).querySelector('[data-mg-databar]') as HTMLElement).style.width);
    expect(wHigh).toBeGreaterThan(wLow);
    grid.destroy();
  });

  it('an iconSet prepends an icon glyph (textContent, not innerHTML)', async () => {
    const el = container();
    const grid = createGrid(el, { columns, keyField: 'id' });
    await grid.setData(makeRows(20));

    grid.addConditionalRule({
      kind: 'iconSet',
      scope: [{ top: 0, left: 2, bottom: 1000, right: 2 }],
      config: { columnId: 'c', icons: [{ min: 0, icon: '-' }, { min: 10, icon: '+' }] },
    });
    await flush();

    const icon = cellAt(el, 15, 3).querySelector('[data-mg-icon]') as HTMLElement;
    expect(icon).toBeTruthy();
    expect(icon.textContent).toBe('+'); // c=14 ≥ 10
    grid.destroy();
  });

  it('a custom predicate (LIB-CONDFMT-PREDICATE) contributes a style', async () => {
    const el = container();
    const grid = createGrid(el, { columns, keyField: 'id' });
    await grid.setData(makeRows(20));

    grid.addConditionalRule({
      kind: 'custom',
      scope: [{ top: 0, left: 2, bottom: 1000, right: 2 }],
      config: {
        predicate: (c: CellContext) =>
          typeof c.value === 'number' && c.value % 2 === 0 ? { textColor: 'rgb(0, 128, 0)' } : null,
      },
    });
    await flush();

    expect(cellAt(el, 1, 3).style.color).toBe('rgb(0, 128, 0)'); // c=0 even
    expect(cellAt(el, 2, 3).style.color).toBe(''); // c=1 odd
    grid.destroy();
  });
});

describe('SEC-RENDERER-DOM-ONLY — renderers are DOM/string, never innerHTML', () => {
  it('a renderer returning an HTML string is textContent-d (no live DOM, no execution)', async () => {
    const el = container();
    const html = '<img src=x onerror="window.__pwned=1">';
    const cols: ColumnDef[] = [
      { id: 'a', field: 'a', width: 200, renderer: (ctx) => String(ctx.value ?? '') },
    ];
    const grid = createGrid(el, { columns: cols, keyField: 'a' });
    await grid.setData([{ a: html }]);
    await flush();

    const cell = cellAt(el, 1, 1);
    expect(cell.textContent).toBe(html); // rendered as literal text
    expect(cell.querySelector('img')).toBeNull(); // no live element
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    grid.destroy();
  });

  it('a renderer returning a DOM Node appends the node (no HTML sink)', async () => {
    const el = container();
    const cols: ColumnDef[] = [
      {
        id: 'a',
        field: 'a',
        width: 200,
        renderer: (ctx) => {
          const span = document.createElement('span');
          span.className = 'custom-cell';
          span.textContent = String(ctx.value ?? '');
          return span;
        },
      },
    ];
    const grid = createGrid(el, { columns: cols, keyField: 'a' });
    await grid.setData([{ a: 'hi' }]);
    await flush();

    const cell = cellAt(el, 1, 1);
    const span = cell.querySelector('span.custom-cell') as HTMLElement;
    expect(span).toBeTruthy();
    expect(span.textContent).toBe('hi');
    grid.destroy();
  });
});

describe('CAP-THEME — theming + density tokens (LIB-THEME)', () => {
  it('setTheme toggles the theme class', async () => {
    const el = container();
    const grid = createGrid(el, { columns, keyField: 'id', theme: 'light' });
    await grid.setData(makeRows(10));
    const root = el.querySelector('[data-mini-grid]') as HTMLElement;
    expect(root.classList.contains('mg-theme-light')).toBe(true);

    grid.setTheme('dark');
    expect(root.classList.contains('mg-theme-dark')).toBe(true);
    expect(root.classList.contains('mg-theme-light')).toBe(false);
    grid.destroy();
  });

  it('compact density reduces the effective row height vs comfortable', async () => {
    const cEl = container();
    const comfortable = createGrid(cEl, { columns, keyField: 'id', density: 'comfortable' });
    await comfortable.setData(makeRows(20));
    const comfRow = cEl.querySelector('.mg-row') as HTMLElement;
    const comfH = parseInt(comfRow.style.height, 10);

    const kEl = container();
    const compact = createGrid(kEl, { columns, keyField: 'id', density: 'compact' });
    await compact.setData(makeRows(20));
    const root = kEl.querySelector('[data-mini-grid]') as HTMLElement;
    expect(root.classList.contains('mg-density-compact')).toBe(true);
    const compactRow = kEl.querySelector('.mg-row') as HTMLElement;
    const compactH = parseInt(compactRow.style.height, 10);

    expect(compactH).toBeLessThan(comfH); // 22 < 28
    comfortable.destroy();
    compact.destroy();
  });

  it('theming is gated behind the theme feature flag', async () => {
    const el = container();
    const grid = createGrid(el, {
      columns,
      keyField: 'id',
      theme: 'light',
      features: { theme: false },
    });
    await grid.setData(makeRows(10));
    const root = el.querySelector('[data-mini-grid]') as HTMLElement;
    grid.setTheme('dark'); // no-op when the flag is off
    expect(root.classList.contains('mg-theme-dark')).toBe(false);
    expect(root.classList.contains('mg-theme-light')).toBe(true);
    grid.destroy();
  });
});
