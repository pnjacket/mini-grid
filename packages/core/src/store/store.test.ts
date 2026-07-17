import { describe, expect, it } from 'vitest';

import { ReactiveStore } from './store.js';
import { GridError } from '../errors.js';

describe('ReactiveStore — PATTERN-REACTIVE-STORE', () => {
  it('coalesces multiple mutations in a tick into one batched notification', async () => {
    const store = new ReactiveStore();
    let notifications = 0;
    store.subscribe(() => notifications++);

    store.setCounts(10, 10);
    store.setCounts(20, 20);
    store.setColumns([{ id: 'a', field: 'a' }]);
    expect(notifications).toBe(0); // nothing synchronous

    await Promise.resolve(); // flush microtask
    expect(notifications).toBe(1);
  });

  it('subscribe returns an unsubscribe', async () => {
    const store = new ReactiveStore();
    let notifications = 0;
    const off = store.subscribe(() => notifications++);
    off();
    store.setCounts(1, 1);
    await Promise.resolve();
    expect(notifications).toBe(0);
  });

  it('INV-COLKEY-UNIQUE: duplicate column id throws DUPLICATE_COLUMN_ID', () => {
    const store = new ReactiveStore();
    expect(() =>
      store.setColumns([
        { id: 'x', field: 'a' },
        { id: 'x', field: 'b' },
      ]),
    ).toThrow(GridError);
  });
});

describe('ReactiveStore.getVisibleColumns — CAP-COLUMN-MANAGE projection', () => {
  it('INV-COLUMN-HIDDEN-EXCLUDED: hidden columns are excluded from the projection; def retained in getColumns', () => {
    const store = new ReactiveStore();
    store.setColumns([
      { id: 'a', field: 'a' },
      { id: 'b', field: 'b', hidden: true },
      { id: 'c', field: 'c' },
    ]);
    expect(store.getVisibleColumns().map((c) => c.id)).toEqual(['a', 'c']);
    // The hidden column's def (id + field) is retained for restore.
    expect(store.getColumns().map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(store.getColumn('b')?.field).toBe('b');
  });

  it('INV-COLUMN-PIN-LEADING: pinned columns form a leading contiguous block (stable within group)', () => {
    const store = new ReactiveStore();
    store.setColumns([
      { id: 'a', field: 'a' },
      { id: 'b', field: 'b', pinned: 'leading' },
      { id: 'c', field: 'c' },
      { id: 'd', field: 'd', pinned: 'leading' },
    ]);
    // b, d hoisted to the leading edge in their existing relative order; a, c follow.
    expect(store.getVisibleColumns().map((c) => c.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('pin + hide compose: hidden filtered out, remaining pinned still lead', () => {
    const store = new ReactiveStore();
    store.setColumns([
      { id: 'a', field: 'a' },
      { id: 'b', field: 'b', pinned: 'leading', hidden: true },
      { id: 'c', field: 'c', pinned: 'leading' },
      { id: 'd', field: 'd' },
    ]);
    expect(store.getVisibleColumns().map((c) => c.id)).toEqual(['c', 'a', 'd']);
  });
});
