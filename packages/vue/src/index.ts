/**
 * `@mini-grid/vue` — Vue 3 adapter for `@mini-grid/core`
 * (`COMPONENT-ADAPTER-VUE`).
 *
 * A thin, idiomatic composition component (render function — no SFC compiler in
 * the build) that binds Vue's lifecycle + reactivity to the core's PUBLIC api
 * (`createGrid` / the `Grid` facade / the `EVT-*` event bus). Imports the core's
 * public surface only (`AC-BOUNDARY`) and never inlines it — the core is a
 * runtime dependency, Vue an optional peer (`DEP-VUE`). Contributes to
 * `SUCCESS-FRAMEWORK-AGNOSTIC`.
 */
import {
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';
import type { PropType } from 'vue';

import { createGrid } from '@mini-grid/core';
import type { ColumnDef, Grid, GridAfterEvents, GridOptions, RowData } from '@mini-grid/core';

/** Current adapter version. Versioned in lockstep with `@mini-grid/core`. */
export const VERSION = '0.0.0';

/** The full set of after/notify events (`EVT-*`) the adapter re-emits. */
const AFTER_EVENTS = [
  'error',
  'stateChange',
  'selectionChange',
  'scroll',
  'viewportChange',
  'afterEdit',
  'afterPaste',
  'editBegin',
  'editCommit',
  'editCancel',
  'validationError',
  'afterInsert',
  'afterDelete',
  'afterInsertCol',
  'afterDeleteCol',
  'afterSort',
  'afterFilter',
  'afterResize',
  'afterReorder',
  'afterFreezeChange',
  'afterMergeChange',
  'afterGroupChange',
] as const satisfies ReadonlyArray<keyof GridAfterEvents>;

/**
 * `<MiniGrid :columns :data :options @selection-change … />` — mounts a
 * `@mini-grid/core` grid, re-emits the `EVT-*` surface as Vue events, and
 * exposes the live `Grid` instance via `getGrid()`.
 */
export const MiniGrid = defineComponent({
  name: 'MiniGrid',
  props: {
    /** Column definitions (`LIB-COLUMN-DEF`). A change rebuilds the grid. */
    columns: {
      type: Array as PropType<readonly ColumnDef[]>,
      required: true,
    },
    /** The dataset (`LIB-SET-DATA`). A change calls `setData` (no rebuild). */
    data: {
      type: Array as PropType<readonly RowData[]>,
      default: undefined,
    },
    /** Any other `createGrid` options. A change rebuilds the grid. */
    options: {
      type: Object as PropType<Omit<GridOptions, 'columns' | 'data'>>,
      default: undefined,
    },
  },
  emits: AFTER_EVENTS as unknown as string[],
  setup(props, { emit, expose }) {
    const container = ref<HTMLElement | null>(null);
    let grid: Grid | null = null;
    let unsubs: Array<() => void> = [];

    function create(): void {
      if (!container.value) return;
      grid = createGrid(container.value, {
        ...(props.options ?? {}),
        columns: props.columns,
      });
      const g = grid;
      if (!g) return;
      unsubs = AFTER_EVENTS.map((type) =>
        g.on(type, (event: unknown) => {
          emit(type, event);
        }),
      );
      void g.setData([...(props.data ?? [])]);
    }

    function teardown(): void {
      for (const u of unsubs) u();
      unsubs = [];
      grid?.destroy();
      grid = null;
    }

    onMounted(create);
    onBeforeUnmount(teardown);

    // Data-only change → push without rebuilding.
    watch(
      () => props.data,
      (next) => {
        if (grid) void grid.setData([...(next ?? [])]);
      },
    );
    // Columns/options change → rebuild.
    watch([() => props.columns, () => props.options], () => {
      teardown();
      create();
    });

    expose({ getGrid: (): Grid | null => grid });

    return () => h('div', { ref: container });
  },
});

export default MiniGrid;
