// @vitest-environment jsdom
/**
 * `COMPONENT-ADAPTER-REACT` — the React `<MiniGrid>` mounts a `@mini-grid/core`
 * grid, reflects `data` prop changes, forwards `EVT-*` callbacks, and destroys
 * the grid on unmount. Part of `SUCCESS-FRAMEWORK-AGNOSTIC` (each adapter mounts
 * the same core the plain-HTML E2E already proves).
 */
import { createElement, createRef } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MiniGrid } from './index.js';
import type { MiniGridHandle } from './index.js';
import type { ColumnDef, RowData } from '@mini-grid/core';

const columns: ColumnDef[] = [
  { id: 'id', field: 'id', header: 'ID', width: 80, type: 'number' },
  { id: 'name', field: 'name', header: 'Name', width: 160, type: 'text', editable: true },
];

function rows(n: number): RowData[] {
  return Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `Row ${i + 1}` }));
}

let host: HTMLElement | undefined;

async function tick(): Promise<void> {
  // Flush React effects + the core's microtask/timer-coalesced data pipeline.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

afterEach(() => {
  host?.remove();
  host = undefined;
  document.body.innerHTML = '';
});

describe('@mini-grid/react <MiniGrid>', () => {
  it('mounts a role=grid with the right aria-rowcount', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(createElement(MiniGrid, { columns, data: rows(3) }));
    });
    await tick();

    const grid = host.querySelector('[role="grid"]');
    expect(grid).not.toBeNull();
    expect(grid!.getAttribute('aria-rowcount')).toBe('3');

    await act(async () => {
      root.unmount();
    });
  });

  it('reflects a data prop update (setData, no rebuild)', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(createElement(MiniGrid, { columns, data: rows(2) }));
    });
    await tick();
    expect(host.querySelector('[role="grid"]')!.getAttribute('aria-rowcount')).toBe('2');

    await act(async () => {
      root.render(createElement(MiniGrid, { columns, data: rows(5) }));
    });
    await tick();
    expect(host.querySelector('[role="grid"]')!.getAttribute('aria-rowcount')).toBe('5');

    await act(async () => {
      root.unmount();
    });
  });

  it('forwards onSelectionChange and onAfterEdit via grid.on', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    const ref = createRef<MiniGridHandle>();
    const onSelectionChange = vi.fn();
    const onAfterEdit = vi.fn();
    const root = createRoot(host);
    await act(async () => {
      root.render(
        createElement(MiniGrid, {
          ref,
          columns,
          data: rows(3),
          options: { keyField: 'id' },
          onSelectionChange,
          onAfterEdit,
        }),
      );
    });
    await tick();

    const grid = ref.current!;
    expect(grid).toBeTruthy();

    await act(async () => {
      grid.setSelection({
        ranges: [{ top: 0, bottom: 0, left: 0, right: 0 }],
        activeCell: { rowKey: 1, columnId: 'name' },
        anchor: { row: 0, col: 0 },
      });
    });
    expect(onSelectionChange).toHaveBeenCalled();
    expect(onSelectionChange.mock.calls[0][0].type).toBe('selectionChange');

    await act(async () => {
      await grid.updateCell(1, 'name', 'Edited');
    });
    expect(onAfterEdit).toHaveBeenCalled();
    expect(onAfterEdit.mock.calls[0][0].newValue).toBe('Edited');

    await act(async () => {
      root.unmount();
    });
  });

  it('destroys the grid on unmount (no leak, DOM removed)', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    const ref = createRef<MiniGridHandle>();
    const root = createRoot(host);
    await act(async () => {
      root.render(createElement(MiniGrid, { ref, columns, data: rows(2) }));
    });
    await tick();

    const grid = ref.current!;
    const destroySpy = vi.spyOn(grid, 'destroy');
    await act(async () => {
      root.unmount();
    });

    expect(destroySpy).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="grid"]')).toBeNull();
  });
});
