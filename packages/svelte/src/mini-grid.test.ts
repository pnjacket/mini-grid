// @vitest-environment jsdom
/**
 * `COMPONENT-ADAPTER-SVELTE` — the `miniGrid` action (and the `createMiniGrid`
 * thin component) mounts a `@mini-grid/core` grid, reflects `data` param
 * changes, forwards the `EVT-*` surface, and destroys the grid on teardown.
 * Part of `SUCCESS-FRAMEWORK-AGNOSTIC`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMiniGrid, miniGrid } from './index.js';
import type { Grid, ColumnDef, RowData } from '@mini-grid/core';

const columns: ColumnDef[] = [
  { id: 'id', field: 'id', header: 'ID', width: 80, type: 'number' },
  { id: 'name', field: 'name', header: 'Name', width: 160, type: 'text', editable: true },
];

function rows(n: number): RowData[] {
  return Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `Row ${i + 1}` }));
}

let host: HTMLElement | undefined;

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

afterEach(() => {
  host?.remove();
  host = undefined;
  document.body.innerHTML = '';
});

describe('@mini-grid/svelte miniGrid action', () => {
  it('mounts, reflects data updates, forwards events, destroys on teardown', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    const node = document.createElement('div');
    host.appendChild(node);

    let grid: Grid | undefined;
    const onSelectionChange = vi.fn();
    const onAfterEdit = vi.fn();
    // Stable options reference: a data-only change must NOT rebuild the grid.
    const options = { keyField: 'id' };
    const onReady = (g: Grid): void => {
      grid = g;
    };

    const action = miniGrid(node, {
      columns,
      data: rows(3),
      options,
      onSelectionChange,
      onAfterEdit,
      onReady,
    });
    await flush();

    // Mounts a role=grid with the right aria-rowcount.
    const gridEl = node.querySelector('[role="grid"]');
    expect(gridEl).not.toBeNull();
    expect(gridEl!.getAttribute('aria-rowcount')).toBe('3');
    expect(grid).toBeTruthy();

    // Param update reflects (setData, no rebuild). Svelte re-passes all
    // bindings each update, so the callbacks travel with it.
    action.update?.({
      columns,
      data: rows(5),
      options,
      onSelectionChange,
      onAfterEdit,
      onReady,
    });
    await flush();
    expect(node.querySelector('[role="grid"]')!.getAttribute('aria-rowcount')).toBe('5');

    // selectionChange forwarded.
    grid!.setSelection({
      ranges: [{ top: 0, bottom: 0, left: 0, right: 0 }],
      activeCell: { rowKey: 1, columnId: 'name' },
      anchor: { row: 0, col: 0 },
    });
    expect(onSelectionChange).toHaveBeenCalled();

    // afterEdit forwarded.
    await grid!.updateCell(1, 'name', 'Edited');
    expect(onAfterEdit).toHaveBeenCalled();
    expect(onAfterEdit.mock.calls[0][0].newValue).toBe('Edited');

    // Teardown destroys the grid.
    const destroySpy = vi.spyOn(grid!, 'destroy');
    action.destroy?.();
    expect(destroySpy).toHaveBeenCalledTimes(1);
    expect(node.querySelector('[role="grid"]')).toBeNull();
  });

  it('createMiniGrid mounts and destroys a thin component instance', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);

    const instance = createMiniGrid(host, {
      columns,
      data: rows(4),
      options: { keyField: 'id' },
    });
    await flush();

    expect(instance.grid).toBeTruthy();
    const gridEl = host.querySelector('[role="grid"]');
    expect(gridEl).not.toBeNull();
    expect(gridEl!.getAttribute('aria-rowcount')).toBe('4');

    const destroySpy = vi.spyOn(instance.grid!, 'destroy');
    instance.destroy();
    expect(destroySpy).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="grid"]')).toBeNull();
  });
});
