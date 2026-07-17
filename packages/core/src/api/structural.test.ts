// @vitest-environment jsdom
/**
 * Slice 4b — structural CRUD (`LIB-INSERT-ROWS`/`-REMOVE-ROWS`/`-COLUMN-CRUD`/
 * `-GET-CHANGES`) + `INV-ROWSTATE` + selection re-clamp (`INV-RANGE-BOUNDS`),
 * driven through the public `Grid` facade against the in-process engine.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { createGrid } from './grid.js';
import type { Grid, ColumnDef } from './options.js';
import type { RowKey } from '../types.js';

const columns: ColumnDef[] = [
  { id: 'id', field: 'id', header: 'ID', width: 80, type: 'number' },
  { id: 'name', field: 'name', header: 'Name', width: 120, type: 'text', editable: true },
  { id: 'age', field: 'age', header: 'Age', width: 60, type: 'number', editable: true },
];

function makeRows(n: number): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < n; i++) rows.push({ id: i, name: `Name ${i}`, age: 20 + i });
  return rows;
}

let mounted: Grid | undefined;

async function makeGrid(rowCount: number): Promise<{ grid: Grid; root: HTMLElement }> {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const grid = createGrid(el, { columns, keyField: 'id', rowHeight: 28, overscan: 4 });
  mounted = grid;
  await grid.setData(makeRows(rowCount));
  const root = el.querySelector('[data-mini-grid]') as HTMLElement;
  return { grid, root };
}

async function rowKeys(grid: Grid, start: number, end: number): Promise<RowKey[]> {
  const res = await grid.getRows({ startIndex: start, endIndex: end });
  return res.rows.map((r) => r.key);
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

describe('LIB-INSERT-ROWS / LIB-REMOVE-ROWS (COMPONENT-DATA-WORKER)', () => {
  it('insertRows updates rowCount + marks inserted rows changeState:new', async () => {
    const { grid } = await makeGrid(5);
    const res = await grid.insertRows(2, [{ id: 'x', name: 'X', age: 99 }]);
    expect(res).toMatchObject({ atIndex: 2, count: 1, rowCount: 6 });
    expect((await grid.getRowCount()).rowCount).toBe(6);
    expect(await rowKeys(grid, 0, 6)).toEqual([0, 1, 'x', 2, 3, 4]);
    const changes = await grid.getChanges();
    expect(changes.new).toContain('x');
  });

  it('removeRows tombstones an existing row (changeState:removed) + drops rowCount', async () => {
    const { grid } = await makeGrid(5);
    const res = await grid.removeRows([1]);
    expect(res.removed).toEqual([1]);
    expect(res.rowCount).toBe(4);
    expect(await rowKeys(grid, 0, 4)).toEqual([0, 2, 3, 4]);
    expect((await grid.getChanges()).removed).toEqual([1]);
  });

  it('INV-ROWSTATE: an inserted (new) row that is removed drops entirely', async () => {
    const { grid } = await makeGrid(5);
    await grid.insertRows(0, [{ id: 'n1', name: 'N', age: 1 }]);
    expect((await grid.getChanges()).new).toContain('n1');

    await grid.removeRows(['n1']);
    const changes = await grid.getChanges();
    expect(changes.new).not.toContain('n1'); // dropped, not tombstoned
    expect(changes.removed).not.toContain('n1');
    expect((await grid.getRowCount()).rowCount).toBe(5);
  });

  it('INV-ROWSTATE: clean → dirty (edit) and clean → removed (delete) transitions', async () => {
    const { grid } = await makeGrid(5);
    await grid.updateCell(0, 'name', 'Edited'); // clean → dirty
    await grid.removeRows([2]); // clean → removed
    const changes = await grid.getChanges();
    expect(changes.dirty).toEqual([0]);
    expect(changes.removed).toEqual([2]);
    expect(changes.new).toEqual([]);
  });

  it('LIB-UNDO: undo of an insert removes the rows again (reverts)', async () => {
    const { grid } = await makeGrid(5);
    await grid.insertRows(1, [{ id: 'z', name: 'Z', age: 5 }]);
    expect((await grid.getRowCount()).rowCount).toBe(6);

    await grid.undo();
    expect((await grid.getRowCount()).rowCount).toBe(5);
    expect(await rowKeys(grid, 0, 5)).toEqual([0, 1, 2, 3, 4]);
    expect((await grid.getChanges()).new).toEqual([]);
  });

  it('LIB-UNDO: undo of a delete restores the row + its prior changeState', async () => {
    const { grid } = await makeGrid(5);
    await grid.removeRows([1, 3]);
    expect(await rowKeys(grid, 0, 3)).toEqual([0, 2, 4]);

    await grid.undo();
    expect(await rowKeys(grid, 0, 5)).toEqual([0, 1, 2, 3, 4]); // restored in place
    expect((await grid.getChanges()).removed).toEqual([]); // back to clean
  });

  it('EVT-BEFORE-DELETE veto aborts the removal (no delete, no EVT-AFTER-DELETE)', async () => {
    const { grid } = await makeGrid(5);
    const after: unknown[] = [];
    grid.on('afterDelete', (e) => after.push(e));
    grid.on('beforeDelete', (e) => e.preventDefault());

    const res = await grid.removeRows([1]);
    expect(res.removed).toEqual([]);
    expect((await grid.getRowCount()).rowCount).toBe(5);
    expect(await rowKeys(grid, 0, 5)).toEqual([0, 1, 2, 3, 4]);
    expect(after).toHaveLength(0);
  });

  it('EVT-BEFORE-INSERT veto aborts the insert', async () => {
    const { grid } = await makeGrid(5);
    grid.on('beforeInsert', (e) => e.preventDefault());
    const res = await grid.insertRows(0, [{ id: 'q', name: 'Q', age: 1 }]);
    expect(res.count).toBe(0);
    expect((await grid.getRowCount()).rowCount).toBe(5);
  });
});

describe('LIB-COLUMN-CRUD (COMPONENT-DATA-WORKER)', () => {
  it('insertColumn adds a blank grid-minted field to every row + a ColumnDef', async () => {
    const { grid, root } = await makeGrid(4);
    const res = await grid.insertColumn(1);
    expect(res.atIndex).toBe(1);
    expect(res.column.id).toBeTruthy();

    // The blank field is present (empty) on every row.
    const field = res.column.field;
    for (let i = 0; i < 4; i++) {
      expect(Object.prototype.hasOwnProperty.call(await rowData(grid, i), field)).toBe(true);
      expect((await rowData(grid, i))[field]).toBeNull();
    }
    // A new columnheader appeared (aria-colcount grew).
    expect(root.getAttribute('aria-colcount')).toBe('4');
    // Insert does not dirty rows.
    expect((await grid.getChanges()).dirty).toEqual([]);
  });

  it('removeColumn deletes the field from every row.data (rows dirty) + drops the ColumnDef', async () => {
    const { grid, root } = await makeGrid(4);
    const res = await grid.removeColumn('age');
    expect(res.removedField).toBe('age');

    for (let i = 0; i < 4; i++) {
      expect(Object.prototype.hasOwnProperty.call(await rowData(grid, i), 'age')).toBe(false);
    }
    // Affected rows became dirty (destructive delete).
    expect((await grid.getChanges()).dirty.sort()).toEqual([0, 1, 2, 3]);
    expect(root.getAttribute('aria-colcount')).toBe('2');
    expect(root.querySelector('[role="columnheader"][data-col-id="age"]')).toBeNull();
  });

  it('LIB-UNDO: undo of removeColumn restores the ColumnDef + the field values, clears dirty', async () => {
    const { grid, root } = await makeGrid(3);
    const before = [await rowData(grid, 0), await rowData(grid, 1), await rowData(grid, 2)].map(
      (d) => d.age,
    );
    await grid.removeColumn('age');
    await grid.undo();

    expect(root.getAttribute('aria-colcount')).toBe('3');
    expect(root.querySelector('[role="columnheader"][data-col-id="age"]')).not.toBeNull();
    for (let i = 0; i < 3; i++) expect((await rowData(grid, i)).age).toBe(before[i]);
    expect((await grid.getChanges()).dirty).toEqual([]);
  });

  it('LIB-UNDO: undo of insertColumn removes the blank column (no dirty rows left)', async () => {
    const { grid, root } = await makeGrid(3);
    const res = await grid.insertColumn(3);
    expect(root.getAttribute('aria-colcount')).toBe('4');

    await grid.undo();
    expect(root.getAttribute('aria-colcount')).toBe('3');
    expect(root.querySelector(`[role="columnheader"][data-col-id="${res.column.id}"]`)).toBeNull();
    expect((await grid.getChanges()).dirty).toEqual([]);
  });
});

describe('LIB-GET-CHANGES', () => {
  it('buckets new / dirty / removed by key', async () => {
    const { grid } = await makeGrid(5);
    await grid.insertRows(5, [{ id: 'new1', name: 'N', age: 1 }]);
    await grid.updateCell(0, 'name', 'Changed');
    await grid.removeRows([2]);

    const changes = await grid.getChanges();
    expect(changes.new).toEqual(['new1']);
    expect(changes.dirty).toEqual([0]);
    expect(changes.removed).toEqual([2]);
  });

  it('without a keyField, still returns best-effort changes + emits a warning on EVT-ERROR', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const grid = createGrid(el, { columns });
    mounted = grid;
    await grid.setData(makeRows(3)); // no keyField → positional identity
    const warnings: string[] = [];
    grid.on('error', (e) => warnings.push(e.error.severity));

    const changes = await grid.getChanges();
    expect(changes).toEqual({ new: [], dirty: [], removed: [] });
    expect(warnings).toContain('warning');
  });
});

describe('Selection re-clamp after structural change (INV-RANGE-BOUNDS)', () => {
  it('deleting a row above the selection shifts + re-clamps the range', async () => {
    const { grid } = await makeGrid(5);
    grid.setSelection({
      ranges: [{ top: 4, left: 1, bottom: 4, right: 1 }],
      activeCell: { rowKey: 4, columnId: 'name' },
      anchor: { row: 4, col: 1 },
    });

    await grid.removeRows([0]); // drop the top row → everything below shifts up
    const r = grid.getSelection().ranges[0];
    expect(r).toEqual({ top: 3, left: 1, bottom: 3, right: 1 });
  });

  it('deleting a column left of the selection shifts + re-clamps the range', async () => {
    const { grid } = await makeGrid(5);
    grid.setSelection({
      ranges: [{ top: 0, left: 2, bottom: 0, right: 2 }],
      activeCell: { rowKey: 0, columnId: 'age' },
      anchor: { row: 0, col: 2 },
    });

    await grid.removeColumn('id'); // drop column 0 → columns shift left
    const r = grid.getSelection().ranges[0];
    expect(r).toEqual({ top: 0, left: 1, bottom: 0, right: 1 });
  });
});
