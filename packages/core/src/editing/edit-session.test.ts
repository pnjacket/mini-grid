// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { createGrid } from '../api/grid.js';
import type { Grid, ColumnDef } from '../api/options.js';
import type { CellRef } from '../types.js';

const columns: ColumnDef[] = [
  { id: 'id', field: 'id', header: 'ID', width: 80 },
  { id: 'name', field: 'name', header: 'Name', width: 120, type: 'text', editable: true },
  {
    id: 'age',
    field: 'age',
    header: 'Age',
    width: 60,
    type: 'number',
    editable: true,
    validation: [{ kind: 'required' }, { kind: 'range', min: 0, max: 120 }],
  },
  { id: 'active', field: 'active', header: 'Active', width: 70, type: 'boolean', editable: true },
  {
    id: 'grade',
    field: 'grade',
    header: 'Grade',
    width: 90,
    type: 'select',
    editable: true,
    editor: { kind: 'select', options: [{ value: 'A' }, { value: 'B' }, { value: 'C' }] },
  },
];

function makeRows(n: number): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < n; i++) rows.push({ id: i, name: `Name ${i}`, age: 20, active: false, grade: 'B' });
  return rows;
}

let mounted: Grid | undefined;
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

async function makeGrid(rowCount: number): Promise<{ grid: Grid; root: HTMLElement }> {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const grid = createGrid(el, { columns, keyField: 'id', rowHeight: 28, overscan: 4 });
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
function clickCell(cell: HTMLElement): void {
  cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
}
function pressKey(target: HTMLElement, key: string, mods: KeyboardEventInit = {}): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...mods }));
}
function editorInput(root: HTMLElement): HTMLInputElement {
  return root.querySelector('[data-mg-editor] input') as HTMLInputElement;
}
async function rowData(grid: Grid, index: number): Promise<Record<string, unknown>> {
  const res = await grid.getRows({ startIndex: index, endIndex: index + 1 });
  return res.rows[0]!.data as Record<string, unknown>;
}

afterEach(() => {
  mounted?.destroy();
  mounted = undefined;
  document.body.innerHTML = '';
});

describe('COMPONENT-EDIT (jsdom) — cell edit lifecycle', () => {
  it('DOM-CELL: editable cells reflect aria-readonly per column.editable + feature', async () => {
    const { root } = await makeGrid(20);
    expect(cellAt(root, 0, 0).getAttribute('aria-readonly')).toBe('true'); // id
    expect(cellAt(root, 0, 1).getAttribute('aria-readonly')).toBe('false'); // name (editable)
  });

  it('begin (F2) → type → commit (Enter) updates row.data + fires EVT-AFTER-EDIT', async () => {
    const { grid, root } = await makeGrid(20);
    const after: Array<{ cell: CellRef; oldValue: unknown; newValue: unknown }> = [];
    const begins: CellRef[] = [];
    grid.on('afterEdit', (e) => after.push(e));
    grid.on('editBegin', (e) => begins.push(e.cell));

    clickCell(cellAt(root, 0, 1));
    pressKey(root, 'F2');
    await flush();

    const input = editorInput(root);
    expect(input).not.toBeNull();
    expect(begins).toEqual([{ rowKey: 0, columnId: 'name' }]);
    input.value = 'Zed';
    pressKey(input, 'Enter');
    await flush();

    expect((await rowData(grid, 0)).name).toBe('Zed');
    expect(cellAt(root, 0, 1).textContent).toBe('Zed');
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      cell: { rowKey: 0, columnId: 'name' },
      oldValue: 'Name 0',
      newValue: 'Zed',
    });
    expect(root.querySelector('[data-mg-editor]')).toBeNull(); // editor closed
  });

  it('double-click opens the editor (LAYER-EDITOR trigger)', async () => {
    const { root } = await makeGrid(20);
    const cell = cellAt(root, 0, 1);
    clickCell(cell);
    cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await flush();
    expect(root.querySelector('[data-mg-editor]')).not.toBeNull();
  });

  it('INV-EDIT-SINGLE: a second beginEdit resolves (commits) the first session', async () => {
    const { grid, root } = await makeGrid(20);
    clickCell(cellAt(root, 0, 1));
    pressKey(root, 'F2');
    await flush();
    editorInput(root).value = 'First';

    // Open a second editor while the first is active — the first must resolve.
    grid.beginEdit({ rowKey: 1, columnId: 'name' });
    await flush();
    await flush();

    expect((await rowData(grid, 0)).name).toBe('First'); // first committed
    // Exactly one editor open (the second) — the single-slot invariant holds.
    expect(root.querySelectorAll('[data-mg-editor]')).toHaveLength(1);
  });

  it('validation reject: invalid value → VALIDATION_FAILED + EVT-VALIDATION-ERROR, stays editing', async () => {
    const { grid, root } = await makeGrid(20);
    const errs: Array<{ cell: CellRef; error: { code: string } }> = [];
    grid.on('validationError', (e) => errs.push(e as never));

    clickCell(cellAt(root, 0, 2)); // age (has range 0..120)
    pressKey(root, 'F2');
    await flush();
    const input = editorInput(root);
    input.value = '999';
    pressKey(input, 'Enter');
    await flush();

    expect(errs).toHaveLength(1);
    expect(errs[0]!.error.code).toBe('VALIDATION_FAILED');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBeTruthy();
    expect(root.querySelector('.mg-validation-tip')?.textContent).toBeTruthy();
    expect(root.querySelector('[data-mg-editor]')).not.toBeNull(); // still editing
    expect((await rowData(grid, 0)).age).toBe(20); // unchanged

    // Correcting the value and committing clears the rejection.
    input.value = '45';
    pressKey(input, 'Enter');
    await flush();
    expect(root.querySelector('[data-mg-editor]')).toBeNull();
    expect((await rowData(grid, 0)).age).toBe(45);
  });

  it('cancel (Esc) discards the draft and restores focus to the cell', async () => {
    const { grid, root } = await makeGrid(20);
    const cancels: CellRef[] = [];
    grid.on('editCancel', (e) => cancels.push(e.cell));

    clickCell(cellAt(root, 0, 1));
    pressKey(root, 'F2');
    await flush();
    const input = editorInput(root);
    input.value = 'Discarded';
    pressKey(input, 'Escape');
    await flush();

    expect(root.querySelector('[data-mg-editor]')).toBeNull();
    expect((await rowData(grid, 0)).name).toBe('Name 0'); // unchanged
    expect(cancels).toEqual([{ rowKey: 0, columnId: 'name' }]);
    expect(document.activeElement).toBe(cellAt(root, 0, 1)); // focus restored
  });

  it('LIB-UPDATE-CELL resolves the documented result object + fires EVT-AFTER-EDIT', async () => {
    const { grid } = await makeGrid(20);
    const after: Array<{ oldValue: unknown; newValue: unknown }> = [];
    grid.on('afterEdit', (e) => after.push(e));

    const res = await grid.updateCell(0, 'name', 'Prog');
    expect(res).toEqual({
      rowKey: 0,
      columnId: 'name',
      oldValue: 'Name 0',
      newValue: 'Prog',
      changeState: 'dirty',
    });
    expect((await rowData(grid, 0)).name).toBe('Prog');
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ oldValue: 'Name 0', newValue: 'Prog' });
  });

  it('EVT-BEFORE-EDIT veto aborts the edit (no apply, no EVT-AFTER-EDIT)', async () => {
    const { grid } = await makeGrid(20);
    const after: unknown[] = [];
    grid.on('afterEdit', (e) => after.push(e));
    grid.on('beforeEdit', (e) => e.preventDefault());

    const res = await grid.updateCell(0, 'name', 'Vetoed');
    expect(after).toHaveLength(0); // no after-event
    expect((await rowData(grid, 0)).name).toBe('Name 0'); // unchanged
    expect(res.newValue).toBe('Name 0'); // no-op result echoes old value
    expect(res.changeState).toBe('clean');
  });

  it('LIB-UNDO/-REDO: an edit is one command; undo reverts, redo re-applies', async () => {
    const { grid } = await makeGrid(20);
    await grid.updateCell(0, 'age', 30);
    expect((await rowData(grid, 0)).age).toBe(30);

    await grid.undo();
    expect((await rowData(grid, 0)).age).toBe(20);

    await grid.redo();
    expect((await rowData(grid, 0)).age).toBe(30);
  });

  it('CE-BOOL-COMMIT: checkbox `change` commits the toggle immediately (no blur)', async () => {
    const { grid, root } = await makeGrid(20);
    const after: Array<{ oldValue: unknown; newValue: unknown }> = [];
    grid.on('afterEdit', (e) => after.push(e));

    const cell = cellAt(root, 0, 3); // `active` (boolean)
    clickCell(cell);
    pressKey(root, 'F2');
    await flush();

    const box = root.querySelector(
      '[data-mg-editor] input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(box).not.toBeNull();
    expect(box.checked).toBe(false); // seeded from initialValue

    // A pointer-down on the checkbox must NOT bubble to the interaction layer
    // (whose "commit while editing" would fire on the STALE value first).
    box.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    // The click toggles the box and fires `change` — immediate-commit applies it.
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();

    expect((await rowData(grid, 0)).active).toBe(true); // toggle persisted
    expect((await grid.getChanges()).dirty).toContain(0); // changeState dirty
    expect(after).toHaveLength(1); // EVT-AFTER-EDIT fired once
    expect(after[0]).toMatchObject({ oldValue: false, newValue: true });
    expect(root.querySelector('[data-mg-editor]')).toBeNull(); // committed + closed

    // A late blur/commit after the change must NOT double-commit or revert.
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    await flush();
    expect(after).toHaveLength(1);
    expect((await rowData(grid, 0)).active).toBe(true);
  });

  it('CE-BOOL-COMMIT: Space toggles the checkbox (commits via change)', async () => {
    const { grid, root } = await makeGrid(20);
    const cell = cellAt(root, 0, 3);
    clickCell(cell);
    pressKey(root, 'F2');
    await flush();
    const box = root.querySelector(
      '[data-mg-editor] input[type="checkbox"]',
    ) as HTMLInputElement;
    // Space toggles a focused checkbox natively; emulate the resulting change.
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect((await rowData(grid, 0)).active).toBe(true);
  });

  it('CE-SELECT-POPOVER: select editor mounts a listbox popover OUTSIDE the cell + commits a pick', async () => {
    const { grid, root } = await makeGrid(20);
    const cell = cellAt(root, 0, 4); // `grade` (select)
    clickCell(cell);
    pressKey(root, 'F2');
    await flush();

    const popover = document.querySelector('[data-mg-select-popover]') as HTMLElement;
    expect(popover).not.toBeNull();
    expect(popover.getAttribute('role')).toBe('listbox');
    // The options list escapes the cell's clipped subtree (portaled to <body>).
    expect(cell.contains(popover)).toBe(false);
    expect(popover.parentElement).toBe(document.body);
    expect(cell.getAttribute('aria-expanded')).toBe('true'); // trigger expanded
    expect(popover.querySelectorAll('[role="option"]')).toHaveLength(3);

    // Pick "C" (index 2) — a click commits the new value.
    const opt = popover.querySelectorAll('[role="option"]')[2] as HTMLElement;
    opt.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();

    expect((await rowData(grid, 0)).grade).toBe('C');
    expect(document.querySelector('[data-mg-select-popover]')).toBeNull(); // dismissed
    expect(cellAt(root, 0, 4).getAttribute('aria-expanded')).toBeNull(); // collapsed
  });

  it('CE-SELECT-POPOVER: Esc cancels the select + restores focus to the cell', async () => {
    const { grid, root } = await makeGrid(20);
    const cell = cellAt(root, 0, 4);
    clickCell(cell);
    pressKey(root, 'F2');
    await flush();

    const popover = document.querySelector('[data-mg-select-popover]') as HTMLElement;
    popover.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush();

    expect(document.querySelector('[data-mg-select-popover]')).toBeNull();
    expect((await rowData(grid, 0)).grade).toBe('B'); // unchanged
    expect(document.activeElement).toBe(cellAt(root, 0, 4)); // focus restored
  });

  it('CE-SELECT-POPOVER: ArrowDown + Enter commits the highlighted option', async () => {
    const { grid, root } = await makeGrid(20);
    const cell = cellAt(root, 0, 4);
    clickCell(cell);
    pressKey(root, 'F2');
    await flush();

    const popover = document.querySelector('[data-mg-select-popover]') as HTMLElement;
    // Current value 'B' (index 1) → ArrowDown → 'C' (index 2) → Enter commits.
    popover.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    popover.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();

    expect((await rowData(grid, 0)).grade).toBe('C');
    expect(document.querySelector('[data-mg-select-popover]')).toBeNull();
  });

  it('editing gated behind the feature flag: disabled ⇒ aria-readonly + no editor', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const grid = createGrid(el, {
      columns,
      keyField: 'id',
      features: { editing: false },
    });
    mounted = grid;
    await grid.setData(makeRows(20));
    const root = el.querySelector('[data-mini-grid]') as HTMLElement;

    expect(cellAt(root, 0, 1).getAttribute('aria-readonly')).toBe('true');
    clickCell(cellAt(root, 0, 1));
    pressKey(root, 'F2');
    await flush();
    expect(root.querySelector('[data-mg-editor]')).toBeNull(); // trigger inert
  });
});
