/**
 * Total error model (`ERR-*`, `PATTERN-ERROR`). Every error surfaced by the grid
 * is a `GridError`; it reaches a user-visible surface — thrown to the developer,
 * promise-rejected, or carried on `EVT-ERROR` — **never only the console**.
 *
 * Slice 2 finalizes the full catalog. Only the config codes are actually thrown
 * yet (`DUPLICATE_ROW_KEY`/`DUPLICATE_COLUMN_ID`/`INVALID_OPTIONS`/
 * `INVALID_COLUMN_DEF`) plus the worker-resilience codes (`WORKER_OP_FAILED`/
 * `WORKER_CRASHED`); the remaining codes are defined here for later slices.
 */
import type { ColumnId, Range, RowKey } from './types.js';

/**
 * The full `ERR-*` catalog (Interfaces "Error model"). `ADAPTER_ERROR` is a
 * defined-but-unused v2 code (async `DataSource`).
 */
export type ErrCode =
  | 'DUPLICATE_ROW_KEY'
  | 'DUPLICATE_COLUMN_ID'
  | 'INVALID_OPTIONS'
  | 'INVALID_COLUMN_DEF'
  | 'VALIDATION_FAILED'
  | 'MERGE_OVERLAP'
  | 'GROUP_OVERLAP'
  | 'WORKER_OP_FAILED'
  | 'WORKER_CRASHED'
  | 'XLSX_UNAVAILABLE'
  | 'EXPORT_FAILED'
  | 'FORMULA_PARSE_FAILED'
  | 'FORMULA_DISABLED'
  | 'ADAPTER_ERROR';

export type ErrSeverity = 'error' | 'warning';

export type ErrSource =
  | 'config'
  | 'validation'
  | 'operation'
  | 'data-op'
  | 'export'
  | 'adapter';

export interface ErrContext {
  rowKey?: RowKey;
  columnId?: ColumnId;
  columnIndex?: number;
  range?: Range;
}

export interface GridErrorOptions {
  severity?: ErrSeverity;
  source?: ErrSource;
  context?: ErrContext;
}

/**
 * `class GridError extends Error { code; severity; source; context }` — the
 * single error type surfaced by the grid (Interfaces error model).
 */
export class GridError extends Error {
  readonly code: ErrCode;
  readonly severity: ErrSeverity;
  readonly source: ErrSource;
  readonly context?: ErrContext;

  constructor(code: ErrCode, message: string, options: GridErrorOptions = {}) {
    super(message);
    this.name = 'GridError';
    this.code = code;
    this.severity = options.severity ?? 'error';
    this.source = options.source ?? 'operation';
    if (options.context) this.context = options.context;
    // Preserve prototype chain across the ES5 `extends Error` transpile.
    Object.setPrototypeOf(this, GridError.prototype);
  }
}

export function isGridError(value: unknown): value is GridError {
  return value instanceof GridError;
}

/**
 * Default `ErrSource` implied by a catalog code (used to rebuild a `GridError`
 * across the worker seam from an `MSG-ERROR` that carries only the code). Mirrors
 * the `Source` column of the Interfaces `ERR-*` catalog.
 */
export function sourceForCode(code: ErrCode): ErrSource {
  switch (code) {
    case 'DUPLICATE_ROW_KEY':
    case 'DUPLICATE_COLUMN_ID':
    case 'INVALID_OPTIONS':
    case 'INVALID_COLUMN_DEF':
      return 'config';
    case 'VALIDATION_FAILED':
    case 'FORMULA_PARSE_FAILED':
      return 'validation';
    case 'FORMULA_DISABLED':
      return 'config';
    case 'MERGE_OVERLAP':
    case 'GROUP_OVERLAP':
      return 'operation';
    case 'WORKER_OP_FAILED':
    case 'WORKER_CRASHED':
      return 'data-op';
    case 'XLSX_UNAVAILABLE':
    case 'EXPORT_FAILED':
      return 'export';
    case 'ADAPTER_ERROR':
      return 'adapter';
  }
}

/**
 * Normalize any thrown/rejected value to a `GridError` (`PATTERN-ERROR`: no raw
 * framework/worker error escapes). A non-`GridError` is wrapped as a generic
 * `WORKER_OP_FAILED` data-op failure.
 */
export function toGridError(raw: unknown): GridError {
  if (raw instanceof GridError) return raw;
  const message = raw instanceof Error ? raw.message : String(raw);
  return new GridError('WORKER_OP_FAILED', message, { source: 'data-op' });
}

/**
 * `PATTERN-ERROR` routing predicate. Config/programmer errors
 * (`source:'config'|'operation'`) surface **only** by throw/reject to the
 * developer; runtime/async errors (`source:'data-op'|'export'|'adapter'`)
 * ADDITIONALLY surface on `EVT-ERROR`. (`'validation'` surfaces on its own
 * `EVT-VALIDATION-ERROR`, wired in the editing slice.)
 */
export function shouldEmitErrorEvent(err: GridError): boolean {
  return (
    err.source === 'data-op' ||
    err.source === 'export' ||
    err.source === 'adapter'
  );
}

/**
 * The `PATTERN-ERROR` router. Normalizes `raw` to a `GridError` and, when it is a
 * runtime/async error, emits it via `emitError` (the `EVT-ERROR` sink). Always
 * returns the normalized error so the caller can throw/reject it — a routed error
 * is thus **never console-only**: it reaches the developer (throw/reject) and,
 * for runtime errors, a listener (`EVT-ERROR`).
 */
export function routeError(
  raw: unknown,
  emitError: (error: GridError) => void,
): GridError {
  const err = toGridError(raw);
  if (shouldEmitErrorEvent(err)) emitError(err);
  return err;
}
