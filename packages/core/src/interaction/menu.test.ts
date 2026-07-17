// @vitest-environment jsdom
/**
 * `AC-MENU-CONFIG` (v1.4, `CAP-MENU`) — the builder-driven, target-branched
 * context menus. Proves: the zero-config default builder preserves today's cell
 * items + adds the header built-ins (NO regression); a custom `MenuBuilder`
 * branches on `ctx.target.kind` → distinct cell vs header menus; both built-in
 * paths (`builtinItems.*` factory AND a raw `{ command }` id) invoke the behavior;
 * a flag-off built-in auto-hides; an unknown `command` → `INVALID_OPTIONS`; a
 * `custom` item's `render` `Node` is mounted AS-IS (`SEC-MENU-CUSTOM-RENDER`);
 * submenu/toggle/radio render with their roles; `EVT-MENU-OPEN` fires the context.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createGrid } from '../api/grid.js';
import type { Grid, ColumnDef } from '../api/options.js';
import type { MenuBuilder } from '../types.js';
import { builtinItems } from './menu.js';

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

async function makeGrid(opts?: {
  features?: Record<string, boolean>;
  menu?: MenuBuilder | 'default' | false;
}): Promise<{ grid: Grid; root: HTMLElement }> {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const grid = createGrid(el, {
    columns,
    keyField: 'id',
    rowHeight: 28,
    overscan: 4,
    ...(opts?.features ? { features: opts.features } : {}),
    ...(opts?.menu !== undefined ? { menu: opts.menu } : {}),
  });
  mounted = grid;
  await grid.setData(makeRows(6));
  const root = el.querySelector('[data-mini-grid]') as HTMLElement;
  return { grid, root };
}

function menuItems(): HTMLElement[] {
  return [
    ...document.querySelectorAll('[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]'),
  ] as HTMLElement[];
}
function labels(): string[] {
  return menuItems().map((n) => n.textContent ?? '');
}
function itemByText(text: string): HTMLElement | undefined {
  return menuItems().find((n) => (n.textContent ?? '').startsWith(text));
}

afterEach(() => {
  mounted?.destroy();
  mounted = undefined;
  document.body.innerHTML = '';
});

describe('AC-MENU-CONFIG (jsdom)', () => {
  it('zero-config default builder shows today\'s cell items (NO regression)', async () => {
    const { grid } = await makeGrid();
    grid.openMenu({ kind: 'cell', cellRef: { rowKey: 1, columnId: 'name' } });
    const text = labels();
    for (const expected of [
      'Copy',
      'Cut',
      'Paste',
      'Insert row above',
      'Insert row below',
      'Delete row',
      'Insert column left',
      'Insert column right',
      'Delete column',
    ]) {
      expect(text.some((l) => l.startsWith(expected))).toBe(true);
    }
  });

  it('default builder branches: a column-header menu shows the header built-ins', async () => {
    const { grid } = await makeGrid();
    grid.openMenu({ kind: 'column-header', columnId: 'name' });
    const text = labels();
    // Header built-ins from the slice 17-19 commands.
    expect(text.some((l) => l.startsWith('Sort ascending'))).toBe(true);
    expect(text.some((l) => l.startsWith('Filter'))).toBe(true);
    expect(text.some((l) => l.startsWith('Hide column'))).toBe(true);
    expect(text.some((l) => l.startsWith('Pin column'))).toBe(true);
    expect(text.some((l) => l.startsWith('Autofit column'))).toBe(true);
    // Distinct from the cell menu — no clipboard copy on the default header menu.
    expect(text.some((l) => l === 'Copy')).toBe(false);
  });

  it('a custom builder branches on ctx.target.kind → distinct cell vs header menus', async () => {
    const menu: MenuBuilder = (ctx) =>
      ctx.target.kind === 'cell'
        ? [{ kind: 'action', id: 'cell', label: 'CellOnly' }]
        : [{ kind: 'action', id: 'hdr', label: `HeaderOnly:${ctx.target.kind}` }];
    const { grid } = await makeGrid({ menu });

    grid.openMenu({ kind: 'cell', cellRef: { rowKey: 0, columnId: 'name' } });
    expect(labels()).toEqual(['CellOnly']);
    grid.closeMenu();

    grid.openMenu({ kind: 'column-header', columnId: 'name' });
    expect(labels()).toEqual(['HeaderOnly:column-header']);
  });

  it('builtinItems.* factory AND a raw { command } id both invoke the built-in', async () => {
    // Both paths route 'sort-asc' → LIB-SORT (observable via EVT-AFTER-SORT).
    const menu: MenuBuilder = () => [
      builtinItems.sortAsc(),
      { kind: 'action', id: 'raw', command: 'sort-asc', label: 'RawSort' },
    ];
    const { grid } = await makeGrid({ menu });

    // Factory path (builtinItems.sortAsc → { command:'sort-asc' }).
    const sortedFactory = new Promise<void>((res) => grid.on('afterSort', () => res()));
    grid.openMenu({ kind: 'column-header', columnId: 'name' });
    itemByText('Sort ascending')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sortedFactory;
    await flush();

    // Raw { command } id path.
    const sortedRaw = new Promise<void>((res) => grid.on('afterSort', () => res()));
    grid.openMenu({ kind: 'column-header', columnId: 'name' });
    itemByText('RawSort')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sortedRaw;
    await flush();
  });

  it('a built-in whose capability flag is off is auto-hidden', async () => {
    const menu: MenuBuilder = () => [
      builtinItems.hideColumn(),
      { kind: 'action', id: 'keep', handler: () => {}, label: 'KeepMe' },
    ];
    const { grid } = await makeGrid({ features: { columnManage: false }, menu });
    grid.openMenu({ kind: 'column-header', columnId: 'name' });
    // The columnManage-off built-in is absent; the developer handler item stays.
    expect(itemByText('Hide column')).toBeUndefined();
    expect(itemByText('KeepMe')).toBeDefined();
  });

  it('an unknown command string throws INVALID_OPTIONS', async () => {
    const menu: MenuBuilder = () => [{ kind: 'action', id: 'x', command: 'not-a-command', label: 'X' }];
    const { grid } = await makeGrid({ menu });
    expect(() => grid.openMenu({ kind: 'cell', cellRef: { rowKey: 0, columnId: 'name' } })).toThrowError(
      /Unknown menu command/,
    );
  });

  it('SEC-MENU-CUSTOM-RENDER: a custom item render Node is mounted AS-IS', async () => {
    const menu: MenuBuilder = () => [
      {
        kind: 'custom',
        id: 'swatch',
        render: () => {
          const wrap = document.createElement('div');
          const btn = document.createElement('button');
          btn.setAttribute('data-custom-btn', '');
          btn.textContent = 'Pick';
          wrap.appendChild(btn);
          return wrap;
        },
      },
    ];
    const { grid } = await makeGrid({ menu });
    grid.openMenu({ kind: 'cell', cellRef: { rowKey: 0, columnId: 'name' } });
    // The developer-built button is present as a live element (NOT escaped to text).
    const btn = document.querySelector('[data-custom-btn]');
    expect(btn).not.toBeNull();
    expect(btn!.tagName).toBe('BUTTON');
  });

  it('submenu / toggle / radio render with their ARIA roles', async () => {
    const menu: MenuBuilder = () => [
      {
        kind: 'submenu',
        id: 'more',
        label: 'More',
        children: [{ kind: 'action', id: 'child', label: 'Child' }],
      },
      { kind: 'checkbox', id: 'wrap', label: 'Wrap', checked: true },
      { kind: 'radio', id: 'r1', group: 'g', label: 'One', checked: true },
      { kind: 'radio', id: 'r2', group: 'g', label: 'Two' },
    ];
    const { grid } = await makeGrid({ menu });
    grid.openMenu({ kind: 'cell', cellRef: { rowKey: 0, columnId: 'name' } });

    const sub = itemByText('More')!;
    expect(sub.getAttribute('aria-haspopup')).toBe('menu');
    expect(sub.getAttribute('aria-expanded')).toBe('false');

    const check = itemByText('Wrap')!;
    expect(check.getAttribute('role')).toBe('menuitemcheckbox');
    expect(check.getAttribute('aria-checked')).toBe('true');

    const radio = itemByText('One')!;
    expect(radio.getAttribute('role')).toBe('menuitemradio');
    expect(radio.getAttribute('aria-checked')).toBe('true');

    // Open the submenu (→ / click) → a nested role=menu with the child appears.
    sub.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(sub.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelectorAll('[role="menu"]').length).toBe(2);
    expect(itemByText('Child')).toBeDefined();
  });

  it('Space toggles a checkbox without closing the menu', async () => {
    const onToggle = vi.fn();
    const menu: MenuBuilder = () => [{ kind: 'checkbox', id: 'wrap', label: 'Wrap', handler: onToggle }];
    const { grid } = await makeGrid({ menu });
    grid.openMenu({ kind: 'cell', cellRef: { rowKey: 0, columnId: 'name' } });
    const menuEl = document.querySelector('[role="menu"]') as HTMLElement;
    const check = itemByText('Wrap')!;
    check.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(check.getAttribute('aria-checked')).toBe('true');
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(menuEl.isConnected).toBe(true); // still open
  });

  it('EVT-MENU-OPEN fires with the target + resolved items + position', async () => {
    const { grid } = await makeGrid();
    const spy = vi.fn();
    grid.on('menuOpen', spy);
    grid.openMenu({ kind: 'cell', cellRef: { rowKey: 1, columnId: 'name' } }, { x: 12, y: 34 });
    expect(spy).toHaveBeenCalledTimes(1);
    const ev = spy.mock.calls[0][0];
    expect(ev.target).toEqual({ kind: 'cell', cellRef: { rowKey: 1, columnId: 'name' } });
    expect(ev.position).toEqual({ x: 12, y: 34 });
    expect(Array.isArray(ev.items)).toBe(true);
    expect(ev.items.length).toBeGreaterThan(0);
  });

  it('menu:false yields no context menu (openMenu is a no-op)', async () => {
    const { grid } = await makeGrid({ menu: false });
    grid.openMenu({ kind: 'cell', cellRef: { rowKey: 0, columnId: 'name' } });
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
});
