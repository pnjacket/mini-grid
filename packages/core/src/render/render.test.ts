// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { createGrid } from '../api/grid.js';
import type { ColumnDef } from '../api/options.js';

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

function container(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

describe('COMPONENT-RENDER (jsdom)', () => {
  it('DOM-ROOT carries role=grid and the full logical aria counts', async () => {
    const el = container();
    const grid = createGrid(el, { columns, keyField: 'id' });
    await grid.setData(makeRows(1000));

    const root = el.querySelector('[data-mini-grid]') as HTMLElement;
    expect(root.getAttribute('role')).toBe('grid');
    expect(root.getAttribute('aria-rowcount')).toBe('1000');
    expect(root.getAttribute('aria-colcount')).toBe('3');
    expect(root.getAttribute('dir')).toBe('ltr');
    grid.destroy();
  });

  it('DOM-HEADER cells are columnheaders with data-col-id', async () => {
    const el = container();
    const grid = createGrid(el, { columns, keyField: 'id' });
    await grid.setData(makeRows(100));
    const headers = el.querySelectorAll('[role="columnheader"]');
    expect(headers.length).toBe(3);
    expect((headers[0] as HTMLElement).getAttribute('data-col-id')).toBe('id');
    grid.destroy();
  });

  it('DOM-CELL: visible cells are gridcells with data-row-key/data-col-id + aria indices', async () => {
    const el = container();
    const grid = createGrid(el, { columns, keyField: 'id' });
    await grid.setData(makeRows(1000));

    const cells = el.querySelectorAll('[role="gridcell"]');
    expect(cells.length).toBeGreaterThan(0);
    const first = cells[0] as HTMLElement;
    expect(first.hasAttribute('data-row-key')).toBe(true);
    expect(first.hasAttribute('data-col-id')).toBe(true);
    expect(first.hasAttribute('aria-rowindex')).toBe(true);
    expect(first.hasAttribute('aria-colindex')).toBe(true);
    grid.destroy();
  });

  it('virtualizes: only a bounded window of cells is in the DOM (not all 1000 rows)', async () => {
    const el = container();
    const grid = createGrid(el, { columns, keyField: 'id', rowHeight: 28, overscan: 4 });
    await grid.setData(makeRows(1000));

    const cells = el.querySelectorAll('[role="gridcell"]');
    // Full grid would be 1000 * 3 = 3000 cells; virtualization keeps it tiny.
    // Window ~= (400/28 + 2*overscan) rows * 3 cols, well under 200.
    expect(cells.length).toBeLessThan(200);
    expect(cells.length).toBeGreaterThan(3);
    grid.destroy();
  });
});
