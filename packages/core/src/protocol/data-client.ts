/**
 * `DataClient` — the main-thread client for `COMPONENT-DATA-WORKER`. Assigns a
 * monotonic `reqId` per message, returns Promises for request/response ops, and
 * realizes the `PATTERN-WORKER-PROTOCOL` version rules:
 *
 * - Every outgoing `MSG-*` carries `reqId`.
 * - The client tracks the highest index `version` seen (raised by any
 *   `MSG-INDEX-SUMMARY` / `MSG-WINDOW`).
 * - Coalesced viewport windows (`queryWindow` / `onWindow`) whose reply carries a
 *   **superseded** `version` (`< current`) are DROPPED — the latest window wins.
 * - Explicit reads (`getRows`) resolve by `reqId` regardless, so a caller's
 *   Promise never hangs.
 */
import { GridError, sourceForCode } from '../errors.js';
import { IndexEngine } from '../engine/index-engine.js';
import type { EngineColumn, EngineRow } from '../engine/index-engine.js';
import type {
  CellRef,
  FilterSpec,
  OnDuplicateKey,
  RowData,
  RowKey,
  SortSpec,
} from '../types.js';
import type { PerfRecorder } from '../perf/perf.js';
import type { DataTransport } from './transport.js';
import {
  needsMainThread,
  toBuiltinFilter,
  toDeclarativeSort,
} from './view-plan.js';
import type {
  MainToWorker,
  MsgWindow,
  WireColumn,
  WireRow,
  WorkerToMain,
} from './messages.js';

/**
 * The main-thread view context (`ADR-SORT-FILTER-SEAM`): the live columns (with
 * their custom comparators) + key field the client needs to (a) detect a custom
 * function and (b) compute the ordered/filtered key list on the main thread.
 */
export interface ViewContext {
  columns: () => readonly EngineColumn[];
  keyField: () => string | null;
}

export interface LoadResult {
  rowCount: number;
  totalRowCount: number;
}

export interface WindowResult {
  startIndex: number;
  rows: EngineRow[];
  version: number;
}

export interface CountsResult {
  rowCount: number;
  totalRowCount: number;
}

/** `LIB-UPDATE-CELL` resolution from the worker (`MSG-APPLY-EDIT` reply). */
export interface EditApplyResult {
  rowKey: RowKey;
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

/** `MSG-PASTE-APPLY` resolution — the per-cell old/new values (undo restore). */
export type PasteApplyResult = EditApplyResult[];

/** Resolution of a structural mutation (`MSG-STRUCT-RESULT` reply). */
export interface StructResult {
  op: 'insert' | 'remove' | 'insert-col' | 'remove-col';
  rowCount: number;
  totalRowCount: number;
  /** `insert` — the ordered index the rows landed at (clamped in the engine). */
  atIndex?: number;
  /** `remove` — removed rows + their pre-removal ordered index (undo restore). */
  removed?: { index: number; row: EngineRow }[];
  /** `remove-col` — deleted field name. */
  removedField?: string;
  /** `remove-col` — prior per-row values at the field (undo restore). */
  removedValues?: { rowKey: RowKey; value: unknown }[];
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
}

type WindowHandler = (win: WindowResult) => void;
type SummaryHandler = (counts: CountsResult, version: number) => void;
type ErrorHandler = (err: GridError) => void;

export class DataClient {
  private nextReqId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly windowHandlers = new Set<WindowHandler>();
  private readonly summaryHandlers = new Set<SummaryHandler>();
  private readonly errorHandlers = new Set<ErrorHandler>();

  /** Highest index version observed so far (`PATTERN-WORKER-PROTOCOL`). */
  version = 0;
  private cachedCounts: CountsResult = { rowCount: 0, totalRowCount: 0 };
  private droppedWindows = 0;

  // --- View-op seam state (`ADR-SORT-FILTER-SEAM`) --------------------------
  /** The effective sort/filter (may hold custom functions), tracked per axis. */
  private currentSort: SortSpec = { entries: [] };
  private currentFilter: FilterSpec = { perColumn: {} };
  private viewContext: ViewContext | undefined;
  /** Which transport path the last sort/filter took (test/observability hook). */
  lastViewPath: 'worker' | 'main' | null = null;
  /** Count of sort/filter ops that ran off-thread (built-in) vs main-thread. */
  workerViewOps = 0;
  mainThreadViewOps = 0;
  /**
   * Degraded read-only flag (worker-resilience policy). Set on `WORKER_CRASHED`;
   * cleared by the next `load` (`setData` re-bind = recovery).
   */
  private crashed = false;

  constructor(
    private readonly transport: DataTransport,
    private readonly perf?: PerfRecorder,
  ) {
    this.transport.onMessage((msg) => this.onMessage(msg));
    this.transport.onCrash?.((info) => this.handleCrash(info.message));
  }

  /** Number of coalesced windows dropped for carrying a superseded version. */
  get droppedWindowCount(): number {
    return this.droppedWindows;
  }

  /** Whether the client is in the degraded read-only state after a crash. */
  get isCrashed(): boolean {
    return this.crashed;
  }

  load(
    rows: readonly RowData[],
    keyField: string | null,
    columns: readonly WireColumn[],
    onDuplicateKey: OnDuplicateKey,
    formula = false,
    locale?: string,
  ): Promise<LoadResult> {
    // The engine's `load` clears its sort/filter — mirror that in the tracked
    // view state so the next sort/filter plans from a clean baseline.
    this.resetView();
    return this.request<LoadResult>((reqId) => ({
      kind: 'load',
      reqId,
      rows,
      keyField,
      columns,
      onDuplicateKey,
      ...(formula ? { formula: true } : {}),
      ...(locale !== undefined ? { locale } : {}),
    }));
  }

  /** `LIB-FORMULA-RECALC` — force a full formula recalc; resolves the summary. */
  recalc(locale?: string): Promise<{ changed: number; cycles: number }> {
    return this.request<{ changed: number; cycles: number }>((reqId) => ({
      kind: 'recalc',
      reqId,
      ...(locale !== undefined ? { locale } : {}),
    }));
  }

  /**
   * Explicit read — resolves by `reqId`. `endIndex` exclusive, clamped in engine.
   * `allData` windows the full pre-filter dataset (`LIB-EXPORT` `opts.allData`).
   */
  getRows(startIndex: number, endIndex: number, allData = false): Promise<WindowResult> {
    return this.request<WindowResult>((reqId) => ({
      kind: 'query-window',
      reqId,
      startIndex,
      endIndex,
      ...(allData ? { allData: true } : {}),
    }));
  }

  getCounts(): Promise<CountsResult> {
    return Promise.resolve({ ...this.cachedCounts });
  }

  /**
   * Register the live column model + key field so the client can detect a custom
   * comparator/predicate and run the main-thread path (`ADR-SORT-FILTER-SEAM`).
   */
  setViewContext(ctx: ViewContext): void {
    this.viewContext = ctx;
  }

  /**
   * `LIB-SORT` — a fully-declarative spec rebuilds the index OFF-THREAD in the
   * worker (`MSG-SORT`); a spec with any custom `comparator` runs on the MAIN
   * THREAD (`ADR-SORT-FILTER-SEAM`). Async either way.
   */
  sort(spec: SortSpec): Promise<LoadResult> {
    this.currentSort = spec;
    const p = this.applyView('sort');
    return this.perf ? this.perf.measureAsync('mg:sort', p) : p;
  }

  /**
   * `LIB-FILTER` — an all-`BuiltinFilter` spec rebuilds the index OFF-THREAD in
   * the worker (`MSG-FILTER`); any `FilterPredicate` function forces the whole op
   * onto the MAIN THREAD (`ADR-SORT-FILTER-SEAM`). Empty = all rows.
   */
  filter(spec: FilterSpec): Promise<LoadResult> {
    this.currentFilter = spec;
    const p = this.applyView('filter');
    return this.perf ? this.perf.measureAsync('mg:filter', p) : p;
  }

  /**
   * Reset the client's tracked view state to unsorted/unfiltered — called on
   * (re)bind, mirroring the engine's `load` which clears its own sort/filter.
   */
  resetView(): void {
    this.currentSort = { entries: [] };
    this.currentFilter = { perColumn: {} };
    this.lastViewPath = null;
  }

  /**
   * Route one sort/filter op. When the effective view (both axes) is fully
   * serializable, the changed axis rebuilds the index in the worker off the main
   * thread. When any custom function is present, the WHOLE view is recomputed on
   * the main thread: export the canonical rows, compute the ordered key list with
   * the real functions, and install it via `MSG-SET-INDEX`.
   */
  private async applyView(changed: 'sort' | 'filter'): Promise<LoadResult> {
    const columns = this.viewContext?.columns() ?? [];
    if (!needsMainThread(this.currentSort, this.currentFilter, columns)) {
      this.lastViewPath = 'worker';
      this.workerViewOps++;
      // Serializable path: post only the changed axis; the worker keeps the other.
      if (changed === 'sort') {
        return this.request<LoadResult>((reqId) => ({
          kind: 'sort',
          reqId,
          spec: toDeclarativeSort(this.currentSort),
        }));
      }
      return this.request<LoadResult>((reqId) => ({
        kind: 'filter',
        reqId,
        spec: toBuiltinFilter(this.currentFilter),
      }));
    }
    // Main-thread path: recompute the whole ordered/filtered view with the real
    // functions, then install the explicit index (`ADR-SORT-FILTER-SEAM`).
    this.lastViewPath = 'main';
    this.mainThreadViewOps++;
    const rows = await this.exportRows();
    const orderedKeys = this.computeOrderedKeys(rows, columns);
    return this.setIndex(orderedKeys);
  }

  /** `MSG-EXPORT-ROWS` — pull every canonical row (natural order) from the worker. */
  exportRows(): Promise<EngineRow[]> {
    return this.request<EngineRow[]>((reqId) => ({ kind: 'export-rows', reqId }));
  }

  /**
   * `MSG-SET-INDEX` — install a main-thread-computed ordered view; carries the
   * serializable baseline so later structural/built-in ops rebuild coherently.
   */
  setIndex(orderedKeys: readonly RowKey[]): Promise<LoadResult> {
    return this.request<LoadResult>((reqId) => ({
      kind: 'set-index',
      reqId,
      orderedKeys,
      sort: toDeclarativeSort(this.currentSort),
      filter: toBuiltinFilter(this.currentFilter),
    }));
  }

  /**
   * Compute the ordered/filtered key list on the main thread by replaying the
   * effective sort+filter (custom functions included) through a throwaway engine
   * — reusing the identical filter/sort logic, so results match the worker path
   * exactly. This is the documented transfer + compute cost of the custom-fn path.
   */
  private computeOrderedKeys(rows: EngineRow[], columns: readonly EngineColumn[]): RowKey[] {
    const tmp = new IndexEngine();
    tmp.load(
      rows.map((r) => r.data),
      { keyField: this.viewContext?.keyField() ?? null, columns: [...columns] },
    );
    tmp.setFilter(this.currentFilter);
    tmp.setSort(this.currentSort);
    const { rowCount } = tmp.getCounts();
    return tmp.getWindow(0, rowCount).rows.map((r) => r.key);
  }

  /**
   * `MSG-APPLY-EDIT` — writes one cell in the worker and resolves the edit
   * result (incl. the authoritative `oldValue`). Fires no window/summary reply
   * of its own; the caller refreshes the view.
   */
  applyEdit(rowKey: RowKey, field: string, value: unknown): Promise<EditApplyResult> {
    return this.request<EditApplyResult>((reqId) => ({
      kind: 'apply-edit',
      reqId,
      rowKey,
      field,
      value,
    }));
  }

  /**
   * `MSG-PASTE-APPLY` — apply a resolved paste block (many cells) in one worker
   * round-trip; resolves the per-cell old/new values for the single undoable
   * `Command` (`COMPONENT-CLIPBOARD`, `PERF-PASTE`).
   */
  pasteApply(
    anchor: CellRef,
    cells: readonly { rowKey: RowKey; field: string; value: unknown }[],
  ): Promise<PasteApplyResult> {
    return this.request<PasteApplyResult>((reqId) => ({
      kind: 'paste-apply',
      reqId,
      anchor,
      cells,
    }));
  }

  /** `MSG-INSERT` — insert a block of keyed rows at an ordered index. */
  insertRows(atIndex: number, rows: readonly WireRow[]): Promise<StructResult> {
    return this.request<StructResult>((reqId) => ({ kind: 'insert', reqId, atIndex, rows }));
  }

  /** `MSG-REMOVE` — remove rows by key. */
  removeRows(rowKeys: readonly RowKey[]): Promise<StructResult> {
    return this.request<StructResult>((reqId) => ({ kind: 'remove', reqId, rowKeys }));
  }

  /** `MSG-INSERT-COL` — add a column (blank, or restored with `values`). */
  insertColumn(
    atIndex: number,
    column: WireColumn,
    values?: readonly { rowKey: RowKey; value: unknown }[],
  ): Promise<StructResult> {
    return this.request<StructResult>((reqId) => ({
      kind: 'insert-col',
      reqId,
      atIndex,
      column,
      ...(values ? { values } : {}),
    }));
  }

  /** `MSG-REMOVE-COL` — drop a column + delete its field from every row. */
  removeColumn(columnId: string, field: string): Promise<StructResult> {
    return this.request<StructResult>((reqId) => ({
      kind: 'remove-col',
      reqId,
      columnId,
      field,
    }));
  }

  /**
   * `MSG-AGGREGATE` — full-dataset aggregate for conditional formatting
   * (`ADR-CONDFMT-AGG`). `topN` with a negative `n` = bottom `|n|`.
   */
  aggregate(
    columnId: string,
    agg: 'min' | 'max' | 'topN',
    n?: number,
  ): Promise<number | number[]> {
    return this.request<number | number[]>((reqId) => ({
      kind: 'aggregate',
      reqId,
      columnId,
      agg,
      ...(n !== undefined ? { n } : {}),
    }));
  }

  /** Fire-and-forget coalesced viewport query; results arrive via `onWindow`. */
  queryWindow(startIndex: number, endIndex: number): void {
    if (this.crashed) return; // degraded read-only: no new worker ops
    const reqId = this.nextReqId++;
    this.transport.post({ kind: 'query-window', reqId, startIndex, endIndex });
  }

  onWindow(cb: WindowHandler): () => void {
    this.windowHandlers.add(cb);
    return () => this.windowHandlers.delete(cb);
  }

  onSummary(cb: SummaryHandler): () => void {
    this.summaryHandlers.add(cb);
    return () => this.summaryHandlers.delete(cb);
  }

  onError(cb: ErrorHandler): () => void {
    this.errorHandlers.add(cb);
    return () => this.errorHandlers.delete(cb);
  }

  private request<T>(build: (reqId: number) => MainToWorker): Promise<T> {
    const reqId = this.nextReqId++;
    const msg = build(reqId);
    // Recovery: a `load` (setData re-bind) clears the degraded state and proceeds.
    if (msg.kind === 'load') {
      this.crashed = false;
    } else if (this.crashed) {
      // Degraded read-only: reject new worker ops until a re-bind.
      return Promise.reject(
        new GridError(
          'WORKER_CRASHED',
          'Grid is degraded (read-only) after a worker crash; call setData to recover',
          { source: 'data-op' },
        ),
      );
    }
    return new Promise<T>((resolve, reject) => {
      this.pending.set(reqId, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      this.transport.post(msg);
    });
  }

  /**
   * Handle a fatal worker crash (`WORKER_CRASHED`, `PATTERN-ERROR` +
   * worker-resilience policy): reject every in-flight op, notify `onError`
   * subscribers (→ `EVT-ERROR`), and enter the degraded read-only state. The
   * error is thus never console-only. Recovery = the next `load`/`setData`.
   */
  private handleCrash(message: string): void {
    this.crashed = true;
    const err = new GridError('WORKER_CRASHED', message, { source: 'data-op' });
    for (const [reqId, p] of this.pending) {
      this.pending.delete(reqId);
      p.reject(err);
    }
    for (const h of this.errorHandlers) h(err);
  }

  private onMessage(msg: WorkerToMain): void {
    switch (msg.kind) {
      case 'index-summary': {
        this.cachedCounts = {
          rowCount: msg.rowCount,
          totalRowCount: msg.totalRowCount,
        };
        if (msg.version > this.version) this.version = msg.version;
        if (msg.reqId !== undefined) {
          const p = this.pending.get(msg.reqId);
          if (p) {
            this.pending.delete(msg.reqId);
            p.resolve({
              rowCount: msg.rowCount,
              totalRowCount: msg.totalRowCount,
            });
          }
        }
        for (const h of this.summaryHandlers) {
          h(
            { rowCount: msg.rowCount, totalRowCount: msg.totalRowCount },
            msg.version,
          );
        }
        return;
      }
      case 'edit-result': {
        // A cell edit resolved: refresh cached counts + version, then resolve
        // the pending `LIB-UPDATE-CELL` promise with the authoritative result.
        this.cachedCounts = {
          rowCount: msg.rowCount,
          totalRowCount: msg.totalRowCount,
        };
        if (msg.version > this.version) this.version = msg.version;
        const p = this.pending.get(msg.reqId);
        if (p) {
          this.pending.delete(msg.reqId);
          p.resolve({
            rowKey: msg.rowKey,
            field: msg.field,
            oldValue: msg.oldValue,
            newValue: msg.newValue,
          });
        }
        return;
      }
      case 'paste-result': {
        // A paste block resolved: refresh cached counts + version, then resolve
        // the pending `pasteApply` promise with the per-cell old/new values.
        this.cachedCounts = {
          rowCount: msg.rowCount,
          totalRowCount: msg.totalRowCount,
        };
        if (msg.version > this.version) this.version = msg.version;
        const p = this.pending.get(msg.reqId);
        if (p) {
          this.pending.delete(msg.reqId);
          p.resolve(msg.results);
        }
        return;
      }
      case 'struct-result': {
        this.cachedCounts = {
          rowCount: msg.rowCount,
          totalRowCount: msg.totalRowCount,
        };
        if (msg.version > this.version) this.version = msg.version;
        const p = this.pending.get(msg.reqId);
        if (p) {
          this.pending.delete(msg.reqId);
          const result: StructResult = {
            op: msg.op,
            rowCount: msg.rowCount,
            totalRowCount: msg.totalRowCount,
            ...(msg.atIndex !== undefined ? { atIndex: msg.atIndex } : {}),
            ...(msg.removed
              ? {
                  removed: msg.removed.map((e) => ({
                    index: e.index,
                    row: { key: e.row.key, data: e.row.data },
                  })),
                }
              : {}),
            ...(msg.removedField !== undefined ? { removedField: msg.removedField } : {}),
            ...(msg.removedValues ? { removedValues: msg.removedValues } : {}),
          };
          p.resolve(result);
        }
        return;
      }
      case 'aggregate-result': {
        // Explicit read — resolves its Promise by `reqId` (no version gating).
        const p = this.pending.get(msg.reqId);
        if (p) {
          this.pending.delete(msg.reqId);
          p.resolve(msg.result);
        }
        return;
      }
      case 'recalc-result': {
        this.cachedCounts = { rowCount: msg.rowCount, totalRowCount: msg.totalRowCount };
        if (msg.version > this.version) this.version = msg.version;
        const p = this.pending.get(msg.reqId);
        if (p) {
          this.pending.delete(msg.reqId);
          p.resolve({ changed: msg.changed, cycles: msg.cycles });
        }
        return;
      }
      case 'export-rows-result': {
        // Explicit read (main-thread custom-fn path) — resolves by `reqId`.
        const p = this.pending.get(msg.reqId);
        if (p) {
          this.pending.delete(msg.reqId);
          p.resolve(msg.rows.map((r) => ({ key: r.key, data: r.data })));
        }
        return;
      }
      case 'window': {
        const result: WindowResult = {
          startIndex: msg.startIndex,
          rows: msg.rows.map((r) => ({ key: r.key, data: r.data })),
          version: msg.version,
        };
        // Explicit read (getRows) — always resolve its Promise.
        const p = this.pending.get(msg.reqId);
        if (p) {
          this.pending.delete(msg.reqId);
          if (msg.version > this.version) this.version = msg.version;
          p.resolve(result);
          return;
        }
        // Coalesced viewport window — drop if superseded by a newer version.
        if (this.isStaleWindow(msg)) {
          this.droppedWindows++;
          return;
        }
        this.version = msg.version;
        for (const h of this.windowHandlers) h(result);
        return;
      }
      case 'error': {
        const err = new GridError(msg.code, msg.message, {
          source: sourceForCode(msg.code),
          ...(msg.context ? { context: msg.context } : {}),
        });
        if (msg.reqId !== undefined) {
          const p = this.pending.get(msg.reqId);
          if (p) {
            this.pending.delete(msg.reqId);
            p.reject(err);
          }
        }
        for (const h of this.errorHandlers) h(err);
        return;
      }
    }
  }

  private isStaleWindow(msg: MsgWindow): boolean {
    return msg.version < this.version;
  }
}
