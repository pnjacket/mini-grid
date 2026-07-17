/**
 * `COMPONENT-INTERACTION` — the keyboard controller + pointer controller + ARIA /
 * roving-focus manager that turns `SCREEN-GRID` into an interactive, keyboard-
 * complete, accessible grid (`A11Y-GRID`, `JOURNEY-BROWSE` scroll+select).
 *
 * Focus model — **roving tabindex** (chosen over `aria-activedescendant`, applied
 * consistently): exactly one node is the grid's tab stop. When an active cell is
 * rendered it carries `tabindex=0` (all other cells `-1`) and receives DOM focus;
 * when there is no active cell, or the active cell has been scrolled out of the
 * rendered window (recycled), the `role="grid"` root becomes the `tabindex=0`
 * fallback so the grid stays keyboard-reachable and focus never lands on a
 * recycled node. Keyboard navigation that moves the active cell off-window
 * **scrolls it back into view** (`host.ensureVisible`) before focusing it.
 *
 * Selection state (`aria-selected`, active/focus class) is applied to the live
 * cells after every render via `afterRender`, so scroll-driven repaints keep the
 * selection painted (`BIND-POINTER`/`BIND-KEYS` + `DOM-CELL`).
 */
import type { ColumnDef } from '../api/options.js';
import type { GridEventBus } from '../api/event-bus.js';
import type { RowKey } from '../types.js';
import type { GridRenderer } from '../render/renderer.js';
import type { Range } from '../types.js';
import { computeMove, resolveKey } from './keymap.js';
import type { KeyMap, NavAction } from './keymap.js';
import { SelectionModel } from '../selection/selection.js';
import type { Selection } from '../selection/selection.js';

/** The grid-side services `COMPONENT-INTERACTION` calls back into. */
export interface InteractionHost {
  /** `DOM-ROOT` (`role="grid"`) — key listener + fallback tab stop. */
  root: HTMLElement;
  /** The scroll container (`.mg-scroll`). */
  scrollEl: HTMLElement;
  renderer: GridRenderer;
  bus: GridEventBus;
  columns: readonly ColumnDef[];
  keyMap: KeyMap;
  /** Post-filter logical row count (selection/navigation extent). */
  getRowCount(): number;
  /** Logical column count. */
  getColCount(): number;
  /** Rows advanced by PageUp/PageDown (≈ one viewport of rows). */
  pageRows(): number;
  /** `RowKey` for a logical row index, from the last rendered window. */
  resolveRowKey(rowIndex: number): RowKey | undefined;
  /** The currently rendered row window `[firstRow, lastRow]` (inclusive). */
  renderedRowRange(): { firstRow: number; lastRow: number };
  /** Scroll `(rowIndex,colIndex)` into view and await the ensuing render. */
  ensureVisible(rowIndex: number, colIndex: number): Promise<void>;
  /**
   * `true` while a `LAYER-EDITOR` is open — the editor owns the keyboard, so the
   * controller suspends navigation/edit-trigger handling (`COMPONENT-EDIT`).
   */
  isEditing?(): boolean;
  /**
   * Open an editor on `(row, col)` (`LAYER-EDITOR` triggers: dbl-click / F2 /
   * type-to-replace). Returns `true` when an editor opened (cell editable +
   * feature on); `false` leaves the key for navigation. `initialText` seeds a
   * type-to-replace edit.
   */
  onBeginEdit?(row: number, col: number, initialText?: string): boolean;
  /** A pointer-down while editing — commit the open editor first. */
  onPointerCommit?(): void;
  /**
   * `multiRangeSelect` feature flag (`CAP-SELECT`). When off, disjoint add
   * (Ctrl/Cmd+click / `addRange`) degrades to a single-range replace.
   */
  multiRange?(): boolean;
}

export class InteractionController {
  private readonly model = new SelectionModel();
  private dragging = false;

  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onMouseDown: (e: MouseEvent) => void;
  private readonly onDblClick: (e: MouseEvent) => void;
  private readonly onDocMouseMove: (e: MouseEvent) => void;
  private readonly onDocMouseUp: () => void;

  constructor(private readonly host: InteractionHost) {
    this.onKeyDown = (e) => void this.handleKeyDown(e);
    this.onMouseDown = (e) => this.handleMouseDown(e);
    this.onDblClick = (e) => this.handleDblClick(e);
    this.onDocMouseMove = (e) => this.handleDocMouseMove(e);
    this.onDocMouseUp = () => {
      this.dragging = false;
    };

    const { root } = host;
    root.addEventListener('keydown', this.onKeyDown);
    root.addEventListener('mousedown', this.onMouseDown);
    root.addEventListener('dblclick', this.onDblClick);
    const doc = root.ownerDocument;
    doc.addEventListener('mousemove', this.onDocMouseMove);
    doc.addEventListener('mouseup', this.onDocMouseUp);
    // Initial roving state: the grid root is the single tab stop.
    root.setAttribute('tabindex', '0');
  }

  /** Push the live grid extents into the model (clamp + line materialization). */
  private syncExtents(): void {
    this.model.setExtents(this.host.getRowCount() - 1, this.host.getColCount() - 1);
  }

  /** Whether disjoint multi-range selection is enabled (`multiRangeSelect`). */
  private multiRange(): boolean {
    return this.host.multiRange?.() ?? true;
  }

  /** `LIB-SELECTION` — the current selection projection (the full range-set). */
  getSelection(): Selection {
    this.syncExtents();
    return this.model.toSelection(
      (row) => this.host.resolveRowKey(row),
      (col) => this.host.columns[col]?.id,
    );
  }

  /**
   * `LIB-CLIPBOARD`/fill coupling — the PRIMARY (active) range under a multi-range
   * set. Copy/cut/fill and the fill handle operate on this range only.
   */
  getActiveRange(): Range | null {
    this.syncExtents();
    return this.model.getActiveRange();
  }

  /** `LIB-SELECTION.addRange` — add a disjoint range (Ctrl/Cmd+click). */
  addRange(range: Range): void {
    this.syncExtents();
    if (this.multiRange()) this.model.addRange(range);
    else this.model.fromSelection({ ranges: [range], anchor: { row: range.top, col: range.left }, activeCell: null });
    this.decorate();
    void this.focusActive();
    this.emit();
  }

  /** `LIB-SELECTION.selectRow(s)` — line-select whole rows (`INV-SELECTION-LINE`). */
  selectRow(index: number, opts?: { additive?: boolean }): void {
    this.syncExtents();
    this.model.selectRow(index, this.multiRange() && (opts?.additive ?? false));
    this.decorate();
    void this.focusActive();
    this.emit();
  }

  selectRows(indices: readonly number[]): void {
    this.syncExtents();
    if (this.multiRange()) this.model.selectRows(indices);
    else if (indices.length) this.model.selectRow(indices[0] as number, false);
    this.decorate();
    void this.focusActive();
    this.emit();
  }

  /** `LIB-SELECTION.selectColumn(s)` — line-select whole columns (`INV-SELECTION-LINE`). */
  selectColumn(index: number, opts?: { additive?: boolean }): void {
    this.syncExtents();
    this.model.selectColumn(index, this.multiRange() && (opts?.additive ?? false));
    this.decorate();
    void this.focusActive();
    this.emit();
  }

  selectColumns(indices: readonly number[], opts?: { additive?: boolean }): void {
    this.syncExtents();
    if (this.multiRange()) {
      // `additive` (Ctrl/Cmd span-select) adds the whole range disjoint; otherwise the
      // first replaces and the rest add — matching single-column line-select semantics.
      const additive = opts?.additive ?? false;
      indices.forEach((i, n) => this.model.selectColumn(i, additive || n > 0));
    } else if (indices.length) this.model.selectColumn(indices[0] as number, false);
    this.decorate();
    void this.focusActive();
    this.emit();
  }

  /** `LIB-SELECTION.selectAll` — select the whole sheet. */
  selectAll(): void {
    this.syncExtents();
    this.model.selectAll();
    this.decorate();
    void this.focusActive();
    this.emit();
  }

  /** `LIB-SELECTION.clearSelection` — clear the whole set. */
  clearSelection(): void {
    this.model.clear();
    this.decorate();
    this.emit();
  }

  /** `LIB-SELECTION` — replace the selection (ranges clamped to extents). */
  setSelection(sel: Selection): void {
    const rowMax = this.host.getRowCount() - 1;
    const colMax = this.host.getColCount() - 1;
    this.model.setExtents(rowMax, colMax);
    const clamped: Selection = {
      ranges: sel.ranges.map((r) => ({
        top: clamp(r.top, 0, rowMax),
        bottom: clamp(r.bottom, 0, rowMax),
        left: clamp(r.left, 0, colMax),
        right: clamp(r.right, 0, colMax),
      })),
      ...(sel.lines
        ? {
            lines: sel.lines.map((l) => ({
              kind: l.kind,
              index: clamp(l.index, 0, l.kind === 'row' ? rowMax : colMax),
            })),
          }
        : {}),
      activeCell: sel.activeCell,
      anchor: sel.anchor
        ? { row: clamp(sel.anchor.row, 0, rowMax), col: clamp(sel.anchor.col, 0, colMax) }
        : null,
    };
    this.model.fromSelection(clamped);
    this.decorate();
    void this.focusActive();
    this.emit();
  }

  /**
   * Re-apply selection state to the live cells after a render (called by the
   * grid at the end of every refresh). Keeps `aria-selected` + roving `tabindex`
   * painted on scroll-driven repaints; does not steal focus.
   */
  afterRender(): void {
    this.decorate();
  }

  /**
   * Move the active cell by a navigation action (no range-extend) and focus it.
   * Used by `COMPONENT-EDIT` to advance after a commit (Enter ↓ / Tab → / ←).
   */
  async moveActive(action: NavAction): Promise<void> {
    const active = this.model.getActive();
    if (!active) return;
    const ext = {
      rowCount: this.host.getRowCount(),
      colCount: this.host.getColCount(),
      pageRows: this.host.pageRows(),
    };
    const next = computeMove(active, action, ext);
    this.model.setActive(next.row, next.col);
    await this.focusActive();
    this.emit();
  }

  /** Re-focus the active cell (e.g. `A11Y-EDITOR` Esc restores focus to it). */
  refocusActive(): void {
    void this.focusActive();
  }

  /** The index-space active cell `{row,col}` (context-menu keyboard open), or null. */
  getActiveIndex(): { row: number; col: number } | null {
    return this.model.getActive();
  }

  // --- Structural selection adjustment (INV-RANGE-BOUNDS) --------------------
  // Shift + re-clamp the selection after a row/column insert/delete. The grid
  // updates the row/column extents FIRST, then calls one of these; it repaints +
  // re-emits the selection via `afterStructuralChange` once the window refreshes.

  /** Rows inserted at `atIndex` (count `n`): positions `≥ atIndex` shift by `+n`. */
  adjustForRowInsert(atIndex: number, count: number): void {
    this.model.applyRowShift(
      (r) => (r >= atIndex ? r + count : r),
      this.host.getRowCount() - 1,
    );
  }

  /** Rows at `orderedIndices` removed: each position drops by the count removed below it. */
  adjustForRowDelete(orderedIndices: readonly number[]): void {
    const sorted = [...orderedIndices].sort((a, b) => a - b);
    this.model.applyRowShift((r) => {
      let below = 0;
      for (const i of sorted) {
        if (i < r) below++;
        else break;
      }
      return r - below;
    }, this.host.getRowCount() - 1);
  }

  /** A column inserted at `atIndex`: positions `≥ atIndex` shift by `+1`. */
  adjustForColInsert(atIndex: number): void {
    this.model.applyColShift(
      (c) => (c >= atIndex ? c + 1 : c),
      this.host.getColCount() - 1,
    );
  }

  /** The column at `colIndex` removed: positions `> colIndex` shift by `-1`. */
  adjustForColDelete(colIndex: number): void {
    this.model.applyColShift(
      (c) => (c > colIndex ? c - 1 : c),
      this.host.getColCount() - 1,
    );
  }

  /** Repaint selection state on the (freshly refreshed) cells and re-emit. */
  afterStructuralChange(): void {
    this.decorate();
    this.emit();
  }

  destroy(): void {
    const { root } = this.host;
    root.removeEventListener('keydown', this.onKeyDown);
    root.removeEventListener('mousedown', this.onMouseDown);
    root.removeEventListener('dblclick', this.onDblClick);
    const doc = root.ownerDocument;
    doc.removeEventListener('mousemove', this.onDocMouseMove);
    doc.removeEventListener('mouseup', this.onDocMouseUp);
  }

  // --- Keyboard controller (BIND-KEYS) --------------------------------------

  private async handleKeyDown(e: KeyboardEvent): Promise<void> {
    // While an editor is open it owns the keyboard (`COMPONENT-EDIT`).
    if (this.host.isEditing?.()) return;

    // `LAYER-EDITOR` triggers on the active cell: F2 + type-to-replace. These
    // are not navigation keys, so they must be handled before `resolveKey`.
    const active = this.model.getActive();
    if (active && this.host.onBeginEdit) {
      if (e.key === 'F2') {
        if (this.host.onBeginEdit(active.row, active.col)) {
          e.preventDefault();
          return;
        }
      } else if (isPrintable(e)) {
        if (this.host.onBeginEdit(active.row, active.col, e.key)) {
          e.preventDefault();
          return;
        }
      }
    }

    const resolved = resolveKey(e, this.host.keyMap);
    if (!resolved) return;
    e.preventDefault();

    // First keystroke into an empty selection seeds the active cell at (0,0).
    if (this.model.isEmpty()) {
      if (this.host.getRowCount() === 0 || this.host.getColCount() === 0) return;
      this.model.setActive(0, 0);
      await this.focusActive();
      this.emit();
      return;
    }

    if (resolved.action === 'collapse') {
      this.model.collapse();
      this.decorate();
      this.emit();
      return;
    }

    const pos = this.model.getActive() as { row: number; col: number };
    const ext = {
      rowCount: this.host.getRowCount(),
      colCount: this.host.getColCount(),
      pageRows: this.host.pageRows(),
    };
    const next = computeMove(pos, resolved.action, ext);
    if (resolved.extend) this.model.extendTo(next.row, next.col);
    else this.model.setActive(next.row, next.col);
    await this.focusActive();
    this.emit();
  }

  // --- Pointer controller (BIND-POINTER) ------------------------------------

  private handleMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return;
    // A click while editing commits the open editor first (`LAYER-EDITOR`).
    if (this.host.isEditing?.()) {
      this.host.onPointerCommit?.();
      return;
    }
    const pos = this.cellIndexFromEvent(e);
    if (!pos) return;
    this.syncExtents();
    // `BIND-POINTER` — Ctrl/Cmd+click adds a disjoint range (becomes active);
    // Shift extends the active range; a plain click replaces the whole set.
    const additive = (e.ctrlKey || e.metaKey) && !e.shiftKey && this.multiRange();
    if (e.shiftKey) this.model.extendTo(pos.row, pos.col);
    else if (additive) {
      this.model.addRange({ top: pos.row, bottom: pos.row, left: pos.col, right: pos.col });
    } else this.model.setActive(pos.row, pos.col);
    this.dragging = true;
    e.preventDefault(); // suppress native text selection during drag
    this.decorate();
    const cell = this.host.renderer.cellAt(pos.row, pos.col);
    cell?.focus();
    this.emit();
  }

  private handleDocMouseMove(e: MouseEvent): void {
    if (!this.dragging) return;
    const pos = this.cellIndexFromEvent(e);
    if (!pos) return;
    const active = this.model.getActive();
    if (active && active.row === pos.row && active.col === pos.col) return;
    this.model.extendTo(pos.row, pos.col);
    this.decorate();
    this.emit();
  }

  /** Double-click opens the editor on the target cell (`LAYER-EDITOR` trigger). */
  private handleDblClick(e: MouseEvent): void {
    if (this.host.isEditing?.() || !this.host.onBeginEdit) return;
    const pos = this.cellIndexFromEvent(e);
    if (!pos) return;
    // Make the double-clicked cell active, then open its editor.
    this.model.setActive(pos.row, pos.col);
    this.host.onBeginEdit(pos.row, pos.col);
  }

  private cellIndexFromEvent(e: Event): { row: number; col: number } | null {
    const target = e.target as HTMLElement | null;
    const cell = target?.closest?.('[role="gridcell"]') as HTMLElement | null;
    if (!cell || !this.host.root.contains(cell)) return null;
    const row = Number(cell.getAttribute('aria-rowindex')) - 1;
    const col = Number(cell.getAttribute('aria-colindex')) - 1;
    if (!Number.isFinite(row) || !Number.isFinite(col) || row < 0 || col < 0) return null;
    return { row, col };
  }

  // --- ARIA / roving focus --------------------------------------------------

  /**
   * Ensure the active cell is rendered (scroll it into view if navigation moved
   * it off-window — never focus a recycled node), then decorate + focus it.
   */
  private async focusActive(): Promise<void> {
    const active = this.model.getActive();
    if (!active) return;
    const { firstRow, lastRow } = this.host.renderedRowRange();
    const offWindow =
      active.row < firstRow ||
      active.row > lastRow ||
      !this.host.renderer.cellAt(active.row, active.col);
    if (offWindow) await this.host.ensureVisible(active.row, active.col);
    this.decorate();
    this.host.renderer.cellAt(active.row, active.col)?.focus();
  }

  /**
   * Paint `aria-selected` + roving `tabindex` + the active/focus class on every
   * live cell, and set the root's fallback `tabindex` (`A11Y-GRID` roving focus).
   */
  private decorate(): void {
    this.syncExtents();
    // `A11Y-GRID` — `aria-selected` across ALL cells in the range-set (every
    // disjoint range + line materialization), not just the active range.
    const ranges = this.model.getRanges();
    const active = this.model.getActive();
    let activeRendered = false;
    this.host.renderer.eachLiveCell((cell, r, c) => {
      const selected = ranges.some(
        (range) => r >= range.top && r <= range.bottom && c >= range.left && c <= range.right,
      );
      cell.setAttribute('aria-selected', selected ? 'true' : 'false');
      const isActive = active !== null && r === active.row && c === active.col;
      if (isActive) {
        cell.setAttribute('tabindex', '0');
        cell.classList.add('mg-cell--active');
        activeRendered = true;
      } else {
        cell.setAttribute('tabindex', '-1');
        cell.classList.remove('mg-cell--active');
      }
    });
    // Roving tab stop: the active cell when it is rendered, else the grid root.
    this.host.root.setAttribute('tabindex', active && activeRendered ? '-1' : '0');
  }

  private emit(): void {
    this.host.bus.emit('selectionChange', { selection: this.getSelection() });
  }
}

function clamp(v: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return Math.max(lo, Math.min(v, hi));
}

/**
 * A "type-to-replace" trigger: a single printable character with no command
 * modifier (Ctrl/Meta/Alt). Space is excluded (reserved for future toggles).
 */
function isPrintable(e: KeyboardEvent): boolean {
  return (
    e.key.length === 1 &&
    e.key !== ' ' &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey
  );
}
