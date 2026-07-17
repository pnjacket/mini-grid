/**
 * `IndexEngine` — the PURE, framework-free core of `COMPONENT-DATA-WORKER`.
 *
 * Owns the canonical row store + an ordered/filtered index and the primitive
 * operations over them: load, build index, sort, filter, window-by-ordered-index,
 * counts, and a single-cell edit. It has no DOM, no worker, and no `MSG-*`
 * knowledge — those live in the host (`engine-host.ts`).
 *
 * The public `LIB-SORT` / `LIB-FILTER` API lands in a later slice; sort & filter
 * are implemented here now because they are the engine's core and are exercised
 * by the perf benchmark (`SEQ-SORT` / `SEQ-FILTER`).
 */
import { GridError } from '../errors.js';
import type {
  Comparator,
  ColumnId,
  ColumnType,
  FilterPredicate,
  FilterSpec,
  OnDuplicateKey,
  RowData,
  RowKey,
  SortSpec,
} from '../types.js';
import { getByPath, setByPath } from '../util/path.js';
import { compileBuiltinFilter, isBuiltinFilter } from './builtin-filter.js';
import { FormulaEngine, encodeCellId } from '../formula/engine.js';
import type { GridAccess, RecalcSummary } from '../formula/engine.js';
import { isFormulaSource } from '../formula/index.js';

/** The minimal column shape the engine needs (projection of `ENTITY-COLUMN`). */
export interface EngineColumn {
  id: ColumnId;
  field: string;
  type?: ColumnType;
  comparator?: Comparator;
}

/** `ENTITY-ROW` as held by the engine: identity + host record. */
export interface EngineRow {
  key: RowKey;
  data: RowData;
}

export interface EngineCounts {
  /** Post-filter, logical row count (`ENTITY-SHEET.rowCount`). */
  rowCount: number;
  /** Pre-filter row count (`ENTITY-SHEET.totalRowCount`). */
  totalRowCount: number;
}

export interface EngineWindow {
  startIndex: number;
  rows: EngineRow[];
}

export interface EngineLoadOptions {
  keyField: string | null;
  columns: readonly EngineColumn[];
  onDuplicateKey?: OnDuplicateKey;
  /** `CAP-FORMULA` — scan for `=…` cells + build the recalc graph on load. */
  formula?: boolean;
  /** `COMPONENT-I18N` — active locale for locale-aware formula text fns (`FIXED`/`DOLLAR`/`TEXT`). */
  locale?: string;
}

export interface EngineEditResult {
  rowKey: RowKey;
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

/** Nulls sort first; numbers numerically; everything else by string order. */
export function defaultCompare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a == null) return b == null ? 0 : -1;
  if (b == null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

export class IndexEngine {
  private rows: EngineRow[] = [];
  private readonly rowByKey = new Map<RowKey, number>();
  private readonly columns = new Map<ColumnId, EngineColumn>();
  /** Ordered + filtered view: view position -> index into `rows`. */
  private order: number[] = [];
  private keyField: string | null = null;
  private sortSpec: SortSpec = { entries: [] };
  private filterSpec: FilterSpec = { perColumn: {} };

  // `CAP-FORMULA` — canonical column order + reverse maps for A1 addressing, and
  // the recalc engine (created only when the `formula` feature is enabled).
  private columnsOrdered: EngineColumn[] = [];
  private colIndexById = new Map<ColumnId, number>();
  private fieldToColumnId = new Map<string, ColumnId>();
  private formula: FormulaEngine | null = null;
  private formulaEnabled = false;
  /** `COMPONENT-I18N` — locale handed to the formula resolver for `FIXED`/`DOLLAR`/`TEXT`. */
  private localeTag = 'en-US';

  /** Monotonic index version (`PATTERN-WORKER-PROTOCOL`). */
  version = 0;

  /** Load rows, enforce `INV-ROWKEY-UNIQUE`, and build the initial index. */
  load(rows: readonly RowData[], opts: EngineLoadOptions): EngineCounts {
    this.rows = [];
    this.rowByKey.clear();
    this.columns.clear();
    this.keyField = opts.keyField;
    this.columnsOrdered = [...opts.columns];
    this.colIndexById.clear();
    this.fieldToColumnId.clear();
    opts.columns.forEach((c, i) => {
      this.columns.set(c.id, c);
      this.colIndexById.set(c.id, i);
      this.fieldToColumnId.set(c.field, c.id);
    });
    if (opts.locale !== undefined) this.localeTag = opts.locale;
    this.formulaEnabled = opts.formula === true;
    if (this.formulaEnabled) {
      if (this.formula) this.formula.setAccess(this.buildGridAccess());
      else this.formula = new FormulaEngine(this.buildGridAccess());
      this.formula.clear();
    }

    const policy: OnDuplicateKey = opts.onDuplicateKey ?? 'reject';
    rows.forEach((data, i) => {
      const key: RowKey =
        this.keyField != null
          ? (getByPath(data, this.keyField) as RowKey)
          : i;
      if (this.keyField != null && this.rowByKey.has(key)) {
        if (policy === 'reject') {
          throw new GridError(
            'DUPLICATE_ROW_KEY',
            `Duplicate row key: ${String(key)}`,
            { source: 'config', context: { rowKey: key } },
          );
        }
        // last-wins: overwrite the existing slot; count dedups.
        const idx = this.rowByKey.get(key) as number;
        this.rows[idx] = { key, data };
        return;
      }
      this.rowByKey.set(key, this.rows.length);
      this.rows.push({ key, data });
    });

    this.sortSpec = { entries: [] };
    this.filterSpec = { perColumn: {} };
    if (this.formulaEnabled && this.formula) this.scanAndComputeFormulas();
    this.rebuildIndex();
    this.version++;
    return this.getCounts();
  }

  /**
   * `CAP-FORMULA` load scan — register every `=…` cell and compute the whole
   * graph once (`SEQ-RECALC-FULL`). Computed results are written into
   * `row.data[field]` (`INV-FORMULA-DERIVED`); an unparseable formula is left as
   * literal text (no throw on load).
   */
  private scanAndComputeFormulas(): void {
    const fe = this.formula as FormulaEngine;
    const cols = this.columnsOrdered;
    for (let ri = 0; ri < this.rows.length; ri++) {
      const data = (this.rows[ri] as EngineRow).data;
      const key = (this.rows[ri] as EngineRow).key;
      for (let ci = 0; ci < cols.length; ci++) {
        const col = cols[ci] as EngineColumn;
        const raw = col.field.includes('.') ? getByPath(data, col.field) : data[col.field];
        if (isFormulaSource(raw)) {
          try {
            fe.setFormula(key, col.id, ci, ri, raw);
          } catch {
            /* invalid formula on load → leave the raw text as a literal */
          }
        }
      }
    }
    if (fe.hasFormulas) fe.recalcAll();
  }

  /** Build the `GridAccess` the formula engine reads/writes through. */
  private buildGridAccess(): GridAccess {
    return {
      colCount: () => this.columnsOrdered.length,
      rowCount: () => this.rows.length,
      columnIdAt: (ci) => (this.columnsOrdered[ci] as EngineColumn | undefined)?.id,
      keyAt: (ri) => (this.rows[ri] as EngineRow | undefined)?.key,
      rowIndexOfKey: (rk) => this.rowByKey.get(rk),
      colIndexOfId: (cid) => this.colIndexById.get(cid),
      readLiteral: (ci, ri) => {
        const col = this.columnsOrdered[ci] as EngineColumn | undefined;
        const row = this.rows[ri] as EngineRow | undefined;
        if (!col || !row) return null;
        return col.field.includes('.') ? getByPath(row.data, col.field) : row.data[col.field];
      },
      writeDisplay: (rowKey, columnId, value) => {
        const idx = this.rowByKey.get(rowKey);
        if (idx == null) return;
        const field = this.columns.get(columnId)?.field ?? columnId;
        setByPath((this.rows[idx] as EngineRow).data, field, value);
      },
      now: () => new Date(),
      locale: () => this.localeTag,
    };
  }

  /**
   * `COMPONENT-I18N` — swap the locale used by locale-aware formula text functions.
   * The caller triggers a recalc so `FIXED`/`DOLLAR`/`TEXT` cells re-format.
   */
  setFormulaLocale(locale: string): void {
    this.localeTag = locale;
  }

  /** `CAP-FORMULA` — the raw `=…` source of a formula cell (main-thread mirror seed). */
  getFormulaSource(rowKey: RowKey, columnId: ColumnId): string | undefined {
    return this.formula?.getSource(rowKey, columnId);
  }

  /** `LIB-FORMULA-RECALC` — force a full recalc; returns the change/cycle summary. */
  recalcAllFormulas(): RecalcSummary {
    if (!this.formulaEnabled || !this.formula) return { changed: 0, cycles: 0 };
    const summary = this.formula.recalcAll();
    this.version++;
    return summary;
  }

  /** Rebuild the formula graph after a structural mutation (`INV-FORMULA-REBUILD`). */
  private rebuildFormulaGraph(): void {
    if (!this.formulaEnabled || !this.formula || !this.formula.hasFormulas) return;
    this.formula.rebuild((rowKey, columnId) => {
      const rowIndex = this.rowByKey.get(rowKey);
      const colIndex = this.colIndexById.get(columnId);
      if (rowIndex == null || colIndex == null) return undefined;
      return { colIndex, rowIndex };
    });
  }

  /**
   * `INV-FORMULA-REBUILD` — rewrite A1 references across all formulas for a
   * structural insert/delete on `axis` at canonical index `at` (signed `delta`),
   * so references keep pointing at the same rows (a deleted band → `#REF!`).
   */
  private translateFormulas(axis: 'row' | 'col', at: number, delta: number): void {
    if (!this.formulaEnabled || !this.formula || !this.formula.hasFormulas) return;
    this.formula.applyStructural(axis, at, delta, (rowKey, columnId) => {
      const rowIndex = this.rowByKey.get(rowKey);
      const colIndex = this.colIndexById.get(columnId);
      if (rowIndex == null || colIndex == null) return undefined;
      return { colIndex, rowIndex };
    });
  }

  /** Set the sort spec, rebuild the index, bump `version`. */
  setSort(spec: SortSpec): EngineCounts {
    this.sortSpec = spec;
    this.rebuildIndex();
    this.version++;
    return this.getCounts();
  }

  /** Set the filter spec, rebuild the index, bump `version`. Empty = all rows. */
  setFilter(spec: FilterSpec): EngineCounts {
    this.filterSpec = spec;
    this.rebuildIndex();
    this.version++;
    return this.getCounts();
  }

  getCounts(): EngineCounts {
    return { rowCount: this.order.length, totalRowCount: this.rows.length };
  }

  /**
   * `MSG-EXPORT-ROWS` — every canonical row `{ key, data }` in natural (load)
   * order, ignoring the active sort/filter. Feeds the **main-thread custom-fn
   * path** (`ADR-SORT-FILTER-SEAM`): when a sort/filter carries a function that
   * can't cross the seam, the main thread pulls the full dataset, computes the
   * ordered/filtered key list itself, and installs it via `setExplicitIndex`.
   */
  exportRows(): EngineRow[] {
    return this.rows.map((r) => ({ key: r.key, data: r.data }));
  }

  /**
   * `MSG-SET-INDEX` — install an explicitly-computed ordered view (the result of
   * a main-thread custom-fn sort/filter). `orderedKeys` is the resulting view in
   * order; unknown keys are skipped. `builtinSort`/`builtinFilter` record the
   * serializable baseline so a LATER structural mutation or pure-built-in op
   * rebuilds coherently. Bumps `version` (`PATTERN-WORKER-PROTOCOL`).
   */
  setExplicitIndex(
    orderedKeys: readonly RowKey[],
    builtinSort: SortSpec,
    builtinFilter: FilterSpec,
  ): EngineCounts {
    this.sortSpec = builtinSort;
    this.filterSpec = builtinFilter;
    const order: number[] = [];
    for (const k of orderedKeys) {
      const idx = this.rowByKey.get(k);
      if (idx != null) order.push(idx);
    }
    this.order = order;
    this.version++;
    return this.getCounts();
  }

  /**
   * `MSG-AGGREGATE` — full-dataset numeric aggregate for conditional formatting
   * (`ADR-CONDFMT-AGG`). Computed over ALL rows (pre-filter), skipping
   * non-numeric values. `topN` returns the `n` largest DESCENDING; a NEGATIVE
   * `n` returns the `|n|` smallest ASCENDING (`bottomN`). Empty → `min`/`max`
   * are `NaN`, `topN` is `[]`.
   */
  aggregate(
    columnId: ColumnId,
    kind: 'min' | 'max' | 'topN',
    n?: number,
  ): number | number[] {
    const field = this.columns.get(columnId)?.field ?? columnId;
    const simple = !field.includes('.');
    const values: number[] = [];
    for (const row of this.rows) {
      const raw = simple ? row.data[field] : getByPath(row.data, field);
      const num = typeof raw === 'number' ? raw : Number(raw);
      if (typeof raw !== 'boolean' && raw != null && raw !== '' && Number.isFinite(num)) {
        values.push(num);
      }
    }
    if (kind === 'min' || kind === 'max') {
      if (values.length === 0) return NaN;
      // Loop (not `Math.min(...values)`) — spreading 1M args overflows the stack.
      let acc = values[0] as number;
      for (let i = 1; i < values.length; i++) {
        const v = values[i] as number;
        if (kind === 'min' ? v < acc : v > acc) acc = v;
      }
      return acc;
    }
    // topN: n>0 → largest descending; n<0 → smallest ascending (bottom |n|).
    const count = Math.abs(n ?? 10);
    const bottom = (n ?? 10) < 0;
    if (count <= 0 || values.length === 0) return [];
    // P11 (SCALE-AGG-TOPN): select the `count` most-extreme values in a single
    // O(n·count) pass (count is tiny, ~10), not a full O(n log n) sort + full-size
    // clone to keep just the top `count`. `top` stays most-extreme-first — same set
    // and order as `values.sort(...).slice(0, count)`.
    const top: number[] = [];
    for (let i = 0; i < values.length; i++) {
      const v = values[i] as number;
      const least = top[top.length - 1] as number;
      if (top.length < count || (bottom ? v < least : v > least)) {
        let j = top.length;
        top.push(v);
        while (j > 0) {
          const prev = top[j - 1] as number;
          if (bottom ? v < prev : v > prev) {
            top[j] = prev;
            j--;
          } else break;
        }
        top[j] = v;
        if (top.length > count) top.pop();
      }
    }
    return top;
  }

  /**
   * Window by ordered index. `endIndex` is exclusive; the range is clamped to
   * `[0, rowCount)` — the one canonical bound (`LIB-GET-ROWS`).
   *
   * `allData` (export `opts.allData`) windows the **full pre-filter dataset** in
   * the current sort order instead of the filtered view — used by CSV/xlsx export
   * to emit every row regardless of the active filter.
   */
  getWindow(startIndex: number, endIndex: number, allData = false): EngineWindow {
    const order = allData ? this.fullOrder() : this.order;
    const len = order.length;
    const start = Math.max(0, Math.min(startIndex, len));
    const end = Math.max(start, Math.min(endIndex, len));
    const rows: EngineRow[] = [];
    for (let i = start; i < end; i++) {
      rows.push(this.rows[order[i] as number] as EngineRow);
    }
    return { startIndex: start, rows };
  }

  /** Full-dataset order (all rows, current sort applied, filter ignored). */
  private fullOrder(): number[] {
    const idxs = new Array<number>(this.rows.length);
    for (let i = 0; i < this.rows.length; i++) idxs[i] = i;
    if (this.sortSpec.entries.length > 0) this.sortIndex(idxs);
    return idxs;
  }

  /**
   * Apply a single-cell edit. Mutates the host record in place; the cell value
   * stays derived (`INV-CELL-DERIVED`) because there is no dense cell store.
   */
  applyEdit(rowKey: RowKey, field: string, value: unknown): EngineEditResult {
    const idx = this.rowByKey.get(rowKey);
    if (idx == null) {
      throw new GridError(
        'WORKER_OP_FAILED',
        `Unknown row key: ${String(rowKey)}`,
        { source: 'data-op', context: { rowKey } },
      );
    }
    const row = this.rows[idx] as EngineRow;
    const fe = this.formula;
    const newIsFormula = this.formulaEnabled && fe !== null && isFormulaSource(value);
    const anyFormulas = this.formulaEnabled && fe !== null && fe.hasFormulas;

    // Fast path (unchanged behavior) when formulas are not in play at all.
    if (!newIsFormula && !anyFormulas) {
      const oldValue = getByPath(row.data, field);
      setByPath(row.data, field, value);
      this.version++;
      return { rowKey, field, oldValue, newValue: value };
    }

    // Formula-aware path (`INV-FORMULA-DERIVED` / `-INCREMENTAL`).
    const engine = fe as FormulaEngine;
    const columnId = this.fieldToColumnId.get(field) ?? field;
    const colIndex = this.colIndexById.get(columnId) ?? -1;
    const hadFormula = engine.isFormula(rowKey, columnId);
    const oldValue = hadFormula ? engine.getSource(rowKey, columnId) : getByPath(row.data, field);

    if (newIsFormula) {
      let cellId: number;
      try {
        cellId = engine.setFormula(rowKey, columnId, colIndex, idx, value as string);
      } catch (err) {
        throw new GridError(
          'FORMULA_PARSE_FAILED',
          err instanceof Error ? err.message : 'Invalid formula',
          { source: 'validation', context: { rowKey, columnId } },
        );
      }
      engine.recalcFrom([cellId]);
    } else if (hadFormula) {
      const cellId = engine.clearFormula(rowKey, columnId);
      setByPath(row.data, field, value);
      engine.recalcFrom([cellId]);
    } else {
      setByPath(row.data, field, value);
      engine.recalcFrom([encodeCellId(idx, colIndex)]);
    }
    this.version++;
    return { rowKey, field, oldValue, newValue: value };
  }

  /**
   * `MSG-PASTE-APPLY` — apply a resolved paste block (many cells) in one call.
   * Writes each `(rowKey, field) := value` in place (`INV-CELL-DERIVED`), skips
   * unknown rows, bumps `version` **once** for the whole block (the paste is one
   * logical mutation — `COMPONENT-CLIPBOARD`), and returns the per-cell old/new
   * values for the single undoable `Command`.
   */
  applyPaste(
    cells: readonly { rowKey: RowKey; field: string; value: unknown }[],
  ): EngineEditResult[] {
    const fe = this.formula;
    const formulaActive =
      this.formulaEnabled &&
      fe !== null &&
      (fe.hasFormulas || cells.some((c) => isFormulaSource(c.value)));

    if (!formulaActive) {
      const out: EngineEditResult[] = [];
      for (const c of cells) {
        const idx = this.rowByKey.get(c.rowKey);
        if (idx == null) continue;
        const row = this.rows[idx] as EngineRow;
        const oldValue = getByPath(row.data, c.field);
        setByPath(row.data, c.field, c.value);
        out.push({ rowKey: c.rowKey, field: c.field, oldValue, newValue: c.value });
      }
      if (out.length > 0) this.version++;
      return out;
    }

    // Formula-aware batch: apply every write, collect seeds, recalc once.
    const engine = fe as FormulaEngine;
    const out: EngineEditResult[] = [];
    const seeds: number[] = [];
    for (const c of cells) {
      const idx = this.rowByKey.get(c.rowKey);
      if (idx == null) continue;
      const row = this.rows[idx] as EngineRow;
      const columnId = this.fieldToColumnId.get(c.field) ?? c.field;
      const colIndex = this.colIndexById.get(columnId) ?? -1;
      const hadFormula = engine.isFormula(c.rowKey, columnId);
      const oldValue = hadFormula ? engine.getSource(c.rowKey, columnId) : getByPath(row.data, c.field);
      if (isFormulaSource(c.value)) {
        try {
          seeds.push(engine.setFormula(c.rowKey, columnId, colIndex, idx, c.value));
        } catch {
          // Defensive fallback only: the main-thread paste path (`applyBatch`) now
          // rejects an invalid `=…` per-cell before it reaches here, so this branch
          // is normally unreachable. If some other caller reaches it, degrade the
          // unparseable formula to literal text rather than throwing mid-batch.
          if (hadFormula) engine.clearFormula(c.rowKey, columnId);
          setByPath(row.data, c.field, c.value);
          seeds.push(encodeCellId(idx, colIndex));
        }
      } else {
        if (hadFormula) seeds.push(engine.clearFormula(c.rowKey, columnId));
        else seeds.push(encodeCellId(idx, colIndex));
        setByPath(row.data, c.field, c.value);
      }
      out.push({ rowKey: c.rowKey, field: c.field, oldValue, newValue: c.value });
    }
    if (seeds.length > 0) engine.recalcFrom(seeds);
    if (out.length > 0) this.version++;
    return out;
  }

  /**
   * `MSG-INSERT` — insert `newRows` (keyed) at ordered index `atIndex` (clamped
   * `[0, rowCount]`). Enforces `INV-ROWKEY-UNIQUE` across the new keys, then
   * reindexes + rebuilds the ordered view and bumps `version`.
   */
  insertRows(
    atIndex: number,
    newRows: readonly EngineRow[],
  ): { atIndex: number; counts: EngineCounts } {
    const at = Math.max(0, Math.min(atIndex, this.order.length));
    const seen = new Set<RowKey>();
    for (const r of newRows) {
      if (this.rowByKey.has(r.key) || seen.has(r.key)) {
        throw new GridError('DUPLICATE_ROW_KEY', `Duplicate row key: ${String(r.key)}`, {
          source: 'config',
          context: { rowKey: r.key },
        });
      }
      seen.add(r.key);
    }
    const canonicalAt =
      at >= this.order.length ? this.rows.length : (this.order[at] as number);
    this.rows.splice(canonicalAt, 0, ...newRows.map((r) => ({ key: r.key, data: r.data })));
    this.reindexRows();
    this.rebuildIndex();
    // Shift references at/after the insertion point down by the inserted count.
    this.translateFormulas('row', canonicalAt, newRows.length);
    this.version++;
    return { atIndex: at, counts: this.getCounts() };
  }

  /**
   * `MSG-REMOVE` — remove rows whose key is in `rowKeys`. Returns each removed row
   * with its pre-removal ordered index (ascending) so the main thread can restore
   * them on undo and re-clamp the selection (`INV-RANGE-BOUNDS`).
   */
  removeRows(rowKeys: readonly RowKey[]): {
    removed: { index: number; row: EngineRow }[];
    counts: EngineCounts;
  } {
    const keySet = new Set(rowKeys);
    const removed: { index: number; row: EngineRow }[] = [];
    for (let p = 0; p < this.order.length; p++) {
      const ri = this.order[p] as number;
      const row = this.rows[ri] as EngineRow;
      if (keySet.has(row.key)) removed.push({ index: p, row: { key: row.key, data: row.data } });
    }
    if (removed.length > 0) {
      // Canonical indices of the removed rows (references live on canonical positions).
      const canon = rowKeys
        .map((k) => this.rowByKey.get(k))
        .filter((x): x is number => x != null)
        .sort((a, b) => a - b);
      const contiguous = canon.length > 0 && (canon[canon.length - 1] as number) - (canon[0] as number) === canon.length - 1;
      this.rows = this.rows.filter((r) => !keySet.has(r.key));
      this.reindexRows();
      this.rebuildIndex();
      // A contiguous canonical deletion shifts references; otherwise just re-resolve.
      if (contiguous) this.translateFormulas('row', canon[0] as number, -canon.length);
      else this.rebuildFormulaGraph();
      this.version++;
    }
    return { removed, counts: this.getCounts() };
  }

  /**
   * `MSG-INSERT-COL` — register a column with the engine (so sort/filter can
   * resolve its field). On restore, `values` writes the prior per-row values back
   * into `row.data`. A plain insert leaves the field derived-empty on every row.
   */
  insertColumn(
    column: EngineColumn,
    values?: readonly { rowKey: RowKey; value: unknown }[],
  ): EngineCounts {
    this.columns.set(column.id, column);
    if (!this.colIndexById.has(column.id)) {
      this.columnsOrdered.push(column);
      this.reindexColumns();
    }
    if (values) {
      // Restore: write the captured prior values back into each row.
      for (const { rowKey, value } of values) {
        const idx = this.rowByKey.get(rowKey);
        if (idx != null) setByPath((this.rows[idx] as EngineRow).data, column.field, value);
      }
    } else {
      // Plain insert: give every row a blank (`null`) value at the new field.
      for (const row of this.rows) setByPath(row.data, column.field, null);
    }
    this.rebuildFormulaGraph();
    this.version++;
    return this.getCounts();
  }

  /**
   * `MSG-REMOVE-COL` — drop the column from the engine AND delete its `field` key
   * from every `row.data` (destructive). Returns the prior values (only for rows
   * that had the field) so the delete is undoable.
   */
  removeColumn(
    columnId: ColumnId,
    field: string,
  ): { removedField: string; values: { rowKey: RowKey; value: unknown }[]; counts: EngineCounts } {
    this.columns.delete(columnId);
    const removedAt = this.colIndexById.get(columnId);
    if (removedAt != null) {
      this.columnsOrdered.splice(removedAt, 1);
      this.reindexColumns();
    }
    const values: { rowKey: RowKey; value: unknown }[] = [];
    const simple = !field.includes('.');
    for (const row of this.rows) {
      if (simple) {
        if (Object.prototype.hasOwnProperty.call(row.data, field)) {
          values.push({ rowKey: row.key, value: row.data[field] });
          delete row.data[field];
        }
      } else {
        const v = getByPath(row.data, field);
        if (v !== undefined) {
          values.push({ rowKey: row.key, value: v });
          setByPath(row.data, field, undefined);
        }
      }
    }
    this.rebuildFormulaGraph();
    this.version++;
    return { removedField: field, values, counts: this.getCounts() };
  }

  /** Rebuild the column-order reverse maps after a column insert/remove. */
  private reindexColumns(): void {
    this.colIndexById.clear();
    this.fieldToColumnId.clear();
    this.columnsOrdered.forEach((c, i) => {
      this.colIndexById.set(c.id, i);
      this.fieldToColumnId.set(c.field, c.id);
    });
  }

  /** Rebuild the `key -> canonical index` map after a structural splice. */
  private reindexRows(): void {
    this.rowByKey.clear();
    for (let i = 0; i < this.rows.length; i++) {
      this.rowByKey.set((this.rows[i] as EngineRow).key, i);
    }
  }

  private rebuildIndex(): void {
    const idxs = this.buildFilteredIndex();
    if (this.sortSpec.entries.length > 0) {
      this.sortIndex(idxs);
    }
    this.order = idxs;
  }

  /**
   * Single-pass filter. Predicate field resolution is hoisted out of the row
   * loop (resolved once per column, not once per row), and simple (dot-free)
   * fields are read directly rather than via `getByPath`.
   */
  private buildFilteredIndex(): number[] {
    const rows = this.rows;
    const n = rows.length;
    const preds = Object.entries(this.filterSpec.perColumn);

    if (preds.length === 0) {
      const idxs = new Array<number>(n);
      for (let i = 0; i < n; i++) idxs[i] = i;
      return idxs;
    }

    // Resolve each predicate's field/path ONCE (hoisted out of the hot loop). A
    // `BuiltinFilter` descriptor is compiled to a predicate HERE (worker-side,
    // `ADR-SORT-FILTER-SEAM`); a custom `FilterPredicate` function is used directly
    // (it only reaches the engine on the in-process transport / main-thread path).
    const compiled = preds.map(([columnId, cf]) => {
      const field = this.columns.get(columnId)?.field ?? columnId;
      const builtin = isBuiltinFilter(cf);
      const pred: FilterPredicate = builtin ? compileBuiltinFilter(cf) : cf;
      // P10 (SCALE-FILTER-CTX): only a custom predicate reads the `FilterContext`;
      // built-ins ignore it, so we skip allocating the per-row context object for them.
      return { columnId, field, pred, simple: !field.includes('.'), custom: !builtin };
    });

    const idxs: number[] = [];
    for (let i = 0; i < n; i++) {
      const row = rows[i] as EngineRow;
      const data = row.data;
      let keep = true;
      for (let p = 0; p < compiled.length; p++) {
        const c = compiled[p] as (typeof compiled)[number];
        const value = c.simple ? data[c.field] : getByPath(data, c.field);
        const ok = c.custom
          ? c.pred(value, { rowKey: row.key, columnId: c.columnId, field: c.field, data })
          : (c.pred as (v: unknown) => boolean)(value);
        if (!ok) {
          keep = false;
          break;
        }
      }
      if (keep) idxs.push(i);
    }
    return idxs;
  }

  /**
   * Sort `idxs` (index into `rows`) in place. Schwartzian transform: the
   * sort-column values are extracted into precomputed key arrays ONCE, so the
   * comparator hot loop touches no `getByPath` and no per-row property lookups.
   * Custom comparators reuse the same precomputed keys.
   */
  private sortIndex(idxs: number[]): void {
    const rows = this.rows;
    const n = rows.length;
    const entries = this.sortSpec.entries.map((e) => {
      const col = this.columns.get(e.columnId);
      const field = col?.field ?? e.columnId;
      // A per-entry `comparator` (v1.1) overrides the column-level one; both are
      // custom functions (main-thread only — `ADR-SORT-FILTER-SEAM`).
      return {
        field,
        simple: !field.includes('.'),
        cmp: e.comparator ?? col?.comparator ?? defaultCompare,
        dir: e.direction === 'desc' ? -1 : 1,
      };
    });

    // Precompute one key array per sort column, indexed by real row index.
    const keyArrays: unknown[][] = entries.map((en) => {
      const arr = new Array<unknown>(n);
      const field = en.field;
      if (en.simple) {
        for (let k = 0; k < idxs.length; k++) {
          const ri = idxs[k] as number;
          arr[ri] = (rows[ri] as EngineRow).data[field];
        }
      } else {
        for (let k = 0; k < idxs.length; k++) {
          const ri = idxs[k] as number;
          arr[ri] = getByPath((rows[ri] as EngineRow).data, field);
        }
      }
      return arr;
    });

    if (entries.length === 1) {
      const { cmp, dir } = entries[0] as (typeof entries)[number];
      const keys = keyArrays[0] as unknown[];
      idxs.sort((ia, ib) => dir * cmp(keys[ia], keys[ib]));
      return;
    }

    idxs.sort((ia, ib) => {
      for (let e = 0; e < entries.length; e++) {
        const en = entries[e] as (typeof entries)[number];
        const r = en.cmp((keyArrays[e] as unknown[])[ia], (keyArrays[e] as unknown[])[ib]);
        if (r !== 0) return r * en.dir;
      }
      return 0;
    });
  }
}
