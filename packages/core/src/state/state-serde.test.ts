// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { createGrid } from '../api/grid.js';
import type { ColumnDef } from '../api/options.js';
import type { GridError } from '../errors.js';
import { GRID_STATE_VERSION, checkStateVersion } from './state-serde.js';

const columns: ColumnDef[] = [
  { id: 'id', field: 'id', header: 'ID', width: 90, type: 'number' },
  { id: 'name', field: 'name', header: 'Name', width: 120, type: 'text' },
  { id: 'amt', field: 'amt', header: 'Amount', width: 80, type: 'number' },
];

const rows = [
  { id: 1, name: 'alpha', amt: 30 },
  { id: 2, name: 'bravo', amt: 10 },
  { id: 3, name: 'charlie', amt: 20 },
];

function container(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

async function flush(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
}

describe('checkStateVersion (versioning)', () => {
  it('accepts the current version, warns on a future one, rejects invalid', () => {
    expect(checkStateVersion(GRID_STATE_VERSION)).toEqual({ ok: true });
    const future = checkStateVersion(GRID_STATE_VERSION + 1);
    expect(future.ok).toBe(true);
    expect(future.warning?.code).toBe('INVALID_OPTIONS');
    expect(future.warning?.severity).toBe('warning');
    const bad = checkStateVersion(0);
    expect(bad.ok).toBe(false);
    expect(bad.warning?.code).toBe('INVALID_OPTIONS');
  });
});

describe('LIB-STATE serialize/restore (COMPONENT-STATE-SERDE / AC-STATE-VERSION)', () => {
  it('serializeState carries version 1 + the layout (not the row data)', async () => {
    const grid = createGrid(container(), { columns, keyField: 'id' });
    await grid.setData(rows);
    await flush();
    const state = grid.serializeState();
    expect(state.version).toBe(1);
    expect(state.columns.map((c) => c.id)).toEqual(['id', 'name', 'amt']);
    // No row data leaks into the state snapshot.
    expect(JSON.stringify(state)).not.toContain('alpha');
  });

  it('round-trips widths / order / sort / filter / frozen / merges / styles', async () => {
    const grid = createGrid(container(), { columns, keyField: 'id' });
    await grid.setData(rows);
    await flush();

    // Build a layout: resize, reorder, sort, filter, freeze, merge, style.
    grid.setColumnWidth('name', 240);
    grid.moveColumn('amt', 0);
    await grid.sort({ entries: [{ columnId: 'amt', direction: 'desc' }] });
    await grid.filter({ perColumn: { amt: (v) => Number(v) >= 20 } });
    grid.setFrozen({ rows: 1, cols: 1 });
    grid.merge({ top: 0, left: 1, bottom: 0, right: 2 });
    grid.setStyle({ top: 0, left: 0, bottom: 0, right: 0 }, { fillColor: '#abcdef' });
    await flush();

    const saved = grid.serializeState();
    expect(saved.columns[0]!.id).toBe('amt'); // reordered
    expect(saved.columns.find((c) => c.id === 'name')!.width).toBe(240);
    expect(saved.sort.entries).toEqual([{ columnId: 'amt', direction: 'desc' }]);
    expect(saved.frozen).toEqual({ rows: 1, cols: 1 });
    expect(saved.merges).toHaveLength(1);
    expect(saved.cellStyles).toHaveLength(1);
    expect(Object.keys(saved.filter.perColumn)).toEqual(['amt']);

    // Mutate the layout away from the snapshot.
    grid.setColumnWidth('name', 60);
    grid.moveColumn('amt', 2);
    await grid.sort({ entries: [] });
    await grid.filter({ perColumn: {} });
    grid.setFrozen({ rows: 0, cols: 0 });
    grid.unmerge({ top: 0, left: 1, bottom: 0, right: 2 });
    await flush();

    // Restore → layout comes back.
    grid.restoreState(saved);
    await flush();

    const after = grid.serializeState();
    expect(after.columns.map((c) => c.id)).toEqual(['amt', 'id', 'name']);
    expect(after.columns.find((c) => c.id === 'name')!.width).toBe(240);
    expect(after.sort.entries).toEqual([{ columnId: 'amt', direction: 'desc' }]);
    expect(after.frozen).toEqual({ rows: 1, cols: 1 });
    expect(after.merges).toHaveLength(1);
    expect(after.cellStyles).toHaveLength(1);
    expect(after.cellStyles[0]!.style.fillColor).toBe('#abcdef');
    expect(Object.keys(after.filter.perColumn)).toEqual(['amt']);
    // The filter is actually applied (charlie=20 + alpha=30 kept; bravo=10 dropped).
    expect((await grid.getRowCount()).rowCount).toBe(2);
  });

  it('an edit survives a serialize→restore of the surrounding layout', async () => {
    const grid = createGrid(container(), { columns, keyField: 'id' });
    await grid.setData(rows);
    await flush();
    await grid.updateCell(1, 'name', 'ALPHA-EDIT');
    grid.setColumnWidth('name', 200);
    await flush();

    const saved = grid.serializeState();
    grid.setColumnWidth('name', 50);
    await flush();
    grid.restoreState(saved);
    await flush();

    expect(grid.serializeState().columns.find((c) => c.id === 'name')!.width).toBe(200);
    // The row edit is unaffected by the layout restore.
    const res = await grid.getRows({ startIndex: 0, endIndex: 1 });
    expect(res.rows[0]!.data.name).toBe('ALPHA-EDIT');
  });

  it('an unknown future GridState.version → INVALID_OPTIONS warning', async () => {
    const errors: GridError[] = [];
    const grid = createGrid(container(), { columns, keyField: 'id' });
    grid.on('error', ({ error }) => errors.push(error));
    await grid.setData(rows);
    await flush();

    const state = grid.serializeState();
    state.version = 999;
    state.columns = [{ id: 'name', width: 333 }];
    grid.restoreState(state);
    await flush();

    expect(errors.some((e) => e.code === 'INVALID_OPTIONS' && e.severity === 'warning')).toBe(true);
    // Best-effort: recognized fields still applied.
    expect(grid.serializeState().columns.find((c) => c.id === 'name')!.width).toBe(333);
  });

  it('serializeState is a no-op shell when the persistState flag is off', async () => {
    const grid = createGrid(container(), {
      columns,
      keyField: 'id',
      features: { persistState: false },
    });
    await grid.setData(rows);
    grid.setColumnWidth('name', 240);
    await flush();
    const state = grid.serializeState();
    expect(state.columns).toEqual([]);
    // restore is a no-op (does not throw).
    expect(() => grid.restoreState(state)).not.toThrow();
  });
});
