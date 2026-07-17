// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { createGrid } from '../api/grid.js';
import type { ColumnDef } from '../api/options.js';

const columns: ColumnDef[] = [
  { id: 'id', field: 'id', header: 'ID', width: 80 },
  {
    id: 'name',
    field: 'name',
    header: 'Name',
    width: 120,
    type: 'text',
    editable: true,
    validation: [{ kind: 'regex', pattern: '^A', message: 'Must start with A' }],
  },
  { id: 'age', field: 'age', header: 'Age', width: 60, type: 'number', editable: true },
];

function makeRows(n: number): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < n; i++) rows.push({ id: i, name: `A${i}`, age: 20 + (i % 40) });
  return rows;
}

function container(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

/** Drain microtasks + one macrotask so the announcer's coalescing flush runs. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const politeText = (el: HTMLElement): string =>
  el.querySelector('[data-mg-live="polite"]')?.textContent ?? '';
const assertiveText = (el: HTMLElement): string =>
  el.querySelector('[data-mg-live="assertive"]')?.textContent ?? '';
const root = (el: HTMLElement): HTMLElement => el.querySelector('[data-mini-grid]') as HTMLElement;

describe('A11Y-GRID announcement wiring (jsdom)', () => {
  it('sort settle → POLITE "Sorted by …" with no focus move', async () => {
    const el = container();
    const grid = createGrid(el, { columns, keyField: 'id' });
    await grid.setData(makeRows(50));
    await settle();
    expect(politeText(el)).toBe(''); // setData does not announce

    const before = document.activeElement;
    await grid.sort({ entries: [{ columnId: 'age', direction: 'desc' }] });
    await settle();

    const text = politeText(el);
    expect(text).toContain('Sorted by');
    expect(text).toContain('Age');
    expect(text).toContain('descending');
    expect(text).toContain('rows');
    // Announcing never steals focus.
    expect(document.activeElement).toBe(before);
    grid.destroy();
  });

  it('filter settle → POLITE "Filtered, N of total"', async () => {
    const el = container();
    const grid = createGrid(el, { columns, keyField: 'id' });
    await grid.setData(makeRows(20));
    await grid.filter({ perColumn: { age: (v) => Number(v) >= 40 } });
    await settle();
    expect(politeText(el)).toContain('Filtered,');
    expect(politeText(el)).toContain('of 20');
    grid.destroy();
  });

  it('validation error → ASSERTIVE region', async () => {
    const el = container();
    const grid = createGrid(el, { columns, keyField: 'id' });
    await grid.setData(makeRows(10));
    await expect(grid.updateCell(0, 'name', 'zzz')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await settle();
    expect(assertiveText(el)).toContain('Invalid:');
    expect(assertiveText(el)).toContain('Must start with A');
    // A validation error is not a polite announcement.
    expect(politeText(el)).toBe('');
    grid.destroy();
  });

  it('edit commit → NO announcement by default', async () => {
    const el = container();
    const grid = createGrid(el, { columns, keyField: 'id' });
    await grid.setData(makeRows(10));
    await grid.updateCell(0, 'name', 'Alice');
    await settle();
    expect(politeText(el)).toBe('');
    grid.destroy();
  });

  it('edit commit → announces POLITE when announceEdits:true', async () => {
    const el = container();
    const grid = createGrid(el, { columns, keyField: 'id', announceEdits: true });
    await grid.setData(makeRows(10));
    await grid.updateCell(0, 'name', 'Alice');
    await settle();
    expect(politeText(el)).toContain('Name');
    expect(politeText(el)).toContain('Alice');
    grid.destroy();
  });

  it('row insert / delete → POLITE row-count announcements', async () => {
    const el = container();
    const grid = createGrid(el, { columns, keyField: 'id' });
    await grid.setData(makeRows(10));
    await grid.insertRows(0, [{ id: 900, name: 'A900', age: 22 }]);
    await settle();
    expect(politeText(el)).toContain('inserted');

    await grid.removeRows([900]);
    await settle();
    expect(politeText(el)).toContain('removed');
    grid.destroy();
  });

  it('EXCLUSIONS: scroll / selection-move / window-arrival produce NO announcement', async () => {
    const el = container();
    const grid = createGrid(el, { columns, keyField: 'id', rowHeight: 28 });
    await grid.setData(makeRows(500));
    await settle();
    expect(politeText(el)).toBe('');
    expect(assertiveText(el)).toBe('');

    // Window arrival (virtualization repaint) via a programmatic scroll.
    grid.scrollTo({ rowIndex: 300 });
    await settle();
    // A raw scroll event on the scroll container.
    const scrollEl = el.querySelector('.mg-scroll') as HTMLElement;
    scrollEl.dispatchEvent(new Event('scroll'));
    await settle();
    // Per-keystroke selection movement.
    grid.setSelection({
      ranges: [{ top: 5, bottom: 5, left: 0, right: 0 }],
      anchor: { row: 5, col: 0 },
      activeCell: null,
    });
    await settle();

    expect(politeText(el)).toBe('');
    expect(assertiveText(el)).toBe('');
    grid.destroy();
  });

  it('aria-busy toggles on DOM-ROOT during an async data op', async () => {
    const el = container();
    const grid = createGrid(el, { columns, keyField: 'id' });
    await grid.setData(makeRows(30));
    // Idle carries no busy state once settled.
    expect(root(el).hasAttribute('aria-busy')).toBe(false);

    const p = grid.sort({ entries: [{ columnId: 'age', direction: 'asc' }] });
    // The op is pending synchronously after the call → aria-busy set.
    expect(root(el).getAttribute('aria-busy')).toBe('true');
    await p;
    // Cleared on settle.
    expect(root(el).hasAttribute('aria-busy')).toBe(false);
    grid.destroy();
  });

  it('grid.announce() exposes the live region to the host without moving focus', async () => {
    const el = container();
    const grid = createGrid(el, { columns, keyField: 'id' });
    await grid.setData(makeRows(5));
    const before = document.activeElement;
    grid.announce('Custom polite update');
    grid.announce('Custom error', { assertive: true });
    await settle();
    expect(politeText(el)).toBe('Custom polite update');
    expect(assertiveText(el)).toBe('Custom error');
    expect(document.activeElement).toBe(before);
    grid.destroy();
  });
});
