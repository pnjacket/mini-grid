// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createGrid } from './grid.js';
import { EngineHost } from '../protocol/engine-host.js';
import { InProcessTransport } from '../protocol/transport.js';
import type {
  CrashInfo,
  DataTransport,
} from '../protocol/transport.js';
import type { MainToWorker, WorkerToMain } from '../protocol/messages.js';
import type { GridError } from '../errors.js';
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

/**
 * A transport whose `EngineHost` handles ops normally, but can be told to fail
 * the next non-load op with an `MSG-ERROR` (WORKER_OP_FAILED) or to crash.
 */
class FakeTransport implements DataTransport {
  private readonly host = new EngineHost();
  private msgCb: ((msg: WorkerToMain) => void) | undefined;
  private crashCb: ((info: CrashInfo) => void) | undefined;
  failNext = false;

  post(msg: MainToWorker): void {
    if (this.failNext && msg.kind !== 'load') {
      this.failNext = false;
      queueMicrotask(() =>
        this.msgCb?.({
          kind: 'error',
          reqId: msg.reqId,
          code: 'WORKER_OP_FAILED',
          message: 'boom',
        }),
      );
      return;
    }
    const replies = this.host.handle(msg);
    queueMicrotask(() => {
      for (const reply of replies) this.msgCb?.(reply);
    });
  }
  onMessage(cb: (msg: WorkerToMain) => void): void {
    this.msgCb = cb;
  }
  onCrash(cb: (info: CrashInfo) => void): void {
    this.crashCb = cb;
  }
  crash(message = 'boom'): void {
    this.crashCb?.({ message });
  }
  terminate(): void {}
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AC-ERR-TYPE — routed async error rejects AND emits EVT-ERROR (never console-only)', () => {
  it('a data-op worker error rejects the op with a GridError and fires EVT-ERROR', async () => {
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const transport = new FakeTransport();
    const grid = createGrid(container(), {
      columns,
      keyField: 'id',
      createTransport: () => transport,
    });
    const errors: GridError[] = [];
    grid.on('error', (e) => errors.push(e.error));

    await grid.setData([{ id: 1, name: 'a' }]);

    transport.failNext = true;
    const op = grid.getRows({ startIndex: 0, endIndex: 10 });

    await expect(op).rejects.toMatchObject({
      code: 'WORKER_OP_FAILED',
      source: 'data-op',
    });
    // EVT-ERROR fired with the same GridError (assert BOTH surfaces).
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe('WORKER_OP_FAILED');
    // Nothing console-only.
    expect(consoleErr).not.toHaveBeenCalled();

    grid.destroy();
  });

  it('a config error (DUPLICATE_ROW_KEY) rejects but does NOT emit EVT-ERROR', async () => {
    const transport = new FakeTransport();
    const grid = createGrid(container(), {
      columns,
      keyField: 'id',
      createTransport: () => transport,
    });
    const errors: GridError[] = [];
    grid.on('error', (e) => errors.push(e.error));

    await expect(
      grid.setData([
        { id: 'x', name: 'a' },
        { id: 'x', name: 'b' },
      ]),
    ).rejects.toMatchObject({ code: 'DUPLICATE_ROW_KEY', source: 'config' });
    // Config errors surface by reject only — not EVT-ERROR.
    expect(errors).toHaveLength(0);

    grid.destroy();
  });
});

describe('AC-WORKER-CRASH — WORKER_CRASHED emits EVT-ERROR, rejects in-flight, recovers on setData', () => {
  it('crash rejects in-flight ops + emits EVT-ERROR; degrades read-only; setData recovers', async () => {
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const transport = new InProcessTransport(new EngineHost());
    const grid = createGrid(container(), {
      columns,
      keyField: 'id',
      createTransport: () => transport,
    });
    const errors: GridError[] = [];
    grid.on('error', (e) => errors.push(e.error));

    await grid.setData([{ id: 1, name: 'a' }]);

    // An in-flight op at crash time is rejected with WORKER_CRASHED.
    const inflight = grid.getRows({ startIndex: 0, endIndex: 10 });
    transport.crash('simulated worker termination');

    await expect(inflight).rejects.toMatchObject({
      code: 'WORKER_CRASHED',
      source: 'data-op',
    });
    expect(errors.some((e) => e.code === 'WORKER_CRASHED')).toBe(true);
    expect(consoleErr).not.toHaveBeenCalled();

    // Degraded read-only: further worker ops reject until a re-bind.
    await expect(
      grid.getRows({ startIndex: 0, endIndex: 10 }),
    ).rejects.toMatchObject({ code: 'WORKER_CRASHED' });

    // Recovery: setData re-binds and the grid works again.
    const res = await grid.setData([{ id: 2, name: 'b' }]);
    expect(res.rowCount).toBe(1);
    const rows = (await grid.getRows({ startIndex: 0, endIndex: 10 })).rows;
    expect(rows.map((r) => r.key)).toEqual([2]);

    grid.destroy();
  });
});

describe('AC-FLAG-COST — grid.isFeatureEnabled reflects options.features', () => {
  it('disabled flag → isFeatureEnabled false; others default true', () => {
    const grid = createGrid(container(), {
      columns,
      features: { sorting: false, export: false },
    });
    expect(grid.isFeatureEnabled('sorting')).toBe(false);
    expect(grid.isFeatureEnabled('export')).toBe(false);
    expect(grid.isFeatureEnabled('editing')).toBe(true);
    expect(grid.isFeatureEnabled('clipboard')).toBe(true);
    grid.destroy();
  });
});

describe('EVT-STATE-CHANGE — coalesced, fires on a store change', () => {
  it('fires once for a setData batch', async () => {
    const grid = createGrid(container(), { columns, keyField: 'id' });
    // Drain the initial column-setup coalesced notification.
    await Promise.resolve();
    await Promise.resolve();

    let changes = 0;
    grid.on('stateChange', () => changes++);

    await grid.setData([
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
    ]);
    await Promise.resolve();

    expect(changes).toBe(1); // coalesced: one batched notification
    grid.destroy();
  });
});
