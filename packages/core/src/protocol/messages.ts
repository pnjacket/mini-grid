/**
 * Worker message protocol (`MSG-*`) — typed payloads (`PATTERN-WORKER-PROTOCOL`).
 *
 * Envelope: every message carries a `reqId`; W→M replies that reflect the index
 * carry the monotonic `version`. `kind` is the wire discriminator.
 */
import type { ErrCode, ErrContext } from '../errors.js';
import type {
  CellRef,
  ColumnType,
  FilterSpec,
  OnDuplicateKey,
  RowData,
  RowKey,
  SortSpec,
} from '../types.js';

export interface WireColumn {
  id: string;
  field: string;
  type?: ColumnType;
}

export interface WireRow {
  key: RowKey;
  data: RowData;
}

/* ---- Main -> Worker ---- */

/** `MSG-LOAD`. */
export interface MsgLoad {
  kind: 'load';
  reqId: number;
  rows: readonly RowData[];
  keyField: string | null;
  columns: readonly WireColumn[];
  onDuplicateKey: OnDuplicateKey;
  /** `CAP-FORMULA` — enable formula scan + recalc on this dataset. */
  formula?: boolean;
  /** `COMPONENT-I18N` — initial locale for locale-aware formula text functions. */
  locale?: string;
}

/** `MSG-RECALC` — force a full formula recalc (`LIB-FORMULA-RECALC`). */
export interface MsgRecalc {
  kind: 'recalc';
  reqId: number;
  /** `COMPONENT-I18N` — refresh the formula locale before recalculating (optional). */
  locale?: string;
}

/** `MSG-RECALC-RESULT` — the recalc summary reply. */
export interface MsgRecalcResult {
  kind: 'recalc-result';
  reqId: number;
  changed: number;
  cycles: number;
  version: number;
  rowCount: number;
  totalRowCount: number;
}

/** `MSG-QUERY-WINDOW` — `endIndex` exclusive. */
export interface MsgQueryWindow {
  kind: 'query-window';
  reqId: number;
  startIndex: number;
  endIndex: number;
  /** Export read: window the full pre-filter dataset (`LIB-EXPORT` `allData`). */
  allData?: boolean;
}

/** Count-only query; replies `MSG-INDEX-SUMMARY` tagged with `reqId`. */
export interface MsgQueryCount {
  kind: 'query-count';
  reqId: number;
}

/** `MSG-APPLY-EDIT`. */
export interface MsgApplyEdit {
  kind: 'apply-edit';
  reqId: number;
  rowKey: RowKey;
  field: string;
  value: unknown;
}

/**
 * `MSG-PASTE-APPLY` — apply a paste block to the engine in one worker round-trip
 * (`COMPONENT-CLIPBOARD`; the perf path for a ~10k-cell paste, `PERF-PASTE`).
 *
 * The Interfaces projection is `{ anchor: CellRef; data: string[][] }`; the main
 * thread has already resolved the block against the (main-thread-owned) column
 * order and run per-cell validation (`SEC-PASTE-UNTRUSTED` — values are parsed as
 * PLAIN TEXT, never HTML/eval), so the wire carries the resolved, accepted
 * `cells` list (`MSG-*` is internal + versioned in lockstep). `anchor` is retained
 * for provenance/debugging. The reply is `MSG-PASTE-RESULT` (old values for undo).
 */
export interface MsgPasteApply {
  kind: 'paste-apply';
  reqId: number;
  anchor: CellRef;
  cells: readonly { rowKey: RowKey; field: string; value: unknown }[];
}

/** `MSG-SORT`. */
export interface MsgSort {
  kind: 'sort';
  reqId: number;
  spec: SortSpec;
}

/** `MSG-FILTER`. */
export interface MsgFilter {
  kind: 'filter';
  reqId: number;
  spec: FilterSpec;
}

/** `MSG-INSERT` — insert a block of keyed rows at an ordered index. */
export interface MsgInsertRows {
  kind: 'insert';
  reqId: number;
  atIndex: number;
  rows: readonly WireRow[];
}

/** `MSG-REMOVE` — remove rows by key (tombstoning is tracked on the main thread). */
export interface MsgRemoveRows {
  kind: 'remove';
  reqId: number;
  rowKeys: readonly RowKey[];
}

/**
 * `MSG-INSERT-COL` — add a column to the engine. On a plain insert the column is
 * blank; on an undo/restore, `values` carries the prior per-row field values to
 * write back into `row.data`.
 */
export interface MsgInsertCol {
  kind: 'insert-col';
  reqId: number;
  atIndex: number;
  column: WireColumn;
  values?: readonly { rowKey: RowKey; value: unknown }[];
}

/**
 * `MSG-REMOVE-COL` — drop a column from the engine AND delete its `field` key
 * from every `row.data` (destructive — the reply carries the prior values so the
 * op is undoable).
 */
export interface MsgRemoveCol {
  kind: 'remove-col';
  reqId: number;
  columnId: string;
  field: string;
}

/**
 * `MSG-EXPORT-ROWS` — request every canonical row `{ key, data }` in natural
 * order (sort/filter ignored). Drives the main-thread custom-fn sort/filter path
 * (`ADR-SORT-FILTER-SEAM`); reply is `MSG-EXPORT-ROWS-RESULT`.
 */
export interface MsgExportRows {
  kind: 'export-rows';
  reqId: number;
}

/**
 * `MSG-SET-INDEX` — install an explicitly-computed ordered view (the result of a
 * main-thread custom comparator/predicate). `orderedKeys` is the resulting view
 * in order; `sort`/`filter` carry the SERIALIZABLE baseline (declarative sort +
 * `BuiltinFilter`-only filter — no functions cross the seam) so later structural
 * / built-in ops rebuild coherently. Reply `MSG-INDEX-SUMMARY`.
 * Drives the main-thread custom-fn path (`ADR-SORT-FILTER-SEAM`).
 */
export interface MsgSetIndex {
  kind: 'set-index';
  reqId: number;
  orderedKeys: readonly RowKey[];
  sort: SortSpec;
  filter: FilterSpec;
}

/** `MSG-EXPORT-ROWS-RESULT` — reply to `MSG-EXPORT-ROWS` (all canonical rows). */
export interface MsgExportRowsResult {
  kind: 'export-rows-result';
  reqId: number;
  rows: WireRow[];
}

/**
 * `MSG-AGGREGATE` — request a full-dataset aggregate for conditional formatting
 * (`ADR-CONDFMT-AGG`). `agg` is the operation; `topN` with a NEGATIVE `n`
 * requests the bottom `|n|` (ascending) — the `bottomN` rule case.
 */
export interface MsgAggregate {
  kind: 'aggregate';
  reqId: number;
  columnId: string;
  agg: 'min' | 'max' | 'topN';
  n?: number;
}

export type MainToWorker =
  | MsgLoad
  | MsgQueryWindow
  | MsgQueryCount
  | MsgApplyEdit
  | MsgPasteApply
  | MsgSort
  | MsgFilter
  | MsgInsertRows
  | MsgRemoveRows
  | MsgInsertCol
  | MsgRemoveCol
  | MsgExportRows
  | MsgSetIndex
  | MsgAggregate
  | MsgRecalc;

/* ---- Worker -> Main ---- */

/** `MSG-WINDOW`. */
export interface MsgWindow {
  kind: 'window';
  reqId: number;
  startIndex: number;
  rows: WireRow[];
  version: number;
}

/**
 * `MSG-APPLY-EDIT` reply — carries the resolved edit (old/new value) plus the
 * bumped `version` + counts so the client resolves `LIB-UPDATE-CELL` with the
 * authoritative `oldValue` (needed for the `edit` `Command.revert`).
 */
export interface MsgEditResult {
  kind: 'edit-result';
  reqId: number;
  rowKey: RowKey;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  version: number;
  rowCount: number;
  totalRowCount: number;
}

/**
 * `MSG-PASTE-RESULT` — reply to `MSG-PASTE-APPLY`. Carries the per-cell resolved
 * old/new values (the whole block is one undoable `Command` on the main thread)
 * plus the bumped `version` + counts.
 */
export interface MsgPasteResult {
  kind: 'paste-result';
  reqId: number;
  results: { rowKey: RowKey; field: string; oldValue: unknown; newValue: unknown }[];
  version: number;
  rowCount: number;
  totalRowCount: number;
}

/** `MSG-INDEX-SUMMARY` — a mutation bumps `version` and replies this. */
export interface MsgIndexSummary {
  kind: 'index-summary';
  reqId?: number;
  version: number;
  rowCount: number;
  totalRowCount: number;
  affected?: { startIndex: number; endIndex: number };
}

/**
 * Reply to a structural mutation (`MSG-INSERT`/`-REMOVE`/`-INSERT-COL`/
 * `-REMOVE-COL`). Bumps `version` + counts like `MSG-INDEX-SUMMARY`, and carries
 * the op-specific payload the main thread needs to track `changeState`, adjust
 * the selection, and build the undoable `Command` (row snapshots / prior values).
 */
export interface MsgStructResult {
  kind: 'struct-result';
  reqId: number;
  op: 'insert' | 'remove' | 'insert-col' | 'remove-col';
  version: number;
  rowCount: number;
  totalRowCount: number;
  /** `insert` — the (clamped) ordered index the rows landed at. */
  atIndex?: number;
  /** `remove` — the removed rows + their pre-removal ordered index (for undo). */
  removed?: { index: number; row: WireRow }[];
  /** `remove-col` — the deleted field name. */
  removedField?: string;
  /** `remove-col` — the prior per-row values at the field (for undo restore). */
  removedValues?: { rowKey: RowKey; value: unknown }[];
}

/**
 * `MSG-AGGREGATE-RESULT` — reply to `MSG-AGGREGATE`. `result` is a scalar for
 * `min`/`max`, or the extreme-value array for `topN` (descending for `n>0`,
 * ascending for `n<0`).
 */
export interface MsgAggregateResult {
  kind: 'aggregate-result';
  reqId: number;
  columnId: string;
  agg: 'min' | 'max' | 'topN';
  result: number | number[];
}

/** `MSG-ERROR` — mapped to a catalog `ERR-*` on the main thread. */
export interface MsgError {
  kind: 'error';
  reqId?: number;
  code: ErrCode;
  message: string;
  context?: ErrContext;
}

export type WorkerToMain =
  | MsgWindow
  | MsgIndexSummary
  | MsgEditResult
  | MsgPasteResult
  | MsgStructResult
  | MsgExportRowsResult
  | MsgAggregateResult
  | MsgRecalcResult
  | MsgError;
