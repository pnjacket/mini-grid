/**
 * `ENTITY-SELECTION` selection model (Domain) — the in-memory selection state and
 * its projection to the public `Selection` value. Owned by `COMPONENT-STORE`,
 * driven by `COMPONENT-INTERACTION`.
 *
 * *(v1.3, `breaking` — `CE-MULTI-RANGE-SELECT`)* the model is a **disjoint
 * range-set**, superseding the single-range + shift-extend model earlier slices
 * built. Canonical state stays **index-based**:
 *
 *  - `active`/`anchor` (`{row,col}` logical indices) drive the **active range** —
 *    the one shift-extend grows, plain click replaces, and the fill handle /
 *    clipboard operate on (the PRIMARY range, projected first).
 *  - `others: Range[]` holds the committed **disjoint** rectangles (Ctrl/Cmd+click
 *    adds one).
 *  - `lines: LineSelection[]` holds committed **line** selections (row/column
 *    header clicks); a line **materializes** to a full-axis range from the current
 *    extents (`INV-SELECTION-LINE`), re-derived whenever the extents change.
 *
 * Invariants held by construction:
 *  - `INV-SELECTION-ACTIVE` — non-empty ⇒ a non-null `activeCell` contained in some
 *    range; empty ⇒ everything null/empty.
 *  - `INV-SELECTION-WELLFORMED` — every projected range is clamped to grid bounds,
 *    non-empty, and normalized; the projected set is **disjoint** (overlapping
 *    ranges coalesce, so no cell is double-counted).
 *  - `INV-SELECTION-LINE` — a `row` line spans all columns; a `column` line spans
 *    all rows, from the live extents.
 */
import type { ColumnId, Range, RowKey } from '../types.js';

/** The active cell addressed by identity (`ENTITY-SELECTION.activeCell`). */
export interface SelectionCell {
  rowKey: RowKey;
  columnId: ColumnId;
}

/** A whole-axis (row/column) line selection (`ENTITY-SELECTION.lines`). */
export interface LineSelection {
  kind: 'row' | 'column';
  index: number;
}

/** `ENTITY-SELECTION` projection — the value returned by `grid.getSelection()`. */
export interface Selection {
  /** The **disjoint** rectangular ranges; the active/primary range is first. */
  ranges: Range[];
  /** Line selections (header clicks); each is also materialized into `ranges`. */
  lines?: LineSelection[];
  activeCell: SelectionCell | null;
  anchor: { row: number; col: number } | null;
}

/** Index-space cursor position `{ row, col }` (0-based logical indices). */
export interface CellIndex {
  row: number;
  col: number;
}

/** Clamp a logical index into `[0, max]`. */
function clampIndex(v: number, max: number): number {
  return Math.max(0, Math.min(v, max));
}

/** The all-empty selection (`INV-SELECTION-ACTIVE`, empty branch). */
export const EMPTY_SELECTION: Selection = Object.freeze({
  ranges: [],
  lines: [],
  activeCell: null,
  anchor: null,
});

/** Inclusive, normalized `ENTITY-RANGE` spanning two index-space corners. */
export function normalizeRange(a: CellIndex, b: CellIndex): Range {
  return {
    top: Math.min(a.row, b.row),
    bottom: Math.max(a.row, b.row),
    left: Math.min(a.col, b.col),
    right: Math.max(a.col, b.col),
  };
}

/** Whether `(row,col)` falls inside the inclusive range `r`. */
export function rangeContains(r: Range, row: number, col: number): boolean {
  return row >= r.top && row <= r.bottom && col >= r.left && col <= r.right;
}

/** Whether two inclusive ranges share at least one cell. */
export function rangesOverlap(a: Range, b: Range): boolean {
  return a.left <= b.right && b.left <= a.right && a.top <= b.bottom && b.top <= a.bottom;
}

/** The bounding rectangle covering both ranges (coalesce on overlap). */
function boundingBox(a: Range, b: Range): Range {
  return {
    top: Math.min(a.top, b.top),
    bottom: Math.max(a.bottom, b.bottom),
    left: Math.min(a.left, b.left),
    right: Math.max(a.right, b.right),
  };
}

/** Clamp a range to `[0,rowMax] × [0,colMax]` and re-normalize its corners. */
function clampRange(r: Range, rowMax: number, colMax: number): Range {
  return {
    top: clampIndex(Math.min(r.top, r.bottom), rowMax),
    bottom: clampIndex(Math.max(r.top, r.bottom), rowMax),
    left: clampIndex(Math.min(r.left, r.right), colMax),
    right: clampIndex(Math.max(r.left, r.right), colMax),
  };
}

/**
 * Coalesce a list of ranges into a **disjoint** set: any two ranges that overlap
 * are merged into their bounding box (repeated to a fixed point). Guarantees
 * `INV-SELECTION-WELLFORMED`'s disjointness — no cell counted twice.
 */
function coalesceAll(list: readonly Range[]): Range[] {
  // P14 (SCALE-SELECT-COALESCE): 0 or 1 range can't overlap anything — skip the
  // O(n²) pairwise scan entirely. This is the common case (a single drag range),
  // and getRanges() runs on every drag cell-crossing.
  if (list.length <= 1) return list.map((r) => ({ ...r }));
  const out: Range[] = list.map((r) => ({ ...r }));
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        if (rangesOverlap(out[i] as Range, out[j] as Range)) {
          out[i] = boundingBox(out[i] as Range, out[j] as Range);
          out.splice(j, 1);
          changed = true;
          break outer;
        }
      }
    }
  }
  return out;
}

/**
 * `INV-SELECTION-ACTIVE` checkable predicate (Domain invariant). Non-empty
 * selection ⇒ exactly one `activeCell` (non-null) whose index-space position lies
 * within some range; empty selection ⇒ `activeCell` null (and no active index).
 * Used by the runnable `INV-SELECTION-ACTIVE` assertion.
 */
export function selectionInvariantHolds(
  sel: Selection,
  activeIndex: CellIndex | null,
): boolean {
  if (sel.ranges.length === 0) {
    return sel.activeCell === null && sel.anchor === null && activeIndex === null;
  }
  if (sel.activeCell === null || activeIndex === null) return false;
  return sel.ranges.some((r) => rangeContains(r, activeIndex.row, activeIndex.col));
}

/**
 * `INV-SELECTION-WELLFORMED` checkable predicate — every range is normalized,
 * non-empty, within `[0,rowMax] × [0,colMax]`, and the set is pairwise disjoint.
 */
export function selectionWellFormed(
  sel: Selection,
  rowMax: number,
  colMax: number,
): boolean {
  for (const r of sel.ranges) {
    if (r.top > r.bottom || r.left > r.right) return false; // normalized
    if (r.top < 0 || r.left < 0 || r.bottom > rowMax || r.right > colMax) return false; // bounds
  }
  for (let i = 0; i < sel.ranges.length; i++) {
    for (let j = i + 1; j < sel.ranges.length; j++) {
      if (rangesOverlap(sel.ranges[i] as Range, sel.ranges[j] as Range)) return false; // disjoint
    }
  }
  return true;
}

/**
 * `ENTITY-SELECTION` model. Mutators keep the invariants valid by construction;
 * `toSelection` projects to the public range-set `Selection`.
 */
export class SelectionModel {
  private active: CellIndex | null = null;
  private anchor: CellIndex | null = null;
  /** Committed disjoint rectangles besides the active range. */
  private others: Range[] = [];
  /** Committed line selections (materialized to full-axis ranges from extents). */
  private lines: LineSelection[] = [];
  /** The active selection when it is a line (else the active rectangle drives it). */
  private activeLine: LineSelection | null = null;
  /** Live extents (`rowCount-1` / `colCount-1`); `-1` = unknown/empty. */
  private rowMax = -1;
  private colMax = -1;

  /** Set the live grid extents (`INV-SELECTION-WELLFORMED`/`-LINE` clamping). */
  setExtents(rowMax: number, colMax: number): void {
    this.rowMax = rowMax;
    this.colMax = colMax;
  }

  /** Empty (no active cell) ⇒ `activeCell === null` in the projection. */
  isEmpty(): boolean {
    return this.active === null;
  }

  getActive(): CellIndex | null {
    return this.active ? { ...this.active } : null;
  }

  getAnchor(): CellIndex | null {
    return this.anchor ? { ...this.anchor } : null;
  }

  /** Clamp a range to the live extents (identity when extents unknown). */
  private clampMaybe(r: Range): Range {
    if (this.rowMax < 0 || this.colMax < 0) return { ...r };
    return clampRange(r, this.rowMax, this.colMax);
  }

  /** Materialize a line selection to its full-axis range (`INV-SELECTION-LINE`). */
  private materializeLine(l: LineSelection): Range {
    const rowMax = Math.max(0, this.rowMax);
    const colMax = Math.max(0, this.colMax);
    if (l.kind === 'row') {
      const r = clampIndex(l.index, rowMax);
      return { top: r, bottom: r, left: 0, right: colMax };
    }
    const c = clampIndex(l.index, colMax);
    return { top: 0, bottom: rowMax, left: c, right: c };
  }

  /** The active/primary range (anchor..active rectangle, or the active line). */
  getActiveRange(): Range | null {
    if (this.activeLine) return this.materializeLine(this.activeLine);
    if (!this.active) return null;
    const anchor = this.anchor ?? this.active;
    return this.clampMaybe(normalizeRange(anchor, this.active));
  }

  /** Backward-compatible alias — the single active range (or null when empty). */
  getRange(): Range | null {
    return this.getActiveRange();
  }

  /**
   * The full **disjoint** range-set projection (`INV-SELECTION-WELLFORMED`): the
   * active range, the committed rectangles, and every materialized line — coalesced
   * to a disjoint set, with the range containing the active cell projected first.
   */
  getRanges(): Range[] {
    const raw: Range[] = [];
    const act = this.getActiveRange();
    if (act) raw.push(act);
    for (const o of this.others) raw.push(this.clampMaybe(o));
    for (const l of this.lines) raw.push(this.materializeLine(l));
    if (raw.length === 0) return [];
    const merged = coalesceAll(raw);
    const a = this.active;
    if (a) {
      const idx = merged.findIndex((r) => rangeContains(r, a.row, a.col));
      if (idx > 0) {
        const [primary] = merged.splice(idx, 1);
        merged.unshift(primary as Range);
      }
    }
    return merged;
  }

  /** Select a single cell — replaces the whole set with one collapsed range. */
  setActive(row: number, col: number): void {
    this.active = { row, col };
    this.anchor = { row, col };
    this.others = [];
    this.lines = [];
    this.activeLine = null;
  }

  /** Extend the active range: keep the anchor, move the active corner (Shift). */
  extendTo(row: number, col: number): void {
    if (!this.active) {
      this.setActive(row, col);
      return;
    }
    this.activeLine = null;
    if (!this.anchor) this.anchor = { ...this.active };
    this.active = { row, col };
  }

  /** Commit the current active selection (rectangle or line) into the set. */
  private commitActive(): void {
    if (this.activeLine) {
      this.lines.push({ ...this.activeLine });
      this.activeLine = null;
      return;
    }
    const act = this.getActiveRange();
    if (act) this.others.push(act);
  }

  /**
   * `LIB-SELECTION.addRange` — add a **disjoint** rectangle (Ctrl/Cmd+click). The
   * prior active selection is committed to the set; the new range becomes active.
   */
  addRange(range: Range): void {
    this.commitActive();
    let r = this.clampMaybe(range);
    // Coalesce any overlapping committed rectangle into the new active range so the
    // set stays disjoint (`INV-SELECTION-WELLFORMED` — no double-counted cell).
    const remaining: Range[] = [];
    for (const o of this.others) {
      if (rangesOverlap(o, r)) r = boundingBox(o, r);
      else remaining.push(o);
    }
    this.others = remaining;
    this.anchor = { row: r.top, col: r.left };
    this.active = { row: r.bottom, col: r.right };
    this.activeLine = null;
  }

  /**
   * `LIB-SELECTION.selectRow` — line-select a whole row (`INV-SELECTION-LINE`).
   * `additive` (Ctrl/Cmd) keeps the existing set; otherwise it replaces it.
   */
  selectRow(index: number, additive = false): void {
    const rowMax = this.rowMax;
    if (rowMax < 0 || this.colMax < 0) return;
    const i = clampIndex(index, rowMax);
    if (additive) this.commitActive();
    else {
      this.others = [];
      this.lines = [];
    }
    this.activeLine = { kind: 'row', index: i };
    this.anchor = { row: i, col: 0 };
    this.active = { row: i, col: 0 };
  }

  /** `LIB-SELECTION.selectColumn` — line-select a whole column (`INV-SELECTION-LINE`). */
  selectColumn(index: number, additive = false): void {
    const colMax = this.colMax;
    if (this.rowMax < 0 || colMax < 0) return;
    const i = clampIndex(index, colMax);
    if (additive) this.commitActive();
    else {
      this.others = [];
      this.lines = [];
    }
    this.activeLine = { kind: 'column', index: i };
    this.anchor = { row: 0, col: i };
    this.active = { row: 0, col: i };
  }

  /** `LIB-SELECTION.selectRows` — first replaces, the rest add disjoint lines. */
  selectRows(indices: readonly number[]): void {
    indices.forEach((i, n) => this.selectRow(i, n > 0));
  }

  /** `LIB-SELECTION.selectColumns` — first replaces, the rest add disjoint lines. */
  selectColumns(indices: readonly number[]): void {
    indices.forEach((i, n) => this.selectColumn(i, n > 0));
  }

  /** `LIB-SELECTION.selectAll` — select the whole sheet as one range. */
  selectAll(): void {
    if (this.rowMax < 0 || this.colMax < 0) {
      this.clear();
      return;
    }
    this.others = [];
    this.lines = [];
    this.activeLine = null;
    this.anchor = { row: 0, col: 0 };
    this.active = { row: this.rowMax, col: this.colMax };
  }

  /** Escape — collapse the whole set to the active cell (anchor := active). */
  collapse(): void {
    if (this.active) {
      this.anchor = { ...this.active };
      this.others = [];
      this.lines = [];
      this.activeLine = null;
    }
  }

  /**
   * Remap the row of every range/line through `fn` and re-clamp to `[0, rowMax]`
   * — the selection adjustment after a row insert/delete keeps `INV-RANGE-BOUNDS`.
   * `rowMax < 0` (no rows) clears the selection.
   */
  applyRowShift(fn: (row: number) => number, rowMax: number): void {
    if (rowMax < 0) {
      this.clear();
      return;
    }
    if (this.active) this.active.row = clampIndex(fn(this.active.row), rowMax);
    if (this.anchor) this.anchor.row = clampIndex(fn(this.anchor.row), rowMax);
    this.others = this.others.map((r) => ({
      ...r,
      top: clampIndex(fn(Math.min(r.top, r.bottom)), rowMax),
      bottom: clampIndex(fn(Math.max(r.top, r.bottom)), rowMax),
    }));
    this.lines = this.lines.map((l) =>
      l.kind === 'row' ? { ...l, index: clampIndex(fn(l.index), rowMax) } : l,
    );
    if (this.activeLine?.kind === 'row') {
      this.activeLine = { ...this.activeLine, index: clampIndex(fn(this.activeLine.index), rowMax) };
    }
    this.rowMax = rowMax;
  }

  /**
   * Remap the column of every range/line through `fn` and re-clamp to `[0, colMax]`
   * (column insert/delete adjustment; `INV-RANGE-BOUNDS`).
   */
  applyColShift(fn: (col: number) => number, colMax: number): void {
    if (colMax < 0) {
      this.clear();
      return;
    }
    if (this.active) this.active.col = clampIndex(fn(this.active.col), colMax);
    if (this.anchor) this.anchor.col = clampIndex(fn(this.anchor.col), colMax);
    this.others = this.others.map((r) => ({
      ...r,
      left: clampIndex(fn(Math.min(r.left, r.right)), colMax),
      right: clampIndex(fn(Math.max(r.left, r.right)), colMax),
    }));
    this.lines = this.lines.map((l) =>
      l.kind === 'column' ? { ...l, index: clampIndex(fn(l.index), colMax) } : l,
    );
    if (this.activeLine?.kind === 'column') {
      this.activeLine = { ...this.activeLine, index: clampIndex(fn(this.activeLine.index), colMax) };
    }
    this.colMax = colMax;
  }

  /** Clear the selection entirely (empty branch of `INV-SELECTION-ACTIVE`). */
  clear(): void {
    this.active = null;
    this.anchor = null;
    this.others = [];
    this.lines = [];
    this.activeLine = null;
  }

  /**
   * Reconstruct from a public `Selection` (clamped by the caller). The first range
   * fixes the active range corners (anchor + opposite corner); the rest become the
   * disjoint `others`; any `lines` restore the line selections.
   */
  fromSelection(sel: Selection): void {
    this.clear();
    const ranges = sel.ranges ?? [];
    const first = ranges[0];
    if (first) {
      const anchor = sel.anchor ?? { row: first.top, col: first.left };
      this.anchor = { row: anchor.row, col: anchor.col };
      // Active = the range corner opposite the anchor, so anchor..active === range.
      this.active = {
        row: anchor.row === first.top ? first.bottom : first.top,
        col: anchor.col === first.left ? first.right : first.left,
      };
      this.others = ranges.slice(1).map((r) => ({ ...r }));
    }
    this.lines = (sel.lines ?? []).map((l) => ({ ...l }));
    this.activeLine = null;
  }

  /**
   * Project to the public range-set `Selection`. `resolveRowKey` maps the active
   * row index to its `RowKey` (falls back to the index so `activeCell` is never
   * null while non-empty — keeping `INV-SELECTION-ACTIVE`); `resolveColId` maps col.
   */
  toSelection(
    resolveRowKey: (row: number) => RowKey | undefined,
    resolveColId: (col: number) => ColumnId | undefined,
  ): Selection {
    const ranges = this.getRanges();
    if (ranges.length === 0 || !this.active) {
      return { ranges: [], lines: [], activeCell: null, anchor: null };
    }
    const rowKey = resolveRowKey(this.active.row) ?? this.active.row;
    const columnId = resolveColId(this.active.col);
    const activeCell: SelectionCell | null =
      columnId !== undefined ? { rowKey, columnId } : null;
    const anchor = this.anchor ?? this.active;
    const lines: LineSelection[] = [
      ...(this.activeLine ? [{ ...this.activeLine }] : []),
      ...this.lines.map((l) => ({ ...l })),
    ];
    return {
      ranges,
      lines,
      activeCell,
      anchor: { row: anchor.row, col: anchor.col },
    };
  }
}
