// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { createGrid } from './grid.js';
import { GridError } from '../errors.js';
import type { ColumnDef } from './options.js';

const columns: ColumnDef[] = [
  { id: 'id', field: 'id' },
  { id: 'name', field: 'name' },
];

function container(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    return err instanceof GridError ? err.code : `not-grid-error:${String(err)}`;
  }
  return undefined;
}

describe('Invariants (enforced + asserted)', () => {
  it('INV-COLKEY-UNIQUE: duplicate column id throws DUPLICATE_COLUMN_ID', () => {
    const dup: ColumnDef[] = [
      { id: 'x', field: 'a' },
      { id: 'x', field: 'b' },
    ];
    expect(codeOf(() => createGrid(container(), { columns: dup }))).toBe(
      'DUPLICATE_COLUMN_ID',
    );
  });

  it('INV-ROWKEY-UNIQUE: duplicate row key throws DUPLICATE_ROW_KEY (default reject)', async () => {
    const grid = createGrid(container(), { columns, keyField: 'id' });
    await expect(
      grid.setData([
        { id: 'a', name: 'first' },
        { id: 'a', name: 'second' },
      ]),
    ).rejects.toMatchObject({ code: 'DUPLICATE_ROW_KEY', source: 'config' });
    grid.destroy();
  });

  it('INV-ROWKEY-UNIQUE: onDuplicateKey last-wins overwrites and dedups the count', async () => {
    const grid = createGrid(container(), {
      columns,
      keyField: 'id',
      onDuplicateKey: 'last-wins',
    });
    const res = await grid.setData([
      { id: 'a', name: 'first' },
      { id: 'a', name: 'second' },
      { id: 'b', name: 'other' },
    ]);
    expect(res.rowCount).toBe(2); // deduped
    const rows = (await grid.getRows({ startIndex: 0, endIndex: 2 })).rows;
    const a = rows.find((r) => r.key === 'a');
    expect(a?.data.name).toBe('second'); // later row wins
    grid.destroy();
  });
});
