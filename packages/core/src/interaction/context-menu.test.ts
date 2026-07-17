// @vitest-environment jsdom
/**
 * `LAYER-CONTEXT-MENU` + `A11Y-CONTEXT-MENU` — the right-click / keyboard menu
 * over a cell: `role="menu"`, gated CRUD items, enabled clipboard items (slice 7),
 * arrow navigation, Esc-close + focus restore, and item activation → CRUD.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { createGrid } from '../api/grid.js';
import type { Grid, ColumnDef } from '../api/options.js';

const columns: ColumnDef[] = [
  { id: 'id', field: 'id', header: 'ID', width: 80, type: 'number' },
  { id: 'name', field: 'name', header: 'Name', width: 120, type: 'text', editable: true },
];

function makeRows(n: number): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < n; i++) rows.push({ id: i, name: `Name ${i}` });
  return rows;
}

let mounted: Grid | undefined;
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

async function makeGrid(
  rowCount: number,
  features?: Record<string, boolean>,
): Promise<{ grid: Grid; root: HTMLElement }> {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const grid = createGrid(el, {
    columns,
    keyField: 'id',
    rowHeight: 28,
    overscan: 4,
    ...(features ? { features } : {}),
  });
  mounted = grid;
  await grid.setData(makeRows(rowCount));
  const root = el.querySelector('[data-mini-grid]') as HTMLElement;
  return { grid, root };
}

function cellAt(root: HTMLElement, row: number, col: number): HTMLElement {
  return root.querySelector(
    `[role="gridcell"][aria-rowindex="${row + 1}"][aria-colindex="${col + 1}"]`,
  ) as HTMLElement;
}
function openContextMenu(cell: HTMLElement): void {
  cell.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, clientX: 20, clientY: 20 }),
  );
}
function menuOf(_root: HTMLElement): HTMLElement | null {
  // The menu is portaled to <body> (not into role="grid").
  return document.querySelector('[role="menu"]');
}
function items(_root: HTMLElement): HTMLElement[] {
  return [...document.querySelectorAll('[role="menuitem"]')] as HTMLElement[];
}
function itemByText(root: HTMLElement, text: string): HTMLElement {
  return items(root).find((n) => n.textContent === text) as HTMLElement;
}

afterEach(() => {
  mounted?.destroy();
  mounted = undefined;
  document.body.innerHTML = '';
});

describe('LAYER-CONTEXT-MENU (jsdom)', () => {
  it('right-click opens a role=menu with gated items; clipboard items enabled (slice 7)', async () => {
    const { root } = await makeGrid(5);
    openContextMenu(cellAt(root, 1, 1));

    const menu = menuOf(root);
    expect(menu).not.toBeNull();
    expect(menu!.getAttribute('role')).toBe('menu');

    // Copy/cut/paste are enabled behind the `clipboard` flag (slice 7).
    expect(itemByText(root, 'Copy').hasAttribute('aria-disabled')).toBe(false);
    expect(itemByText(root, 'Cut').hasAttribute('aria-disabled')).toBe(false);
    expect(itemByText(root, 'Paste').hasAttribute('aria-disabled')).toBe(false);
    // CRUD items are enabled (editing on) — no aria-disabled.
    expect(itemByText(root, 'Insert row above').hasAttribute('aria-disabled')).toBe(false);
    expect(itemByText(root, 'Delete column').hasAttribute('aria-disabled')).toBe(false);
  });

  it('clipboard items auto-hidden when the clipboard flag is off (CAP-MENU v1.4)', async () => {
    // v1.4 CAP-MENU: a built-in whose capability flag is off is INERT and its item
    // AUTO-HIDES (previously it rendered greyed) — the builder-driven flag-aware model.
    const { root } = await makeGrid(5, { clipboard: false });
    openContextMenu(cellAt(root, 1, 1));
    expect(itemByText(root, 'Copy')).toBeUndefined();
    expect(itemByText(root, 'Cut')).toBeUndefined();
    expect(itemByText(root, 'Paste')).toBeUndefined();
    // The CRUD built-ins (editing on) still render — the menu is not empty.
    expect(itemByText(root, 'Insert row above')).toBeDefined();
  });

  it('A11Y-CONTEXT-MENU: opens focused on the first enabled item; arrows wrap + skip separators', async () => {
    const { root } = await makeGrid(5);
    openContextMenu(cellAt(root, 0, 1));
    const menu = menuOf(root) as HTMLElement;

    // Focus lands on the first ENABLED item — now Copy (clipboard on).
    expect(document.activeElement).toBe(itemByText(root, 'Copy'));

    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(itemByText(root, 'Cut'));

    // ArrowUp from the first item wraps to the last, skipping the separators.
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(document.activeElement).toBe(itemByText(root, 'Copy'));
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(document.activeElement).toBe(itemByText(root, 'Delete column'));
  });

  it('A11Y-CONTEXT-MENU: Esc closes the menu and restores focus to the origin cell', async () => {
    const { root } = await makeGrid(5);
    const origin = cellAt(root, 2, 1);
    openContextMenu(origin);
    const menu = menuOf(root) as HTMLElement;

    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menuOf(root)).toBeNull();
    expect(document.activeElement).toBe(origin);
  });

  it('keyboard-openable via Shift+F10 on the active cell', async () => {
    const { root } = await makeGrid(5);
    const cell = cellAt(root, 1, 1);
    cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true }));
    expect(menuOf(root)).not.toBeNull();
  });

  it('activating "Insert row below" performs the CRUD (rowCount grows)', async () => {
    const { grid, root } = await makeGrid(5);
    expect((await grid.getRowCount()).rowCount).toBe(5);
    openContextMenu(cellAt(root, 0, 1));

    const inserted = new Promise<void>((res) => grid.on('afterInsert', () => res()));
    itemByText(root, 'Insert row below').dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    await inserted;
    await flush();
    expect((await grid.getRowCount()).rowCount).toBe(6);
    expect(menuOf(root)).toBeNull(); // menu closed on activate
  });

  it('gated behind the contextMenu feature flag: disabled ⇒ no menu', async () => {
    const { root } = await makeGrid(5, { contextMenu: false });
    openContextMenu(cellAt(root, 1, 1));
    expect(menuOf(root)).toBeNull();
  });

  it('CRUD items auto-hidden when editing is off (CAP-MENU v1.4 flag-aware)', async () => {
    const { root } = await makeGrid(5, { editing: false });
    openContextMenu(cellAt(root, 1, 1));
    expect(itemByText(root, 'Insert row above')).toBeUndefined();
    expect(itemByText(root, 'Delete row')).toBeUndefined();
    // Copy remains (clipboard on) — the menu still opens with the enabled items.
    expect(itemByText(root, 'Copy')).toBeDefined();
  });
});
