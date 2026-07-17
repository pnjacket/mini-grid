// @vitest-environment jsdom
/**
 * `COMPONENT-ADAPTER-VUE` — the Vue `<MiniGrid>` mounts a `@mini-grid/core`
 * grid, reflects `data` prop changes, re-emits the `EVT-*` surface as Vue
 * events, and destroys the grid on unmount. Part of
 * `SUCCESS-FRAMEWORK-AGNOSTIC`.
 */
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MiniGrid } from './index.js';
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
  await nextTick();
  await new Promise((r) => setTimeout(r, 0));
}

function gridEl(): Element | null {
  return host!.querySelector('[role="grid"]');
}

afterEach(() => {
  host?.remove();
  host = undefined;
  document.body.innerHTML = '';
});

describe('@mini-grid/vue <MiniGrid>', () => {
  it('mounts, reflects data updates, emits events, destroys on unmount', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);

    const data = ref<RowData[]>(rows(3));
    const inst = ref<{ getGrid(): Grid | null } | null>(null);
    const onSelectionChange = vi.fn();
    const onAfterEdit = vi.fn();

    const Root = defineComponent({
      setup() {
        return () =>
          h(MiniGrid, {
            ref: inst,
            columns,
            data: data.value,
            options: { keyField: 'id' },
            onSelectionChange,
            onAfterEdit,
          });
      },
    });

    const app = createApp(Root);
    app.mount(host);
    await flush();

    // Mounts a role=grid with the initial aria-rowcount.
    expect(gridEl()).not.toBeNull();
    expect(gridEl()!.getAttribute('aria-rowcount')).toBe('3');

    // Data prop update reflects (setData, no rebuild).
    data.value = rows(5);
    await flush();
    expect(gridEl()!.getAttribute('aria-rowcount')).toBe('5');

    const grid = inst.value!.getGrid()!;
    expect(grid).toBeTruthy();

    // selectionChange re-emitted.
    grid.setSelection({
      ranges: [{ top: 0, bottom: 0, left: 0, right: 0 }],
      activeCell: { rowKey: 1, columnId: 'name' },
      anchor: { row: 0, col: 0 },
    });
    expect(onSelectionChange).toHaveBeenCalled();
    expect(onSelectionChange.mock.calls[0][0].type).toBe('selectionChange');

    // afterEdit re-emitted.
    await grid.updateCell(1, 'name', 'Edited');
    expect(onAfterEdit).toHaveBeenCalled();
    expect(onAfterEdit.mock.calls[0][0].newValue).toBe('Edited');

    // Unmount destroys the grid.
    const destroySpy = vi.spyOn(grid, 'destroy');
    app.unmount();
    expect(destroySpy).toHaveBeenCalledTimes(1);
    expect(gridEl()).toBeNull();
  });
});
