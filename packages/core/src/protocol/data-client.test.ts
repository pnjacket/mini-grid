import { describe, expect, it } from 'vitest';

import { DataClient } from './data-client.js';
import { EngineHost } from './engine-host.js';
import { InProcessTransport } from './transport.js';
import type { DataTransport } from './transport.js';
import type { EngineColumn } from '../engine/index-engine.js';
import type { MainToWorker, WorkerToMain } from './messages.js';

class MockTransport implements DataTransport {
  readonly posted: MainToWorker[] = [];
  private cb: ((msg: WorkerToMain) => void) | undefined;

  post(msg: MainToWorker): void {
    this.posted.push(msg);
  }
  onMessage(cb: (msg: WorkerToMain) => void): void {
    this.cb = cb;
  }
  terminate(): void {}

  /** Simulate a worker reply. */
  emit(msg: WorkerToMain): void {
    this.cb?.(msg);
  }
}

describe('DataClient — PATTERN-WORKER-PROTOCOL', () => {
  it('every outgoing MSG carries a reqId', () => {
    const t = new MockTransport();
    const client = new DataClient(t);
    void client.load([{ id: 1 }], 'id', [{ id: 'id', field: 'id' }], 'reject');
    void client.getRows(0, 10);
    client.queryWindow(0, 10);
    void client.sort({ entries: [] });
    void client.filter({ perColumn: {} });
    expect(t.posted.length).toBe(5);
    for (const msg of t.posted) {
      expect(typeof msg.reqId).toBe('number');
    }
  });

  it('resolves getRows by reqId (explicit read)', async () => {
    const t = new MockTransport();
    const client = new DataClient(t);
    const p = client.getRows(0, 2);
    const sent = t.posted[0]!;
    t.emit({
      kind: 'window',
      reqId: sent.reqId,
      startIndex: 0,
      rows: [{ key: 1, data: { id: 1 } }],
      version: 1,
    });
    const res = await p;
    expect(res.startIndex).toBe(0);
    expect(res.rows.map((r) => r.key)).toEqual([1]);
  });

  it('drops a superseded-version MSG-WINDOW reply (coalesced viewport path)', () => {
    const t = new MockTransport();
    const client = new DataClient(t);
    const seen: number[] = [];
    client.onWindow((win) => seen.push(win.version));

    // A mutation bumps the index version to 2.
    t.emit({
      kind: 'index-summary',
      version: 2,
      rowCount: 100,
      totalRowCount: 100,
    });
    expect(client.version).toBe(2);

    // A window computed at version 1 arrives late for a coalesced query -> dropped.
    client.queryWindow(0, 10);
    const staleReqId = t.posted[t.posted.length - 1]!.reqId;
    t.emit({
      kind: 'window',
      reqId: staleReqId,
      startIndex: 0,
      rows: [{ key: 0, data: {} }],
      version: 1,
    });
    expect(client.droppedWindowCount).toBe(1);
    expect(seen).toEqual([]);

    // A fresh window at the current version is delivered.
    client.queryWindow(0, 10);
    const freshReqId = t.posted[t.posted.length - 1]!.reqId;
    t.emit({
      kind: 'window',
      reqId: freshReqId,
      startIndex: 0,
      rows: [{ key: 0, data: {} }],
      version: 2,
    });
    expect(client.droppedWindowCount).toBe(1);
    expect(seen).toEqual([2]);
  });

  it('maps MSG-ERROR to a rejected GridError with the catalog source', async () => {
    const t = new MockTransport();
    const client = new DataClient(t);
    const p = client.load([], null, [], 'reject');
    const sent = t.posted[0]!;
    t.emit({
      kind: 'error',
      reqId: sent.reqId,
      code: 'DUPLICATE_ROW_KEY',
      message: 'Duplicate row key: x',
    });
    await expect(p).rejects.toMatchObject({
      code: 'DUPLICATE_ROW_KEY',
      source: 'config',
    });
  });
});

describe('DataClient — sort/filter seam routing (ADR-SORT-FILTER-SEAM)', () => {
  const rows = [
    { id: 'a', name: 'Charlie', age: 30 },
    { id: 'b', name: 'Alice', age: 25 },
    { id: 'c', name: 'Bob', age: 40 },
  ];
  const wireCols = [
    { id: 'name', field: 'name', type: 'text' as const },
    { id: 'age', field: 'age', type: 'number' as const },
  ];

  /** A client over the REAL in-process engine + a registered view context. */
  async function setup(columns: EngineColumn[]): Promise<DataClient> {
    const client = new DataClient(new InProcessTransport(new EngineHost()));
    client.setViewContext({ columns: () => columns, keyField: () => 'id' });
    await client.load(rows, 'id', wireCols, 'reject');
    return client;
  }

  const plainCols: EngineColumn[] = [
    { id: 'name', field: 'name', type: 'text' },
    { id: 'age', field: 'age', type: 'number' },
  ];

  it('a serializable BuiltinFilter runs on the WORKER (off-thread) and filters correctly', async () => {
    const client = await setup(plainCols);
    const res = await client.filter({ perColumn: { age: { op: 'gt', value: 28 } } });
    expect(client.lastViewPath).toBe('worker');
    expect(client.workerViewOps).toBe(1);
    expect(res.rowCount).toBe(2);
    const win = await client.getRows(0, 10);
    expect(win.rows.map((r) => r.key)).toEqual(['a', 'c']);
  });

  it('a custom FilterPredicate function runs MAIN-THREAD and still filters correctly', async () => {
    const client = await setup(plainCols);
    const res = await client.filter({
      perColumn: { age: (v) => typeof v === 'number' && v >= 30 },
    });
    expect(client.lastViewPath).toBe('main');
    expect(client.mainThreadViewOps).toBe(1);
    expect(res.rowCount).toBe(2);
    const win = await client.getRows(0, 10);
    expect(win.rows.map((r) => r.key)).toEqual(['a', 'c']);
  });

  it('a custom comparator column runs MAIN-THREAD and still sorts correctly', async () => {
    const client = await setup([
      { id: 'name', field: 'name', type: 'text', comparator: (a, b) => String(a).length - String(b).length },
      { id: 'age', field: 'age', type: 'number' },
    ]);
    await client.sort({ entries: [{ columnId: 'name', direction: 'asc' }] });
    expect(client.lastViewPath).toBe('main');
    const win = await client.getRows(0, 3);
    expect(win.rows.map((r) => r.data.name)).toEqual(['Bob', 'Alice', 'Charlie']);
  });

  it('MIXING a custom fn into an otherwise-built-in spec forces the MAIN-THREAD path (AND-combined)', async () => {
    const client = await setup(plainCols);
    // age > 20 (built-in) AND name startsWith "B" (custom fn) → only Bob (age 40).
    const res = await client.filter({
      perColumn: {
        age: { op: 'gt', value: 20 },
        name: (v) => String(v).startsWith('B'),
      },
    });
    expect(client.lastViewPath).toBe('main');
    expect(res.rowCount).toBe(1);
    const win = await client.getRows(0, 10);
    expect(win.rows.map((r) => r.key)).toEqual(['c']);
  });

  it('switching from a custom-fn filter back to a built-in one returns to the WORKER path', async () => {
    const client = await setup(plainCols);
    await client.filter({ perColumn: { age: (v) => Number(v) >= 30 } });
    expect(client.lastViewPath).toBe('main');
    // Replace with a built-in descriptor → back off-thread, correct result.
    const res = await client.filter({ perColumn: { age: { op: 'lt', value: 35 } } });
    expect(client.lastViewPath).toBe('worker');
    expect(res.rowCount).toBe(2);
    const win = await client.getRows(0, 10);
    expect(win.rows.map((r) => r.key)).toEqual(['a', 'b']);
  });
});
