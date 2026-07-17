/**
 * `@mini-grid/svelte` — Svelte adapter for `@mini-grid/core`
 * (`COMPONENT-ADAPTER-SVELTE`).
 *
 * The idiomatic, compiler-light surface: a **Svelte action**
 * (`use:miniGrid={{ columns, data, options }}`) plus a thin imperative
 * component (`createMiniGrid(target, params)`) and a raw `MiniGrid.svelte`
 * wrapper (shipped as a subpath export). All bind Svelte's action lifecycle to
 * the core's PUBLIC api (`createGrid` / the `Grid` facade / the `EVT-*` bus),
 * importing the core's public surface only (`AC-BOUNDARY`) and never inlining it
 * — the core is a runtime dependency, Svelte an optional peer (`DEP-SVELTE`).
 * Contributes to `SUCCESS-FRAMEWORK-AGNOSTIC`.
 */
import { createGrid } from '@mini-grid/core';
import type {
  ColumnDef,
  Grid,
  GridAfterEvents,
  GridEvent,
  GridOptions,
  RowData,
} from '@mini-grid/core';
import type { Action, ActionReturn } from 'svelte/action';

/** Current adapter version. Versioned in lockstep with `@mini-grid/core`. */
export const VERSION = '0.0.0';

/** The full set of after/notify events (`EVT-*`) the adapter can forward. */
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

/** Named convenience callbacks → their `EVT-*` after-event key. */
const NAMED_EVENTS = {
  onSelectionChange: 'selectionChange',
  onAfterEdit: 'afterEdit',
  onError: 'error',
} as const satisfies Record<string, keyof GridAfterEvents>;

/** A per-event handler map (`{ afterSort: (e) => … }`) — the generic escape hatch. */
export type MiniGridEventHandlers = {
  [K in keyof GridAfterEvents]?: (event: GridEvent<GridAfterEvents[K]>) => void;
};

export interface MiniGridParams {
  /** Column definitions (`LIB-COLUMN-DEF`). A new reference rebuilds the grid. */
  columns: readonly ColumnDef[];
  /** The dataset (`LIB-SET-DATA`). A new reference calls `setData` (no rebuild). */
  data?: readonly RowData[];
  /** Any other `createGrid` options. A new reference rebuilds the grid. */
  options?: Omit<GridOptions, 'columns' | 'data'>;
  /** `EVT-SELECTION-CHANGE`. */
  onSelectionChange?: (event: GridEvent<GridAfterEvents['selectionChange']>) => void;
  /** `EVT-AFTER-EDIT`. */
  onAfterEdit?: (event: GridEvent<GridAfterEvents['afterEdit']>) => void;
  /** `EVT-ERROR`. */
  onError?: (event: GridEvent<GridAfterEvents['error']>) => void;
  /** Generic per-event handlers for the rest of the `EVT-*` surface. */
  events?: MiniGridEventHandlers;
  /** Called once with the live `Grid` instance after (re)creation. */
  onReady?: (grid: Grid) => void;
}

/** Attributes/events the action contributes (for Svelte's typed action support). */
export interface MiniGridActionAttributes {
  'on:ready'?: (e: CustomEvent<Grid>) => void;
}

interface Controller {
  update(params: MiniGridParams): void;
  destroy(): void;
  /** The live grid instance (or null once destroyed). */
  readonly grid: Grid | null;
}

function makeController(node: HTMLElement, initial: MiniGridParams): Controller {
  let current = initial;
  let grid: Grid | null = null;
  let unsubs: Array<() => void> = [];
  let appliedColumns: readonly ColumnDef[] | undefined;
  let appliedOptions: MiniGridParams['options'];

  function dispatch<K extends keyof GridAfterEvents>(
    type: K,
    event: GridEvent<GridAfterEvents[K]>,
  ): void {
    for (const [prop, evt] of Object.entries(NAMED_EVENTS)) {
      if (evt === type) {
        const fn = current[prop as keyof MiniGridParams] as
          | ((e: unknown) => void)
          | undefined;
        fn?.(event);
      }
    }
    (current.events?.[type] as ((e: unknown) => void) | undefined)?.(event);
  }

  function create(params: MiniGridParams): void {
    grid = createGrid(node, {
      ...(params.options ?? {}),
      columns: params.columns,
    });
    appliedColumns = params.columns;
    appliedOptions = params.options;
    const g = grid;
    if (!g) return;
    // `event` is annotated `unknown` because the union-keyed `on(type, …)` call
    // can't narrow the payload; it is dispatched to the matching typed channel.
    unsubs = AFTER_EVENTS.map((type) =>
      g.on(type, (event: unknown) => dispatch(type, event as never)),
    );
    void g.setData([...(params.data ?? [])]);
    params.onReady?.(g);
  }

  function teardown(): void {
    for (const u of unsubs) u();
    unsubs = [];
    grid?.destroy();
    grid = null;
  }

  create(current);

  return {
    update(next: MiniGridParams): void {
      const prev = current;
      current = next;
      if (next.columns !== appliedColumns || next.options !== appliedOptions) {
        teardown();
        create(next);
        return;
      }
      if (next.data !== prev.data && grid) {
        void grid.setData([...(next.data ?? [])]);
      }
    },
    destroy(): void {
      teardown();
    },
    get grid(): Grid | null {
      return grid;
    },
  };
}

/**
 * `use:miniGrid={{ columns, data, options, … }}` — the idiomatic Svelte action.
 * Mounts a `@mini-grid/core` grid on the node, forwards the `EVT-*` surface to
 * the param callbacks, reacts to param changes (data → `setData`;
 * columns/options → rebuild), and destroys the grid when the node unmounts.
 */
export const miniGrid: Action<HTMLElement, MiniGridParams, MiniGridActionAttributes> = (
  node,
  params,
): ActionReturn<MiniGridParams, MiniGridActionAttributes> => {
  const controller = makeController(node, params);
  return {
    update: (next) => controller.update(next),
    destroy: () => controller.destroy(),
  };
};

/** Handle returned by {@link createMiniGrid} — a thin imperative component. */
export interface MiniGridInstance {
  /** Update the params (same semantics as the action's `update`). */
  update(params: MiniGridParams): void;
  /** Destroy the grid and remove the container from the DOM. */
  destroy(): void;
  /** The live `Grid` instance (or null once destroyed). */
  readonly grid: Grid | null;
}

/**
 * `createMiniGrid(target, params)` — a compiler-free imperative wrapper for
 * hosts without an `.svelte` toolchain. Appends a container to `target`, applies
 * the {@link miniGrid} action, and returns a small instance handle.
 */
export function createMiniGrid(
  target: HTMLElement,
  params: MiniGridParams,
): MiniGridInstance {
  const node = document.createElement('div');
  target.appendChild(node);
  const controller = makeController(node, params);
  return {
    update: (next) => controller.update(next),
    destroy: () => {
      controller.destroy();
      node.remove();
    },
    get grid(): Grid | null {
      return controller.grid;
    },
  };
}

export default miniGrid;
