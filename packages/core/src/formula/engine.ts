/**
 * `CAP-FORMULA-RECALC` — the dependency graph + recalculation engine
 * (`ENTITY-DEP-GRAPH`). Co-located with `IndexEngine` (`COMPONENT-DATA-WORKER`);
 * grid access is abstracted behind `GridAccess` so the engine is unit-testable
 * with a plain in-memory grid.
 *
 * - Full recalc: Kahn topological order over all formula cells; unreached nodes
 *   are cycles → `#CIRC!` (`INV-FORMULA-ACYCLIC`).
 * - Incremental recalc: BFS the edited cell's transitive dependents, topo-order
 *   only that subset (`INV-FORMULA-INCREMENTAL`).
 */
import type { ColumnId, RowKey } from '../types.js';
import { astHasCall, collectRefs, formatAst, translateAst, type FormulaNode } from './ast.js';
import { VOLATILE_FUNCTIONS } from './functions.js';
import { parseFormula } from './parser.js';
import type { CellRefA1, RangeRefA1 } from './references.js';
import {
  ERR,
  fromRaw,
  toDisplay,
  type FormulaValue,
} from './values.js';
import { evaluateResult } from './evaluator.js';
import { isRange, type CellResolver, type RangeValue } from './eval-types.js';

/**
 * A graph node key: a **numeric** cell identity `rowIndex * STRIDE + colIndex`.
 * Numeric (vs a `"r c"` string) so the per-reference hot path in `valueAt`
 * allocates nothing and Map lookups stay monomorphic. `STRIDE` is `2^14` — Excel's
 * column ceiling — so `colIndex` never collides into the next row, and `rowIndex`
 * up to ~2^39 stays inside `Number.MAX_SAFE_INTEGER`. Identity is by canonical
 * position; a structural row/col mutation triggers a full rebuild
 * (`INV-FORMULA-REBUILD`), so positions are stable between rebuilds.
 */
export type CellId = number;
const CELL_ID_STRIDE = 1 << 14;
export function encodeCellId(rowIndex: number, colIndex: number): CellId {
  return rowIndex * CELL_ID_STRIDE + colIndex;
}

/** The grid surface the formula engine reads/writes through. */
export interface GridAccess {
  colCount(): number;
  rowCount(): number;
  columnIdAt(colIndex: number): ColumnId | undefined;
  keyAt(rowIndex: number): RowKey | undefined;
  /** Canonical row index for a row key (for the identity-keyed public API). */
  rowIndexOfKey(rowKey: RowKey): number | undefined;
  /** Canonical column index for a column id (for the identity-keyed public API). */
  colIndexOfId(columnId: ColumnId): number | undefined;
  /** Read a NON-formula cell's raw stored value at a canonical position. */
  readLiteral(colIndex: number, rowIndex: number): unknown;
  /** Write a formula cell's computed display value back into `row.data[field]`. */
  writeDisplay(rowKey: RowKey, columnId: ColumnId, value: number | string | boolean | null): void;
  /** Injected clock for `TODAY`/`NOW`. */
  now(): Date;
  /** `COMPONENT-I18N` — active BCP-47 locale for `FIXED`/`DOLLAR`/`TEXT` (optional). */
  locale?(): string;
}

interface FormulaCell {
  cellId: CellId;
  rowKey: RowKey;
  columnId: ColumnId;
  colIndex: number;
  rowIndex: number;
  src: string;
  ast: FormulaNode;
  precedents: CellId[];
  volatile: boolean;
}

export interface RecalcSummary {
  changed: number;
  cycles: number;
  /** `CAP-FORMULA-ARRAY` — a spill range was created, resized, or removed this pass. */
  spillChanged?: boolean;
}

export class FormulaEngine {
  private readonly formulas = new Map<CellId, FormulaCell>();
  private readonly values = new Map<CellId, FormulaValue>();
  private readonly dependents = new Map<CellId, Set<CellId>>();
  /** `CAP-FORMULA-VOLATILE` — cells that recompute on every recalc (RAND/NOW/…). */
  private readonly volatileCells = new Set<CellId>();
  /** `CAP-FORMULA-ARRAY` — anchor cellId → the cells it spilled into (excludes anchor). */
  private readonly spillRegions = new Map<CellId, CellId[]>();
  /** Spilled-into cellId → its owning anchor (for #SPILL! blocking detection). */
  private readonly spilledInto = new Map<CellId, CellId>();
  /** Anchor cellId → its spilled extent `{rows, cols}` (for the `A1#` operator). */
  private readonly spillShape = new Map<CellId, { rows: number; cols: number }>();

  constructor(private access: GridAccess) {}

  setAccess(access: GridAccess): void {
    this.access = access;
  }

  /** `true` when any formula is registered (fast-path gate for the host). */
  get hasFormulas(): boolean {
    return this.formulas.size > 0;
  }

  get formulaCount(): number {
    return this.formulas.size;
  }

  /** Resolve an identity `(rowKey, columnId)` to its numeric cell id, or `undefined`. */
  private idOf(rowKey: RowKey, columnId: ColumnId): CellId | undefined {
    const rowIndex = this.access.rowIndexOfKey(rowKey);
    const colIndex = this.access.colIndexOfId(columnId);
    if (rowIndex === undefined || colIndex === undefined) return undefined;
    return encodeCellId(rowIndex, colIndex);
  }

  /** Raw `=…` source of a formula cell, if any (`LIB-FORMULA-GET`). */
  getSource(rowKey: RowKey, columnId: ColumnId): string | undefined {
    const id = this.idOf(rowKey, columnId);
    return id === undefined ? undefined : this.formulas.get(id)?.src;
  }

  isFormula(rowKey: RowKey, columnId: ColumnId): boolean {
    const id = this.idOf(rowKey, columnId);
    return id === undefined ? false : this.formulas.has(id);
  }

  // --- Mutations -----------------------------------------------------------

  /**
   * Register/replace a formula at a cell. Throws (via `parseFormula`) on a syntax
   * error — the caller maps that to `FORMULA_PARSE_FAILED`. Returns the cellId.
   */
  setFormula(rowKey: RowKey, columnId: ColumnId, colIndex: number, rowIndex: number, src: string): CellId {
    const ast = parseFormula(src); // may throw FormulaSyntaxError
    const cellId = encodeCellId(rowIndex, colIndex);
    this.detachEdges(cellId);
    const precedents = this.resolvePrecedents(ast);
    const volatile = astHasCall(ast, VOLATILE_FUNCTIONS);
    const fc: FormulaCell = { cellId, rowKey, columnId, colIndex, rowIndex, src, ast, precedents, volatile };
    this.formulas.set(cellId, fc);
    if (volatile) this.volatileCells.add(cellId);
    else this.volatileCells.delete(cellId);
    for (const p of precedents) {
      let set = this.dependents.get(p);
      if (!set) {
        set = new Set();
        this.dependents.set(p, set);
      }
      set.add(cellId);
    }
    return cellId;
  }

  /** Drop a formula (the cell became a literal). Returns its cellId (for recalc seeding). */
  clearFormula(rowKey: RowKey, columnId: ColumnId): CellId {
    const cellId = this.idOf(rowKey, columnId) ?? -1;
    this.detachEdges(cellId);
    this.clearSpill(cellId);
    this.formulas.delete(cellId);
    this.values.delete(cellId);
    this.volatileCells.delete(cellId);
    return cellId;
  }

  private detachEdges(cellId: CellId): void {
    const prev = this.formulas.get(cellId);
    if (!prev) return;
    for (const p of prev.precedents) this.dependents.get(p)?.delete(cellId);
  }

  private resolvePrecedents(ast: FormulaNode): CellId[] {
    const cells: CellRefA1[] = [];
    const ranges: RangeRefA1[] = [];
    collectRefs(ast, cells, ranges);
    const out = new Set<CellId>();
    const cols = this.access.colCount();
    const rows = this.access.rowCount();
    const add = (col: number, row: number): void => {
      if (col < 0 || row < 0 || col >= cols || row >= rows) return;
      out.add(encodeCellId(row, col));
    };
    for (const c of cells) add(c.col, c.row);
    for (const r of ranges) {
      const top = Math.min(r.start.row, r.end.row);
      const bottom = Math.max(r.start.row, r.end.row);
      const left = Math.min(r.start.col, r.end.col);
      const right = Math.max(r.start.col, r.end.col);
      for (let row = top; row <= bottom; row++) {
        for (let col = left; col <= right; col++) add(col, row);
      }
    }
    return [...out];
  }

  // --- Recalculation -------------------------------------------------------

  /** Full recalc over every formula cell (`SEQ-RECALC-FULL`). */
  recalcAll(): RecalcSummary {
    return this.recalcSet(this.formulas.keys());
  }

  /**
   * Incremental recalc seeded at edited cells + their transitive dependents.
   * Volatile cells (`CAP-FORMULA-VOLATILE`) are always folded into the seed so
   * they recompute every pass, even when no precedent changed.
   */
  recalcFrom(seeds: Iterable<CellId>): RecalcSummary {
    if (this.volatileCells.size === 0) return this.recalcSet(seeds);
    const all = new Set<CellId>(seeds);
    for (const v of this.volatileCells) all.add(v);
    return this.recalcSet(all);
  }

  /**
   * Core: BFS the dirty closure of `seeds`, then Kahn-topo only the formula cells
   * within it. Precedents outside the closure keep their current computed values.
   */
  private recalcSet(seeds: Iterable<CellId>): RecalcSummary {
    const spillBefore = this.spillSignature();
    // 1. Dirty closure D = seeds ∪ transitive dependents.
    const D = new Set<CellId>();
    const stack: CellId[] = [];
    for (const s of seeds) stack.push(s);
    while (stack.length > 0) {
      const c = stack.pop() as CellId;
      if (D.has(c)) continue;
      D.add(c);
      const deps = this.dependents.get(c);
      if (deps) for (const d of deps) if (!D.has(d)) stack.push(d);
    }

    // 2. Induced subgraph over the formula cells in D; compute in-degrees.
    const nodes: CellId[] = [];
    for (const id of D) if (this.formulas.has(id)) nodes.push(id);
    const indeg = new Map<CellId, number>();
    for (const id of nodes) indeg.set(id, 0);
    for (const id of nodes) {
      const fc = this.formulas.get(id) as FormulaCell;
      let deg = 0;
      for (const p of fc.precedents) if (indeg.has(p)) deg++;
      indeg.set(id, deg);
    }

    // 3. Kahn — process ready nodes, decrement dependents' in-degree.
    const ready: CellId[] = [];
    for (const id of nodes) if ((indeg.get(id) as number) === 0) ready.push(id);
    let processed = 0;
    let changed = 0;
    while (ready.length > 0) {
      const id = ready.pop() as CellId;
      processed++;
      const fc = this.formulas.get(id) as FormulaCell;
      const v = this.computeAndMaterialize(fc);
      if (!Object.is(this.values.get(id), v)) changed++;
      this.values.set(id, v);
      const deps = this.dependents.get(id);
      if (deps) {
        for (const d of deps) {
          if (indeg.has(d)) {
            const nd = (indeg.get(d) as number) - 1;
            indeg.set(d, nd);
            if (nd === 0) ready.push(d);
          }
        }
      }
    }

    // 4. Any unprocessed formula node is in (or downstream of) a cycle → #CIRC!.
    let cycles = 0;
    if (processed < nodes.length) {
      for (const id of nodes) {
        if ((indeg.get(id) as number) > 0) {
          cycles++;
          const fc = this.formulas.get(id) as FormulaCell;
          this.clearSpill(id);
          this.values.set(id, ERR.CIRC);
          this.access.writeDisplay(fc.rowKey, fc.columnId, ERR.CIRC.code);
        }
      }
    }
    return { changed, cycles, spillChanged: spillBefore !== this.spillSignature() };
  }

  /** A stable signature of the current spill ranges (to detect changes across a recalc). */
  private spillSignature(): string {
    const parts: string[] = [];
    for (const [anchor, shape] of this.spillShape) parts.push(`${anchor}:${shape.rows}x${shape.cols}`);
    return parts.sort().join(',');
  }

  /**
   * `CAP-FORMULA-ARRAY` — the current spill ranges (anchor + extent), for the host to
   * render spill outlines / emit `EVT-SPILL-CHANGE`.
   */
  getSpillRanges(): { anchor: CellId; top: number; left: number; rows: number; cols: number }[] {
    const out: { anchor: CellId; top: number; left: number; rows: number; cols: number }[] = [];
    for (const [anchor, shape] of this.spillShape) {
      out.push({ anchor, top: Math.floor(anchor / CELL_ID_STRIDE), left: anchor % CELL_ID_STRIDE, rows: shape.rows, cols: shape.cols });
    }
    return out;
  }

  /**
   * `CAP-FORMULA-ARRAY` — compute a formula and, if it yields an array, spill it
   * into the neighbouring cells (blocked target → `#SPILL!`). Returns the anchor's
   * own scalar value (top-left) for change-tracking + dependents.
   */
  private computeAndMaterialize(fc: FormulaCell): FormulaValue {
    this.clearSpill(fc.cellId); // clear any prior region first (handles resize/shrink)
    this.resolver.currentRow = fc.rowIndex + 1;
    this.resolver.currentCol = fc.colIndex + 1;
    const loc = this.access.locale?.();
    if (loc !== undefined) this.resolver.locale = loc;
    const raw = evaluateResult(fc.ast, this.resolver);
    if (isRange(raw) && raw.rows * raw.cols > 1) return this.spill(fc, raw);
    const v = isRange(raw) ? ((raw.values[0] ?? null) as FormulaValue) : (raw as FormulaValue);
    this.access.writeDisplay(fc.rowKey, fc.columnId, toDisplay(v));
    return v;
  }

  /** Materialize an array at its anchor, or `#SPILL!` if the target region is blocked. */
  private spill(fc: FormulaCell, arr: RangeValue): FormulaValue {
    const { rowIndex, colIndex } = fc;
    const { rows, cols } = arr;
    if (rowIndex + rows > this.access.rowCount() || colIndex + cols > this.access.colCount()) {
      this.access.writeDisplay(fc.rowKey, fc.columnId, ERR.SPILL.code);
      return ERR.SPILL;
    }
    // Blocking pass: any non-anchor target that already holds a literal, another
    // formula, or another anchor's spill → the whole array refuses to spill.
    for (let dr = 0; dr < rows; dr++) {
      for (let dc = 0; dc < cols; dc++) {
        if (dr === 0 && dc === 0) continue;
        const tid = encodeCellId(rowIndex + dr, colIndex + dc);
        if (this.formulas.has(tid)) return this.refuseSpill(fc);
        const owner = this.spilledInto.get(tid);
        if (owner !== undefined && owner !== fc.cellId) return this.refuseSpill(fc);
        const lit = this.access.readLiteral(colIndex + dc, rowIndex + dr);
        if (lit !== null && lit !== undefined && lit !== '') return this.refuseSpill(fc);
      }
    }
    // Materialize.
    const targets: CellId[] = [];
    for (let dr = 0; dr < rows; dr++) {
      for (let dc = 0; dc < cols; dc++) {
        const rowKey = this.access.keyAt(rowIndex + dr);
        const colId = this.access.columnIdAt(colIndex + dc);
        if (rowKey === undefined || colId === undefined) continue;
        this.access.writeDisplay(rowKey, colId, toDisplay((arr.values[dr * cols + dc] ?? null) as FormulaValue));
        if (!(dr === 0 && dc === 0)) {
          const tid = encodeCellId(rowIndex + dr, colIndex + dc);
          targets.push(tid);
          this.spilledInto.set(tid, fc.cellId);
        }
      }
    }
    this.spillRegions.set(fc.cellId, targets);
    this.spillShape.set(fc.cellId, { rows, cols });
    return (arr.values[0] ?? null) as FormulaValue;
  }

  private refuseSpill(fc: FormulaCell): FormulaValue {
    this.access.writeDisplay(fc.rowKey, fc.columnId, ERR.SPILL.code);
    return ERR.SPILL;
  }

  /** Blank the cells an anchor previously spilled into and forget the region. */
  private clearSpill(anchor: CellId): void {
    const region = this.spillRegions.get(anchor);
    if (!region) return;
    for (const tid of region) {
      this.spilledInto.delete(tid);
      const rowKey = this.access.keyAt(Math.floor(tid / CELL_ID_STRIDE));
      const colId = this.access.columnIdAt(tid % CELL_ID_STRIDE);
      if (rowKey !== undefined && colId !== undefined) this.access.writeDisplay(rowKey, colId, null);
    }
    this.spillRegions.delete(anchor);
    this.spillShape.delete(anchor);
  }

  /** One reusable resolver (position fields are set per-cell before each evaluate). */
  private readonly resolver: CellResolver = {
    currentRow: 1,
    currentCol: 1,
    now: () => this.access.now(),
    getValue: (ref: CellRefA1): FormulaValue => this.valueAt(ref.col, ref.row),
    getRange: (range: RangeRefA1): RangeValue => this.rangeValue(range),
    formulaSourceAt: (col: number, row: number): string | undefined =>
      this.formulas.get(encodeCellId(row, col))?.src,
    colCount: (): number => this.access.colCount(),
    rowCount: (): number => this.access.rowCount(),
    spillExtentAt: (col: number, row: number): { rows: number; cols: number } | undefined =>
      this.spillShape.get(encodeCellId(row, col)),
  };

  /**
   * Resolve a cell's value: computed value for a formula cell, else the literal.
   * The per-reference hot path — kept allocation-free: a numeric cell id, a single
   * `formulas` probe, and (for the common literal cell) a direct `readLiteral`.
   */
  private valueAt(col: number, row: number): FormulaValue {
    if (col < 0 || row < 0 || col >= this.access.colCount() || row >= this.access.rowCount()) {
      return ERR.REF;
    }
    const cellId = encodeCellId(row, col);
    const fc = this.formulas.get(cellId);
    if (fc !== undefined) return this.values.get(cellId) ?? null;
    return fromRaw(this.access.readLiteral(col, row));
  }

  private rangeValue(range: RangeRefA1): RangeValue {
    const top = Math.min(range.start.row, range.end.row);
    const bottom = Math.max(range.start.row, range.end.row);
    const left = Math.min(range.start.col, range.end.col);
    const right = Math.max(range.start.col, range.end.col);
    const values: FormulaValue[] = [];
    for (let row = top; row <= bottom; row++) {
      for (let col = left; col <= right; col++) values.push(this.valueAt(col, row));
    }
    return { kind: 'range', values, rows: bottom - top + 1, cols: right - left + 1 };
  }

  /**
   * `INV-FORMULA-REBUILD` — re-resolve every formula's precedents against the
   * current grid positions and fully recompute. Called after a structural
   * row/column mutation. `remap` supplies each formula's new (col,row); a formula
   * whose cell no longer exists is dropped.
   */
  rebuild(remap: (rowKey: RowKey, columnId: ColumnId) => { colIndex: number; rowIndex: number } | undefined): RecalcSummary {
    const prior = [...this.formulas.values()];
    this.formulas.clear();
    this.values.clear();
    this.dependents.clear();
    this.volatileCells.clear();
    this.spillRegions.clear();
    this.spilledInto.clear();
    this.spillShape.clear();
    for (const fc of prior) {
      const pos = remap(fc.rowKey, fc.columnId);
      if (!pos) continue;
      try {
        this.setFormula(fc.rowKey, fc.columnId, pos.colIndex, pos.rowIndex, fc.src);
      } catch {
        // A previously-valid formula can't become invalid on a position remap; ignore.
      }
    }
    return this.recalcAll();
  }

  /**
   * `INV-FORMULA-REBUILD` — a structural row/column insert or delete. Rewrites each
   * formula's references (`translateAst`) so they keep pointing at the same data
   * (a reference into a deleted band becomes `#REF!`), re-serializes the source so
   * the displayed formula updates, re-resolves positions via `remap`, and recomputes.
   */
  applyStructural(
    axis: 'row' | 'col',
    at: number,
    delta: number,
    remap: (rowKey: RowKey, columnId: ColumnId) => { colIndex: number; rowIndex: number } | undefined,
  ): RecalcSummary {
    const prior = [...this.formulas.values()];
    this.formulas.clear();
    this.values.clear();
    this.dependents.clear();
    this.volatileCells.clear();
    this.spillRegions.clear();
    this.spilledInto.clear();
    this.spillShape.clear();
    for (const fc of prior) {
      const pos = remap(fc.rowKey, fc.columnId);
      if (!pos) continue;
      const newSrc = '=' + formatAst(translateAst(fc.ast, axis, at, delta));
      try {
        this.setFormula(fc.rowKey, fc.columnId, pos.colIndex, pos.rowIndex, newSrc);
      } catch {
        // A translated formula stays syntactically valid; ignore any parse hiccup.
      }
    }
    return this.recalcAll();
  }

  /** Drop everything (rebind reset). */
  clear(): void {
    this.formulas.clear();
    this.values.clear();
    this.dependents.clear();
    this.volatileCells.clear();
    this.spillRegions.clear();
    this.spilledInto.clear();
    this.spillShape.clear();
  }
}
