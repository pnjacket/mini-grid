/**
 * `@mini-grid/react` — React adapter for `@mini-grid/core`
 * (`COMPONENT-ADAPTER-REACT`).
 *
 * A thin, idiomatic function-component wrapper that binds React's lifecycle +
 * reactivity to the core's PUBLIC api (`createGrid` / the `Grid` facade / the
 * `EVT-*` event bus). It imports the core's public surface only (`AC-BOUNDARY`)
 * and never inlines it — the core is a runtime dependency, React an optional
 * peer (`DEP-REACT`). Contributes to `SUCCESS-FRAMEWORK-AGNOSTIC`.
 */
import {
  createElement,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import type { CSSProperties, ForwardedRef, ReactElement } from 'react';

import { createGrid } from '@mini-grid/core';
import type {
  ColumnDef,
  Grid,
  GridAfterEvents,
  GridEvent,
  GridOptions,
  RowData,
} from '@mini-grid/core';

/** Current adapter version. Versioned in lockstep with `@mini-grid/core`. */
export const VERSION = '0.0.0';

/** The full set of after/notify events (`EVT-*`) an adapter can forward. */
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

/** The imperative handle forwarded via `ref` — the live `Grid` instance (or null). */
export type MiniGridHandle = Grid | null;

export interface MiniGridProps {
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
  /** Forwarded to the container `<div>`. */
  className?: string;
  /** Forwarded to the container `<div>`. */
  style?: CSSProperties;
}

/** Subscribe every `EVT-*` after-event, dispatching to the latest props. */
function subscribe(
  grid: Grid,
  propsRef: { current: MiniGridProps },
): Array<() => void> {
  const unsubs: Array<() => void> = [];
  for (const type of AFTER_EVENTS) {
    unsubs.push(
      grid.on(type, (event: unknown) => {
        const props = propsRef.current;
        for (const [prop, evt] of Object.entries(NAMED_EVENTS)) {
          if (evt === type) {
            const fn = props[prop as keyof MiniGridProps] as
              | ((e: unknown) => void)
              | undefined;
            fn?.(event);
          }
        }
        (props.events?.[type] as ((e: unknown) => void) | undefined)?.(event);
      }),
    );
  }
  return unsubs;
}

function MiniGridInner(
  props: MiniGridProps,
  ref: ForwardedRef<MiniGridHandle>,
): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<Grid | null>(null);
  // Latest props for the (subscribe-once) event dispatch — avoids re-subscribing
  // on every render while always calling the current callbacks.
  const propsRef = useRef(props);
  propsRef.current = props;
  // The dataset last pushed to the live grid (so the data effect skips the
  // create-time set and reacts only to genuine `data` changes).
  const appliedData = useRef<readonly RowData[] | undefined>(undefined);
  // Bumped when the grid is (re)created so the imperative handle — a layout
  // effect that would otherwise capture the still-null ref before the passive
  // create effect runs — recomputes to the live instance.
  const [gridVersion, setGridVersion] = useState(0);

  // Create / rebuild the grid on mount and whenever columns/options change.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const grid = createGrid(el, {
      ...(props.options ?? {}),
      columns: props.columns,
    });
    gridRef.current = grid;
    setGridVersion((v) => v + 1);
    const unsubs = subscribe(grid, propsRef);
    appliedData.current = propsRef.current.data;
    void grid.setData([...(propsRef.current.data ?? [])]);
    return () => {
      for (const u of unsubs) u();
      grid.destroy();
      gridRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.columns, props.options]);

  // Push data changes without rebuilding the grid.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    if (props.data === appliedData.current) return;
    appliedData.current = props.data;
    void grid.setData([...(props.data ?? [])]);
  }, [props.data]);

  useImperativeHandle<MiniGridHandle, MiniGridHandle>(
    ref,
    () => gridRef.current,
    [gridVersion],
  );

  return createElement('div', {
    ref: containerRef,
    className: props.className,
    style: props.style,
  });
}

/**
 * `<MiniGrid columns data options … />` — mounts a `@mini-grid/core` grid and
 * forwards a `ref` to the live `Grid` instance (`useImperativeHandle`).
 */
export const MiniGrid = forwardRef(MiniGridInner);
MiniGrid.displayName = 'MiniGrid';

export default MiniGrid;
