/**
 * `COMPONENT-API` event surface (`EVT-*`) — a typed emitter on the `Grid`
 * instance. Two emit modes realize the Interfaces "vetoable before + notify
 * after" model:
 *
 * - `emit(type, payload)` — a **notify** after-event: every subscribed handler
 *   is called with `GridEvent<P> = { type } & P`.
 * - `emitVetoable(type, payload)` — a **vetoable** before-event: handlers receive
 *   a `BeforeEvent<P>` that adds `preventDefault()` + `defaultPrevented`; the call
 *   returns `true` when any handler vetoed. Callers gate the action (and its
 *   after-event) on `!vetoed` — on veto the action aborts, no after fires, state
 *   is unchanged.
 *
 * Subscription is one registry keyed by event type; `on` returns an unsubscribe.
 * The class is generic over its after-event map `A` and before-event map `B` so
 * later slices extend the maps (edit/sort/filter/paste/… before/after pairs)
 * without touching the bus.
 */
import type { GridError } from '../errors.js';
import type { Unsubscribe } from '../store/store.js';
import type { Selection } from '../selection/selection.js';
import type {
  CellRef,
  ColumnId,
  FilterSpec,
  GroupNode,
  MenuItem,
  MenuTarget,
  Range,
  RowKey,
  SortSpec,
} from '../types.js';

/** `GridEvent<P> = { type: string } & P` — a notify (after) event payload. */
export type GridEvent<P extends object = object> = Readonly<{ type: string }> & P;

/** The vetoable extension carried by a before-event. */
export interface Vetoable {
  /** Abort the pending action; no after-event fires and state is unchanged. */
  preventDefault(): void;
  /** `true` once a handler has called `preventDefault()`. */
  readonly defaultPrevented: boolean;
}

/** A vetoable before-event: `GridEvent<P>` plus the `Vetoable` machinery. */
export type BeforeEvent<P extends object = object> = GridEvent<P> & Vetoable;

type AnyHandler = (event: never) => void;

export class EventBus<
  A extends Record<string, object> = Record<string, object>,
  B extends Record<string, object> = Record<string, object>,
> {
  private readonly handlers = new Map<string, Set<AnyHandler>>();

  /** Subscribe to a before-event (handler receives a vetoable `BeforeEvent`). */
  on<K extends keyof B & string>(
    type: K,
    handler: (event: BeforeEvent<B[K]>) => void,
  ): Unsubscribe;
  /** Subscribe to a notify after-event. Returns an unsubscribe. */
  on<K extends keyof A & string>(
    type: K,
    handler: (event: GridEvent<A[K]>) => void,
  ): Unsubscribe;
  on(type: string, handler: (event: never) => void): Unsubscribe {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as AnyHandler);
    return () => this.off(type as never, handler as never);
  }

  /** Unsubscribe a handler previously registered with `on`. */
  off<K extends (keyof A | keyof B) & string>(
    type: K,
    handler: (event: never) => void,
  ): void {
    const set = this.handlers.get(type);
    if (!set) return;
    set.delete(handler as AnyHandler);
    if (set.size === 0) this.handlers.delete(type);
  }

  /** Emit a notify (after) event to all subscribers. */
  emit<K extends keyof A & string>(type: K, payload: A[K]): void {
    const set = this.handlers.get(type);
    if (!set || set.size === 0) return;
    const event = { type, ...payload } as GridEvent<A[K]>;
    for (const handler of [...set]) (handler as (e: GridEvent<A[K]>) => void)(event);
  }

  /**
   * Emit a vetoable before-event. Returns `true` if any handler called
   * `preventDefault()` (the action must then abort).
   */
  emitVetoable<K extends keyof B & string>(type: K, payload: B[K]): boolean {
    const set = this.handlers.get(type);
    let prevented = false;
    const event = {
      type,
      ...payload,
      preventDefault(): void {
        prevented = true;
      },
      get defaultPrevented(): boolean {
        return prevented;
      },
    } as BeforeEvent<B[K]>;
    if (set) {
      for (const handler of [...set]) {
        (handler as (e: BeforeEvent<B[K]>) => void)(event);
      }
    }
    return prevented;
  }

  /** Drop all subscriptions (used on `LIB-DESTROY`). */
  clear(): void {
    this.handlers.clear();
  }
}

/**
 * The grid's **notify (after) event** map (`EVT-*`, notify half). Slice 2 wires
 * `error` (`EVT-ERROR`) and `stateChange` (`EVT-STATE-CHANGE`); later slices add
 * the `after*` half of each action pair (`afterEdit`, `afterSort`, …) here.
 */
export type GridAfterEvents = {
  /** `EVT-ERROR` — a `GridError` reached a user-visible surface (`PATTERN-ERROR`). */
  error: { error: GridError };
  /** `EVT-STATE-CHANGE` — coalesced structural/data change; opaque payload. */
  stateChange: Record<string, never>;
  /** `EVT-SELECTION-CHANGE` — the selection changed (notify). */
  selectionChange: { selection: Selection };
  /** `EVT-SCROLL` — a scroll moved the visible window (raw, per scroll event). */
  scroll: ViewportRange;
  /** `EVT-VIEWPORT-CHANGE` — the rendered row/col window changed. */
  viewportChange: ViewportRange;
  /** `EVT-AFTER-EDIT` — a cell edit committed (notify half of the edit pair). */
  afterEdit: { cell: CellRef; oldValue: unknown; newValue: unknown };
  /** `EVT-AFTER-RECALC` *(v1.5)* — a formula recalculation completed (`CAP-FORMULA`). */
  afterRecalc: {
    changed: number;
    cycles: number;
    elapsedMs: number;
    trigger: 'load' | 'edit' | 'structural' | 'manual';
  };
  /** `EVT-AFTER-PASTE` — a paste block applied (notify half of the paste pair). */
  afterPaste: { targetRange: Range; data: string[][] };
  /** `EVT-EDIT-BEGIN` — an edit session opened (notify). */
  editBegin: { cell: CellRef };
  /** `EVT-EDIT-COMMIT` — an edit session committed (notify). */
  editCommit: { cell: CellRef };
  /** `EVT-EDIT-CANCEL` — an edit session was cancelled/aborted (notify). */
  editCancel: { cell: CellRef };
  /** `EVT-VALIDATION-ERROR` — a commit failed validation (notify, assertive). */
  validationError: { cell: CellRef; error: GridError };
  /** `EVT-AFTER-INSERT` — rows were inserted (notify half of the row-insert pair). */
  afterInsert: { atIndex: number; count: number };
  /** `EVT-AFTER-DELETE` — rows were removed (notify half of the row-delete pair). */
  afterDelete: { rowKeys: RowKey[] };
  /** `EVT-AFTER-INSERT-COL` — a column was inserted (notify). */
  afterInsertCol: { atIndex: number };
  /** `EVT-AFTER-DELETE-COL` — a column was removed (notify). */
  afterDeleteCol: { columnId: ColumnId };
  /** `EVT-AFTER-SORT` — the sort spec was applied (notify half of the sort pair). */
  afterSort: { spec: SortSpec; rowCount: number };
  /** `EVT-AFTER-FILTER` — the filter spec was applied (notify half of the filter pair). */
  afterFilter: { spec: FilterSpec; rowCount: number; totalRowCount: number };
  /** `EVT-AFTER-RESIZE` — a column width changed (notify half of the resize pair). */
  afterResize: { columnId: ColumnId; width: number };
  /** `EVT-AFTER-REORDER` — a column was moved (notify half of the reorder pair). */
  afterReorder: { columnId: ColumnId; fromIndex: number; toIndex: number };
  /** `EVT-AFTER-FREEZE-CHANGE` — the freeze pane changed (notify half of the pair). */
  afterFreezeChange: { frozenRowCount: number; frozenColCount: number };
  /** `EVT-AFTER-MERGE-CHANGE` — a merge/unmerge applied (notify half of the pair). */
  afterMergeChange: { range: Range; merged: boolean };
  /** `EVT-AFTER-GROUP-CHANGE` — a group/ungroup/collapse applied (notify half of the pair). */
  afterGroupChange: { node: GroupNode };
  /** `EVT-COLUMN-HIDDEN` *(v1.3)* — `hideColumn`/`showColumn` toggled visibility (`CAP-COLUMN-MANAGE`). */
  columnHidden: { columnId: ColumnId; hidden: boolean };
  /** `EVT-COLUMN-PINNED` *(v1.3)* — `pinColumn` changed the leading pin (`CAP-COLUMN-MANAGE`). */
  columnPinned: { columnId: ColumnId; pinned: 'leading' | null };
  /**
   * `EVT-COLUMN-AUTOFIT` *(v1.3)* — `autofitColumn` (single `{ columnId, width }`)
   * or `autofitAllColumns` (`{ columns: [...] }`) sized column(s) from a bounded
   * visible-content measure (`CAP-COLUMN-MANAGE`).
   */
  columnAutofit:
    | { columnId: ColumnId; width: number }
    | { columns: { columnId: ColumnId; width: number }[] };
  /**
   * `EVT-MENU-OPEN` *(v1.4)* — a context menu (cell or header/row/corner) opened,
   * carrying the resolved (flag-filtered) items (`CAP-MENU`).
   */
  menuOpen: { target: MenuTarget; items: MenuItem[]; position: { x: number; y: number } };
};

/** The visible logical window carried by `EVT-SCROLL`/`EVT-VIEWPORT-CHANGE`. */
export interface ViewportRange {
  firstRow: number;
  lastRow: number;
  firstCol: number;
  lastCol: number;
}

/**
 * The grid's **vetoable before-event** map (`EVT-*`, before half). Slice 4a wires
 * `beforeEdit` (`EVT-BEFORE-EDIT`) — vetoing it aborts the pending edit before it
 * is applied (no `afterEdit`, state unchanged). Later slices add
 * `beforeSort`/`beforePaste`/… onto the same before-event machinery.
 */
export type GridBeforeEvents = {
  /** `EVT-BEFORE-EDIT` — vetoable pre-apply hook for a cell edit. */
  beforeEdit: { cell: CellRef; oldValue: unknown; newValue: unknown };
  /**
   * `EVT-BEFORE-PASTE` — vetoable pre-apply hook for a paste. A handler that
   * calls `preventDefault()` aborts the whole paste: no cells change and no
   * `EVT-AFTER-PASTE` fires (`COMPONENT-CLIPBOARD`).
   */
  beforePaste: { targetRange: Range; data: string[][] };
  /** `EVT-BEFORE-INSERT` — vetoable pre-apply hook for a row insert. */
  beforeInsert: { atIndex: number; count: number };
  /** `EVT-BEFORE-DELETE` — vetoable pre-apply hook for a row delete. */
  beforeDelete: { rowKeys: RowKey[] };
  /** `EVT-BEFORE-INSERT-COL` — vetoable pre-apply hook for a column insert. */
  beforeInsertCol: { atIndex: number };
  /** `EVT-BEFORE-DELETE-COL` — vetoable pre-apply hook for a column delete. */
  beforeDeleteCol: { columnId: ColumnId };
  /** `EVT-BEFORE-SORT` — vetoable pre-apply hook for a sort. */
  beforeSort: { spec: SortSpec };
  /** `EVT-BEFORE-FILTER` — vetoable pre-apply hook for a filter. */
  beforeFilter: { spec: FilterSpec };
  /** `EVT-BEFORE-RESIZE` — vetoable pre-apply hook for a column resize. */
  beforeResize: { columnId: ColumnId; width: number };
  /** `EVT-BEFORE-REORDER` — vetoable pre-apply hook for a column reorder. */
  beforeReorder: { columnId: ColumnId; fromIndex: number; toIndex: number };
  /** `EVT-BEFORE-FREEZE-CHANGE` — vetoable pre-apply hook for a freeze change. */
  beforeFreezeChange: { frozenRowCount: number; frozenColCount: number };
  /** `EVT-BEFORE-MERGE-CHANGE` — vetoable pre-apply hook for a merge/unmerge. */
  beforeMergeChange: { range: Range; merged: boolean };
  /** `EVT-BEFORE-GROUP-CHANGE` — vetoable pre-apply hook for a group/ungroup/collapse. */
  beforeGroupChange: { node: GroupNode };
};

/** The event type union accepted by `grid.on` / `grid.off`. */
export type GridEventType = keyof GridAfterEvents | keyof GridBeforeEvents;

/** The concrete bus type mounted on the `Grid` instance. */
export type GridEventBus = EventBus<GridAfterEvents, GridBeforeEvents>;
