/**
 * `COMPONENT-WORKSHEET` header interactions (`BIND-POINTER`, `DOM-HEADER`) —
 * turns the column-header affordances into `CAP-SORT`/`-FILTER`/`-RESIZE`/
 * `-REORDER` gestures:
 *
 *  - **Sort:** a plain click cycles the column asc→desc→none; a **Shift-click**
 *    appends/cycles a secondary/tertiary key (multi-sort, `SortSpec.entries`).
 *  - **Filter:** clicking the filter icon opens `LAYER-FILTER-MENU`.
 *  - **Resize:** dragging the right-edge handle previews the width live, then
 *    commits one undoable `resize` on release.
 *  - **Reorder:** dragging a header past a small threshold drops it at the column
 *    under the pointer (one undoable `reorder`); a sub-threshold press is a sort
 *    click, so the two gestures never collide.
 *
 * Each gesture is gated by the host (feature flag + per-column `flags`). All DOM
 * is delegated off the single header element, so re-rendered header cells need no
 * re-binding.
 */
import type { ColumnDef } from '../api/options.js';
import type { ColumnId } from '../types.js';

/** Movement (px) past which a header press becomes a reorder drag (else a sort click). */
const DRAG_THRESHOLD = 4;

export interface HeaderControllerHost {
  document: Document;
  /** `DOM-HEADER` — the `role="row"` header element (single delegation root). */
  headerEl: HTMLElement;
  isSortingEnabled(): boolean;
  isFilteringEnabled(): boolean;
  isResizeEnabled(): boolean;
  isReorderEnabled(): boolean;
  columnById(columnId: ColumnId): ColumnDef | undefined;
  columnIndex(columnId: ColumnId): number;
  currentWidth(columnId: ColumnId): number;
  minColumnWidth: number;
  /** Cycle the column's sort key (`additive` = the Shift-click multi-sort append). */
  cycleSort(columnId: ColumnId, additive: boolean): void;
  /**
   * `CAP-SELECT` (`CE-MULTI-RANGE-SELECT`) — line-select the whole column when the
   * header **body** (outside the sort affordance) is clicked (`additive` = Ctrl/Cmd
   * disjoint add). The dual-fire (v1.3): sort fires only from the sort affordance
   * (`data-mg-sort`), line-select only from the rest of the cell — never both.
   */
  lineSelectColumn?(columnId: ColumnId, additive: boolean, span?: number): void;
  /** Whether column line-select is enabled — lets a header press form even with sort/reorder off. */
  isLineSelectEnabled?(): boolean;
  /** `CAP-HEADER` (`DOM-CORNER`) — corner click → select-all the whole sheet. */
  selectAllSheet?(): void;
  /** Whether the corner select-all affordance is enabled. */
  isCornerSelectAllEnabled?(): boolean;
  /** Whether band-height / row-header-width drag-resize is enabled (`headerResize`). */
  isHeaderResizeEnabled?(): boolean;
  /** Current column-header band height (px). */
  currentBandHeight?(band: number): number;
  /** Live (non-undoable) band-height preview during a drag. */
  previewBandHeight?(band: number, height: number): void;
  /** Commit a column-header band-height change. */
  commitBandHeight?(band: number, fromHeight: number, toHeight: number): void;
  /** Current total row-header gutter width (px). */
  currentRowHeaderWidth?(): number;
  /** Live (non-undoable) row-header width preview during a drag. */
  previewRowHeaderWidth?(width: number): void;
  /** Commit a row-header gutter width change. */
  commitRowHeaderWidth?(fromWidth: number, toWidth: number): void;
  /** Open `LAYER-FILTER-MENU` for a column, anchored on its filter icon. */
  openFilter(columnId: ColumnId, trigger: HTMLElement): void;
  /** Live (non-undoable) width preview during a resize drag. */
  previewWidth(columnId: ColumnId, width: number): void;
  /** Commit one undoable resize (`from → to`). */
  commitWidth(columnId: ColumnId, fromWidth: number, toWidth: number): void;
  /** Move a column to a target display index (one undoable reorder). */
  moveColumn(columnId: ColumnId, toIndex: number): void;
  /** Whether the autofit affordance is enabled (`autofit` flag, `CAP-COLUMN-MANAGE`). */
  isAutofitEnabled?(): boolean;
  /** `BIND-POINTER` — double-click a resize handle → autofit the column to fit. */
  autofitColumn?(columnId: ColumnId): void;
}

interface ResizeGesture {
  kind: 'resize';
  columnId: ColumnId;
  startX: number;
  fromWidth: number;
  width: number;
}

interface HeaderGesture {
  kind: 'header';
  columnId: ColumnId;
  startX: number;
  /** Shift held — multi-sort append / line-range extend. */
  additive: boolean;
  /** Ctrl/Cmd held — disjoint column line-select add (`CE-MULTI-RANGE-SELECT`). */
  disjoint: boolean;
  reorderable: boolean;
  sortable: boolean;
  /** The press began on the sort affordance (`data-mg-sort`) → sort, not line-select. */
  sortZone: boolean;
  /**
   * `aria-colspan` of the clicked header cell (≥1). A spanning group cell line-selects
   * **all** columns it spans (`AC-HEADER-SPAN-SELECT`), not just the anchor.
   */
  colSpan: number;
  dragging: boolean;
}

/** Column-header band-height drag (`data-mg-band-resize`). */
interface BandResizeGesture {
  kind: 'band-resize';
  band: number;
  startY: number;
  fromHeight: number;
  height: number;
}

/** Row-header gutter width drag (`data-mg-rowheader-resize`). */
interface RowHeaderResizeGesture {
  kind: 'rowheader-resize';
  startX: number;
  fromWidth: number;
  width: number;
  /** RTL — the gutter grows toward the trailing (left) edge, so invert the delta. */
  rtl: boolean;
}

type Gesture = ResizeGesture | HeaderGesture | BandResizeGesture | RowHeaderResizeGesture;

export class HeaderController {
  private gesture: Gesture | undefined;
  private readonly onMouseDown: (e: MouseEvent) => void;
  private readonly onClick: (e: MouseEvent) => void;
  private readonly onDblClick: (e: MouseEvent) => void;
  private readonly onDocMouseMove: (e: MouseEvent) => void;
  private readonly onDocMouseUp: (e: MouseEvent) => void;

  constructor(private readonly host: HeaderControllerHost) {
    this.onMouseDown = (e) => this.handleMouseDown(e);
    this.onClick = (e) => this.handleClick(e);
    this.onDblClick = (e) => this.handleDblClick(e);
    this.onDocMouseMove = (e) => this.handleDocMouseMove(e);
    this.onDocMouseUp = (e) => this.handleDocMouseUp(e);

    const { headerEl, document: doc } = host;
    headerEl.addEventListener('mousedown', this.onMouseDown);
    headerEl.addEventListener('click', this.onClick);
    headerEl.addEventListener('dblclick', this.onDblClick);
    doc.addEventListener('mousemove', this.onDocMouseMove);
    doc.addEventListener('mouseup', this.onDocMouseUp);
  }

  destroy(): void {
    const { headerEl, document: doc } = this.host;
    headerEl.removeEventListener('mousedown', this.onMouseDown);
    headerEl.removeEventListener('click', this.onClick);
    headerEl.removeEventListener('dblclick', this.onDblClick);
    doc.removeEventListener('mousemove', this.onDocMouseMove);
    doc.removeEventListener('mouseup', this.onDocMouseUp);
  }

  /**
   * `BIND-POINTER` (`CAP-COLUMN-MANAGE`) — double-clicking a column's resize handle
   * (`data-mg-resize`) autofits the column to its widest visible content. The two
   * no-op resize press/release cycles that precede the `dblclick` snap back (they
   * commit `to === from` → early return), so they leave no width change or history.
   */
  private handleDblClick(e: MouseEvent): void {
    const target = e.target as HTMLElement | null;
    if (!target?.closest?.('[data-mg-resize]')) return;
    if (!(this.host.isAutofitEnabled?.() ?? false)) return;
    const columnId = this.columnIdFrom(target);
    if (!columnId) return;
    e.preventDefault();
    e.stopPropagation();
    this.host.autofitColumn?.(columnId);
  }

  private columnIdFrom(target: EventTarget | null): ColumnId | null {
    const el = target as HTMLElement | null;
    const header = el?.closest?.('[role="columnheader"]') as HTMLElement | null;
    const id = header?.getAttribute('data-col-id');
    return id ?? null;
  }

  private handleClick(e: MouseEvent): void {
    const target = e.target as HTMLElement | null;
    // `DOM-CORNER` — a corner click selects the whole sheet (`CAP-HEADER`/`-SELECT`).
    const corner = target?.closest?.('[data-mg-corner]') as HTMLElement | null;
    if (corner && !target?.closest?.('[data-mg-rowheader-resize]')) {
      if (this.host.isCornerSelectAllEnabled?.() && corner.hasAttribute('data-mg-select-all')) {
        e.preventDefault();
        e.stopPropagation();
        this.host.selectAllSheet?.();
      }
      return;
    }
    // The filter icon opens `LAYER-FILTER-MENU` (click, not the drag gesture).
    const btn = target?.closest?.('[data-mg-filter-btn]') as HTMLElement | null;
    if (!btn) return;
    if (!this.host.isFilteringEnabled()) return;
    const columnId = this.columnIdFrom(btn);
    if (!columnId) return;
    const col = this.host.columnById(columnId);
    if (col?.flags?.filterable === false) return;
    e.preventDefault();
    e.stopPropagation();
    this.host.openFilter(columnId, btn);
  }

  private handleMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    // The filter icon has its own click handler — do not start a drag/sort.
    if (target?.closest?.('[data-mg-filter-btn]')) return;

    // `headerResize` — row-header gutter width drag (on the corner trailing edge).
    if (target?.closest?.('[data-mg-rowheader-resize]') && this.host.isHeaderResizeEnabled?.()) {
      e.preventDefault();
      const from = this.host.currentRowHeaderWidth?.() ?? 0;
      this.gesture = {
        kind: 'rowheader-resize',
        startX: e.clientX,
        fromWidth: from,
        width: from,
        rtl: (target.closest('[dir="rtl"]') as HTMLElement | null) !== null,
      };
      return;
    }

    // `headerResize` — column-header band-height drag (bottom edge of the band).
    const bandHandle = target?.closest?.('[data-mg-band-resize]') as HTMLElement | null;
    if (bandHandle && this.host.isHeaderResizeEnabled?.()) {
      const cell = bandHandle.closest('[role="columnheader"]') as HTMLElement | null;
      const band = Number(cell?.getAttribute('data-band') ?? 0);
      const from = this.host.currentBandHeight?.(band) ?? 0;
      e.preventDefault();
      this.gesture = {
        kind: 'band-resize',
        band,
        startY: e.clientY,
        fromHeight: from,
        height: from,
      };
      return;
    }

    const columnId = this.columnIdFrom(target);
    if (!columnId) return;
    const col = this.host.columnById(columnId);
    if (!col) return;
    // `AC-HEADER-SPAN-SELECT` — a spanning group cell (`aria-colspan > 1`) line-selects
    // all the columns it spans, so capture the span now for the mouse-up body-click.
    const cell = target?.closest?.('[role="columnheader"]') as HTMLElement | null;
    const colSpan = Math.max(1, Number(cell?.getAttribute('aria-colspan') ?? 1) || 1);

    // Resize handle → width drag (takes precedence over the header gesture).
    if (
      target?.closest?.('[data-mg-resize]') &&
      this.host.isResizeEnabled() &&
      col.flags?.resizable !== false
    ) {
      e.preventDefault();
      this.gesture = {
        kind: 'resize',
        columnId,
        startX: e.clientX,
        fromWidth: this.host.currentWidth(columnId),
        width: this.host.currentWidth(columnId),
      };
      return;
    }

    // A header press. The **dual-fire split** (`DOM-HEADER`, v1.3): a press that
    // begins on the sort affordance (`data-mg-sort` — the label/sort-indicator
    // region) sorts; a press elsewhere on the cell line-selects the column. Either
    // can still promote to a reorder drag past the threshold.
    const sortZone = target?.closest?.('[data-mg-sort]') != null;
    const sortable = sortZone && this.host.isSortingEnabled() && col.flags?.sortable !== false;
    const reorderable = this.host.isReorderEnabled() && col.flags?.reorderable !== false;
    const lineSelect = this.host.isLineSelectEnabled?.() ?? false;
    // A sort-zone press needs sorting; a body press needs line-select. Reorder can
    // promote either.
    if (!sortable && !reorderable && !(lineSelect && !sortZone)) return;
    e.preventDefault();
    this.gesture = {
      kind: 'header',
      columnId,
      startX: e.clientX,
      additive: e.shiftKey,
      disjoint: e.ctrlKey || e.metaKey,
      reorderable,
      sortable,
      sortZone,
      colSpan,
      dragging: false,
    };
  }

  private handleDocMouseMove(e: MouseEvent): void {
    const g = this.gesture;
    if (!g) return;
    if (g.kind === 'resize') {
      const delta = e.clientX - g.startX;
      const width = Math.max(this.host.minColumnWidth, Math.round(g.fromWidth + delta));
      g.width = width;
      this.host.previewWidth(g.columnId, width);
      return;
    }
    if (g.kind === 'band-resize') {
      const delta = e.clientY - g.startY;
      const height = Math.max(16, Math.round(g.fromHeight + delta));
      g.height = height;
      this.host.previewBandHeight?.(g.band, height);
      return;
    }
    if (g.kind === 'rowheader-resize') {
      const delta = (e.clientX - g.startX) * (g.rtl ? -1 : 1);
      const width = Math.max(16, Math.round(g.fromWidth + delta));
      g.width = width;
      this.host.previewRowHeaderWidth?.(width);
      return;
    }
    // header gesture — promote to a reorder drag once past the threshold.
    if (g.reorderable && !g.dragging && Math.abs(e.clientX - g.startX) > DRAG_THRESHOLD) {
      g.dragging = true;
    }
  }

  private handleDocMouseUp(e: MouseEvent): void {
    const g = this.gesture;
    if (!g) return;
    this.gesture = undefined;

    if (g.kind === 'resize') {
      const width = Math.max(this.host.minColumnWidth, g.width);
      this.host.commitWidth(g.columnId, g.fromWidth, width);
      return;
    }
    if (g.kind === 'band-resize') {
      this.host.commitBandHeight?.(g.band, g.fromHeight, g.height);
      return;
    }
    if (g.kind === 'rowheader-resize') {
      this.host.commitRowHeaderWidth?.(g.fromWidth, g.width);
      return;
    }

    if (g.dragging) {
      // Reorder drop — the column under the pointer is the target slot.
      const targetId = this.columnUnderPointer(e);
      if (targetId && targetId !== g.columnId) {
        const toIndex = this.host.columnIndex(targetId);
        if (toIndex >= 0) this.host.moveColumn(g.columnId, toIndex);
      }
      return;
    }

    // A press with no drag. The dual-fire split: a sort-zone press cycles the sort
    // (Shift = multi-sort); a body press line-selects the column (Ctrl/Cmd = disjoint
    // add). Never both.
    if (g.sortZone) {
      if (g.sortable) this.host.cycleSort(g.columnId, g.additive);
    } else if (this.host.isLineSelectEnabled?.()) {
      this.host.lineSelectColumn?.(g.columnId, g.disjoint, g.colSpan);
    }
  }

  private columnUnderPointer(e: MouseEvent): ColumnId | null {
    const doc = this.host.document;
    const el = doc.elementFromPoint?.(e.clientX, e.clientY) as HTMLElement | null;
    return this.columnIdFrom(el);
  }
}
