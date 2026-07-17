/**
 * `EngineHost` — the worker-side dispatcher that runs an `IndexEngine` and
 * speaks the `MSG-*` protocol. It is transport-agnostic: it takes a decoded
 * `MainToWorker` message and returns the `WorkerToMain` replies to post back.
 * Both the real Web Worker host and the in-process transport drive it.
 *
 * Protocol rules realized (`PATTERN-WORKER-PROTOCOL`): mutations bump the index
 * `version` and reply `MSG-INDEX-SUMMARY`; window queries reply `MSG-WINDOW`
 * stamped with the current `version`; any thrown error becomes `MSG-ERROR`.
 */
import { GridError } from '../errors.js';
import { IndexEngine } from '../engine/index-engine.js';
import type { EngineColumn } from '../engine/index-engine.js';
import type {
  MainToWorker,
  MsgIndexSummary,
  MsgStructResult,
  MsgError,
  WorkerToMain,
} from './messages.js';

export class EngineHost {
  private readonly engine: IndexEngine;

  constructor(engine: IndexEngine = new IndexEngine()) {
    this.engine = engine;
  }

  handle(msg: MainToWorker): WorkerToMain[] {
    try {
      switch (msg.kind) {
        case 'load': {
          const columns: EngineColumn[] = msg.columns.map((c) => ({
            id: c.id,
            field: c.field,
            ...(c.type !== undefined ? { type: c.type } : {}),
          }));
          this.engine.load(msg.rows, {
            keyField: msg.keyField,
            columns,
            onDuplicateKey: msg.onDuplicateKey,
            ...(msg.formula !== undefined ? { formula: msg.formula } : {}),
            ...(msg.locale !== undefined ? { locale: msg.locale } : {}),
          });
          return [this.summary(msg.reqId)];
        }
        case 'query-window': {
          const w = this.engine.getWindow(msg.startIndex, msg.endIndex, msg.allData);
          return [
            {
              kind: 'window',
              reqId: msg.reqId,
              startIndex: w.startIndex,
              rows: w.rows.map((r) => ({ key: r.key, data: r.data })),
              version: this.engine.version,
            },
          ];
        }
        case 'query-count':
          return [this.summary(msg.reqId)];
        case 'sort':
          this.engine.setSort(msg.spec);
          return [this.summary(msg.reqId)];
        case 'filter':
          this.engine.setFilter(msg.spec);
          return [this.summary(msg.reqId)];
        case 'export-rows':
          return [
            {
              kind: 'export-rows-result',
              reqId: msg.reqId,
              // P12 (PERF-FRAME-STEADY): `exportRows()` already returns `{key, data}`
              // objects — the previous `.map` re-wrapped them into an identical shape
              // (a second full-n allocation) for nothing.
              rows: this.engine.exportRows(),
            },
          ];
        case 'set-index':
          this.engine.setExplicitIndex(msg.orderedKeys, msg.sort, msg.filter);
          return [this.summary(msg.reqId)];
        case 'apply-edit': {
          const r = this.engine.applyEdit(msg.rowKey, msg.field, msg.value);
          const counts = this.engine.getCounts();
          return [
            {
              kind: 'edit-result',
              reqId: msg.reqId,
              rowKey: r.rowKey,
              field: r.field,
              oldValue: r.oldValue,
              newValue: r.newValue,
              version: this.engine.version,
              rowCount: counts.rowCount,
              totalRowCount: counts.totalRowCount,
            },
          ];
        }
        case 'paste-apply': {
          const results = this.engine.applyPaste(msg.cells);
          const counts = this.engine.getCounts();
          return [
            {
              kind: 'paste-result',
              reqId: msg.reqId,
              results,
              version: this.engine.version,
              rowCount: counts.rowCount,
              totalRowCount: counts.totalRowCount,
            },
          ];
        }
        case 'insert': {
          const res = this.engine.insertRows(
            msg.atIndex,
            msg.rows.map((r) => ({ key: r.key, data: r.data })),
          );
          return [this.structResult(msg.reqId, 'insert', { atIndex: res.atIndex })];
        }
        case 'remove': {
          const res = this.engine.removeRows(msg.rowKeys);
          return [
            this.structResult(msg.reqId, 'remove', {
              removed: res.removed.map((e) => ({
                index: e.index,
                row: { key: e.row.key, data: e.row.data },
              })),
            }),
          ];
        }
        case 'insert-col': {
          this.engine.insertColumn(
            {
              id: msg.column.id,
              field: msg.column.field,
              ...(msg.column.type !== undefined ? { type: msg.column.type } : {}),
            },
            msg.values,
          );
          return [this.structResult(msg.reqId, 'insert-col', {})];
        }
        case 'remove-col': {
          const res = this.engine.removeColumn(msg.columnId, msg.field);
          return [
            this.structResult(msg.reqId, 'remove-col', {
              removedField: res.removedField,
              removedValues: res.values,
            }),
          ];
        }
        case 'recalc': {
          if (msg.locale !== undefined) this.engine.setFormulaLocale(msg.locale);
          const summary = this.engine.recalcAllFormulas();
          const counts = this.engine.getCounts();
          return [
            {
              kind: 'recalc-result',
              reqId: msg.reqId,
              changed: summary.changed,
              cycles: summary.cycles,
              version: this.engine.version,
              rowCount: counts.rowCount,
              totalRowCount: counts.totalRowCount,
            },
          ];
        }
        case 'aggregate': {
          const result = this.engine.aggregate(msg.columnId, msg.agg, msg.n);
          return [
            {
              kind: 'aggregate-result',
              reqId: msg.reqId,
              columnId: msg.columnId,
              agg: msg.agg,
              result,
            },
          ];
        }
      }
    } catch (err) {
      return [this.error(msg.reqId, err)];
    }
  }

  private structResult(
    reqId: number,
    op: MsgStructResult['op'],
    extra: Partial<MsgStructResult>,
  ): MsgStructResult {
    const counts = this.engine.getCounts();
    return {
      kind: 'struct-result',
      reqId,
      op,
      version: this.engine.version,
      rowCount: counts.rowCount,
      totalRowCount: counts.totalRowCount,
      ...extra,
    };
  }

  private summary(reqId: number): MsgIndexSummary {
    const counts = this.engine.getCounts();
    return {
      kind: 'index-summary',
      reqId,
      version: this.engine.version,
      rowCount: counts.rowCount,
      totalRowCount: counts.totalRowCount,
    };
  }

  private error(reqId: number | undefined, err: unknown): MsgError {
    const ge =
      err instanceof GridError
        ? err
        : new GridError(
            'WORKER_OP_FAILED',
            err instanceof Error ? err.message : String(err),
            { source: 'data-op' },
          );
    const out: MsgError = { kind: 'error', code: ge.code, message: ge.message };
    if (reqId !== undefined) out.reqId = reqId;
    if (ge.context) out.context = ge.context;
    return out;
  }
}
