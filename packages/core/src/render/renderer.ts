/**
 * `COMPONENT-RENDER` — renders the visible window to the DOM and recycles row +
 * cell nodes from a pool (`PATTERN-VIRTUALIZATION`). Owns:
 *
 * - `DOM-ROOT`   — `role="grid"`, `aria-rowcount`/`aria-colcount` = full logical
 *   counts, `aria-multiselectable`, `dir`, `data-mini-grid`, theme class,
 *   `--mg-*` CSS vars.
 * - `DOM-HEADER` — a header `role="row"` of `role="columnheader"` (`data-col-id`).
 * - `DOM-ROW`    — each body row is a `role="row"` (`aria-rowindex`) inside a
 *   `role="rowgroup"` body, so the ARIA grid tree is well-formed (gridcell →
 *   row → rowgroup → grid), which `A11Y-GRID`/axe require.
 * - `DOM-CELL`   — `role="gridcell"`, `data-row-key`, `data-col-id`,
 *   `aria-rowindex`, `aria-colindex`, `aria-selected`, `aria-readonly`, and a
 *   roving `tabindex` (managed by `COMPONENT-INTERACTION`).
 *
 * Cell content is written via `textContent` (escape-by-default). The live node
 * count is bounded by viewport + overscan because the row/cell pools only grow to
 * the largest window ever rendered and are reused thereafter (`PERF-NODES`).
 */
import type { EngineRow } from '../engine/index-engine.js';
import type { ColumnDef } from '../api/options.js';
import type { HeightIndex } from '../viewport/height-index.js';
import type { RowWindow, ColWindow } from '../viewport/viewport.js';
import type { ColumnId, MergeRegion, RowData, RowKey } from '../types.js';
import type {
  ColumnHeaderPlan,
  CornerPlan,
  RowHeaderPlan,
} from '../worksheet/header-config.js';
import { getByPath } from '../util/path.js';
import type { Translate } from '../i18n/i18n.js';
import { defaultTranslate } from '../i18n/i18n.js';

export interface RendererMountOptions {
  dir: 'ltr' | 'rtl';
  theme: 'light' | 'dark';
  density?: 'comfortable' | 'compact';
  rowHeight: number;
}

/**
 * `CAP-COLUMN-MANAGE` autofit — the horizontal cell padding (px) added to a
 * measured text run, and the mean glyph advance at the default 13px UI font. The
 * glyph-count estimate is the env-independent fallback for `measureColumnContentWidth`
 * when the off-screen span reports width 0 (jsdom, where layout never runs); a real
 * browser uses the span's measured intrinsic width.
 */
const AUTOFIT_CELL_PADDING = 16;
const AUTOFIT_CHAR_PX = 7.2;
/** Deterministic glyph-count width estimate (px) for `text`. */
function approxTextWidth(text: string): number {
  return text.length * AUTOFIT_CHAR_PX;
}

/**
 * Per-cell paint hook (`COMPONENT-FORMAT`/`-CONDFMT` seam). When set, the
 * renderer delegates cell **content + styling** to it instead of the default
 * `textContent`, so the format/cond-fmt layer owns display text (value masks),
 * resolved styles, data bars/icons, and custom renderers — all DOM-only.
 */
export type CellDecorator = (cell: HTMLElement, info: CellDecorInfo) => void;

export interface CellDecorInfo {
  rowKey: RowKey;
  columnId: ColumnId;
  field: string;
  value: unknown;
  data: RowData;
  rowIndex: number;
  colIndex: number;
  column: ColumnDef;
}

export interface RenderWindowArgs {
  rowWindow: RowWindow;
  colWindow: ColWindow;
  rows: readonly EngineRow[];
  /** Ordered index of `rows[0]`. */
  startIndex: number;
  columns: readonly ColumnDef[];
  heightIndex: HeightIndex;
  colOffsets: readonly number[];
  /**
   * Whether the `editing` feature is enabled. A cell is editable (and reflects
   * `aria-readonly="false"`) only when both `column.editable` **and** this flag
   * are on (`DOM-CELL`, gated behind `PATTERN-FEATURE-FLAGS`).
   */
  editingEnabled?: boolean;
  /** `ENTITY-FREEZE-PANE` — pinned top-row count (clamped to `[0, rowCount]`). */
  frozenRowCount?: number;
  /** `ENTITY-FREEZE-PANE` — pinned left-column count (clamped to `[0, colCount]`). */
  frozenColCount?: number;
  /** Current scroll offsets — frozen rows/cols counter-translate by these to stay pinned. */
  scrollTop?: number;
  scrollLeft?: number;
  /** Row data for indices `[0, frozenRowCount)` (fetched off-window so pinned rows always paint). */
  frozenRows?: readonly EngineRow[];
  /** `CAP-MERGE` — the live merge regions; the anchor cell spans, covered cells are suppressed. */
  merges?: readonly MergeRegion[];
  /**
   * `CAP-HEADER` (`DOM-ROWHEADER`) — the frozen leading-edge row-header gutter. When
   * present, data columns are shifted right by `gutter.totalWidth` and each visible
   * body row paints M `role="rowheader"` gutter cells pinned on horizontal scroll.
   */
  gutter?: RowHeaderPlan;
  /** `CAP-GROUP` — logical rows hidden by a collapsed row-axis group (not rendered). */
  hiddenRows?: ReadonlySet<number>;
  /** `CAP-GROUP` — logical columns hidden by a collapsed column-axis group (not rendered). */
  hiddenCols?: ReadonlySet<number>;
  /**
   * `PERF-SCROLL` dirty-diff hint. When `true` the caller guarantees the paint is a
   * **scroll-only** refresh (no cell content/style/geometry changed) so the renderer
   * may **retain** already-painted rows by keyed identity — reusing their DOM nodes
   * in place and only painting rows that newly entered the window (a keyed diff over
   * the row pool). Content-changing refreshes (edit/sort/filter/style/structural/
   * cond-fmt/locale/theme) pass it falsy → a full repaint. The fast path is taken
   * only when no freeze/merge/group-collapse is active (else it falls back to full).
   */
  reuse?: boolean;
}

/** Per-column header affordance state (`DOM-HEADER` — sort/filter/resize/reorder). */
export interface HeaderRenderOpts {
  /** columnId → current sort key (direction + 1-based precedence order). */
  sortState?: Map<ColumnId, { direction: 'asc' | 'desc'; order: number; multi: boolean }>;
  /** columnId set with an active filter (drives the filter-icon "on" affordance). */
  activeFilters?: ReadonlySet<ColumnId>;
  /** Feature-level gates (a per-column `flags.*` can still opt an individual column out). */
  features?: { sorting: boolean; filtering: boolean; resize: boolean; reorder: boolean };
  /** Pinned left-column count (frozen header cells counter-translate to stay put). */
  frozenColCount?: number;
  /** Horizontal scroll offset — non-frozen header cells track the body by `-scrollLeft`. */
  scrollLeft?: number;
  /** `CAP-GROUP` — logical columns hidden by a collapsed column-axis group. */
  hiddenCols?: ReadonlySet<number>;
  /**
   * `CAP-HEADER` (v1.3) — the resolved N-band column-header plan (spans, per-band
   * heights, affordance band, wrap). Absent = a single default label band.
   */
  plan?: ColumnHeaderPlan;
  /** `CAP-HEADER` — the row-header gutter (drives the leading shift + corner sizing). */
  gutter?: RowHeaderPlan;
  /** `CAP-HEADER` — the corner cell (`DOM-CORNER`); present only with both axes. */
  corner?: CornerPlan;
  /** `CAP-HEADER` — localized accessible name for the corner ("Select all"). */
  cornerLabel?: string;
  /** `CAP-HEADER` — tooltips enabled; drives `title`/`aria` from `headerTooltip`. */
  tooltips?: boolean;
  /** `headerResize` feature flag — band-height / row-header-width resize handles. */
  headerResizeEnabled?: boolean;
}

/** A pooled body row: its `role="row"` element plus its recycled cell nodes. */
interface RowSlot {
  el: HTMLElement;
  cells: HTMLElement[];
  /** `DOM-ROWHEADER` — pooled `role="rowheader"` gutter cells (M bands), or empty. */
  gutterCells: HTMLElement[];
  /** Logical row index currently painted, or `-1` when hidden. */
  rowIndex: number;
  /** Logical column index painted into each visible cell slot (may be non-contiguous
   *  when frozen columns are pinned ahead of the scrolled window). */
  colIndices: number[];
  /** Count of cells currently visible in this row. */
  colCount: number;
  /** `PERF-SCROLL` — RowKey currently painted (keyed-diff retention identity), or null. */
  rowKey: RowKey | null;
  /** `PERF-SCROLL` — signature of the visible column indices painted (retention identity). */
  colSig: string;
}

/** One entry in the row render list: a logical row + whether it is a frozen (pinned) row. */
interface RowEntry {
  r: number;
  row: EngineRow;
  frozen: boolean;
}

/** The per-render painting context shared by `paintRow` (`renderWindow` locals). */
interface PaintContext {
  colList: number[];
  colSig: string;
  scrollTop: number;
  scrollLeft: number;
  editingEnabled: boolean;
  frozenColCount: number;
  columns: readonly ColumnDef[];
  colOffsets: readonly number[];
  heightIndex: HeightIndex;
  merges: readonly MergeRegion[];
  /** `CAP-HEADER` — the row-header gutter (undefined = no gutter); leading inline shift. */
  gutter: RowHeaderPlan | undefined;
  /** Sum of gutter band widths (data cells shift right by this; 0 = no gutter). */
  gutterWidth: number;
}

/** A pooled header cell: the `columnheader` element plus its label/filter/resize children. */
interface HeaderCellSlot {
  cell: HTMLElement;
  /** The sort affordance region (`data-mg-sort` — click sorts, `DOM-HEADER`). */
  label: HTMLElement;
  /** The line-select "body" zone filler (`data-mg-header-body`) — click line-selects. */
  body: HTMLElement;
  filterBtn: HTMLButtonElement;
  resizeHandle: HTMLElement;
  /** Band-height resize handle (bottom edge, `headerResize`). */
  bandResize: HTMLElement;
  /** 0-based band this slot belongs to. */
  band: number;
  /** Logical column index currently painted, or -1 when unused. */
  colIndex: number;
  /** Column span currently painted. */
  colSpan: number;
  /** Whether the painted column is frozen (pinned on horizontal scroll). */
  frozen: boolean;
}

const STYLE_MARKER = 'data-mini-grid-style';

export class GridRenderer {
  private root: HTMLElement | undefined;
  private header: HTMLElement | undefined;
  private body: HTMLElement | undefined;
  private scrollEl: HTMLElement | undefined;
  private spacer: HTMLElement | undefined;
  private readonly rows: RowSlot[] = [];
  /**
   * `PERF-SCROLL` keyed-diff index: logical rowIndex → the pool slot painting it,
   * rebuilt each render. A scroll-only refresh consults it to **retain** rows that
   * are still visible (same rowIndex + rowKey + visible-column signature) so only
   * rows that newly entered the window are repainted.
   */
  private rowIndexToSlot = new Map<number, RowSlot>();
  private headerSlots: HeaderCellSlot[] = [];
  /** `DOM-HEADER` — the per-band `role="row"` elements (index = band). */
  private headerBandEls: HTMLElement[] = [];
  /** `DOM-CORNER` — the row-header × column-header intersection cell. */
  private cornerEl: HTMLElement | undefined;
  private scrollListener: (() => void) | undefined;
  private decorator: CellDecorator | undefined;
  /** `COMPONENT-I18N` translator (filter aria-labels); English fallback until set. */
  private translate: Translate = defaultTranslate;
  /** Last header layout inputs — `positionHeader` reuses them to track scroll. */
  private headerColOffsets: readonly number[] = [0];
  private headerFrozenColCount = 0;
  /** `CAP-HEADER` — leading row-header gutter width (data columns shift right by it). */
  private leadingGutter = 0;
  /**
   * `CAP-COLUMN-MANAGE` autofit — a single reusable off-screen `<span>` used to
   * measure the **intrinsic** (env-, cell- and column-width-independent) pixel
   * width of a run of text at the grid's cell font. Created lazily, appended to
   * the grid root (so it inherits `--mg-font-family`/`--mg-font-size`), reused for
   * every cell/header (never one node per cell). See `measureColumnContentWidth`.
   */
  private measureNode: HTMLElement | undefined;

  get element(): HTMLElement | undefined {
    return this.root;
  }

  get scrollContainer(): HTMLElement | undefined {
    return this.scrollEl;
  }

  /** `DOM-HEADER` — the header `role="row"` element (header-interaction delegation root). */
  get headerElement(): HTMLElement | undefined {
    return this.header;
  }

  /** The scrolling body (`role="rowgroup"`) — host for the `CAP-GROUP` outline overlay. */
  get bodyElement(): HTMLElement | undefined {
    return this.body;
  }

  mount(container: HTMLElement, opts: RendererMountOptions): void {
    const doc = container.ownerDocument;
    injectBaseStyles(doc);

    const root = doc.createElement('div');
    root.setAttribute('role', 'grid');
    root.setAttribute('data-mini-grid', '');
    root.setAttribute('aria-multiselectable', 'true');
    root.setAttribute('dir', opts.dir);
    root.className = `mg-theme-${opts.theme}`;
    if (opts.density === 'compact') root.classList.add('mg-density-compact');
    root.style.setProperty('--mg-row-height', `${opts.rowHeight}px`);
    root.style.setProperty('--mg-dir', opts.dir);
    root.style.position = 'relative';

    // `DOM-HEADER` (v1.3) — the header is a `role="rowgroup"` region containing N
    // `role="row"` bands (`CAP-HEADER`), so the ARIA grid tree stays well-formed
    // (columnheader/rowheader → row band → rowgroup → grid) with multi-band headers.
    const header = doc.createElement('div');
    header.setAttribute('role', 'rowgroup');
    header.className = 'mg-header';
    header.style.position = 'relative';

    const scrollEl = doc.createElement('div');
    scrollEl.className = 'mg-scroll';
    scrollEl.style.position = 'relative';
    scrollEl.style.overflow = 'auto';

    const body = doc.createElement('div');
    body.setAttribute('role', 'rowgroup');
    body.className = 'mg-body';
    body.style.position = 'relative';

    const spacer = doc.createElement('div');
    spacer.className = 'mg-spacer';
    spacer.setAttribute('aria-hidden', 'true');
    spacer.style.position = 'absolute';
    spacer.style.top = '0';
    spacer.style.left = '0';
    spacer.style.width = '1px';
    spacer.style.height = '0';

    body.appendChild(spacer);
    scrollEl.appendChild(body);
    root.appendChild(header);
    root.appendChild(scrollEl);
    container.appendChild(root);

    this.root = root;
    this.header = header;
    this.scrollEl = scrollEl;
    this.body = body;
    this.spacer = spacer;
  }

  /** Install the per-cell paint hook (`COMPONENT-FORMAT`/`-CONDFMT`). */
  setCellDecorator(fn: CellDecorator | undefined): void {
    this.decorator = fn;
  }

  /** Install the `COMPONENT-I18N` translator (used for header filter aria-labels). */
  setTranslator(t: Translate): void {
    this.translate = t;
  }

  /**
   * `LIB-LOCALE.setDirection` — flip `dir` on `DOM-ROOT` + the `--mg-dir` token.
   * Cell/header positions use logical `inset-inline-start`, so the column order,
   * frozen (leading) edge, and default alignment mirror from this attribute; the
   * caller re-renders the header + window so the new offsets take effect.
   */
  setDirection(dir: 'ltr' | 'rtl'): void {
    if (!this.root) return;
    this.root.setAttribute('dir', dir);
    this.root.style.setProperty('--mg-dir', dir);
  }

  /** The current `DOM-ROOT` text direction. */
  getDirection(): 'ltr' | 'rtl' {
    return this.root?.getAttribute('dir') === 'rtl' ? 'rtl' : 'ltr';
  }

  /** `LIB-THEME` — toggle the theme class (`mg-theme-{light|dark}`). Idempotent. */
  setTheme(theme: 'light' | 'dark'): void {
    if (!this.root) return;
    this.root.classList.remove('mg-theme-light', 'mg-theme-dark');
    this.root.classList.add(`mg-theme-${theme}`);
  }

  /** Toggle the density preset class (`--mg-cell-padding`/`--mg-row-height-default`). */
  setDensity(density: 'comfortable' | 'compact'): void {
    if (!this.root) return;
    this.root.classList.toggle('mg-density-compact', density === 'compact');
  }

  onScroll(cb: (scrollTop: number, scrollLeft: number) => void): void {
    if (!this.scrollEl) return;
    this.scrollListener = () => {
      const el = this.scrollEl as HTMLElement;
      cb(el.scrollTop, el.scrollLeft);
    };
    this.scrollEl.addEventListener('scroll', this.scrollListener);
  }

  setScroll(scrollTop: number, scrollLeft: number): void {
    if (!this.scrollEl) return;
    this.scrollEl.scrollTop = scrollTop;
    this.scrollEl.scrollLeft = scrollLeft;
  }

  setAria(rowCount: number, colCount: number): void {
    if (!this.root) return;
    this.root.setAttribute('aria-rowcount', String(rowCount));
    this.root.setAttribute('aria-colcount', String(colCount));
  }

  /**
   * `A11Y-GRID` — toggle `aria-busy` on `DOM-ROOT` while an async data op is
   * pending (set the attribute; remove it on settle so idle carries no stale
   * busy state). Announcing window arrival is left to `aria-busy` (not the live
   * region — a named exclusion).
   */
  setBusy(busy: boolean): void {
    if (!this.root) return;
    if (busy) this.root.setAttribute('aria-busy', 'true');
    else this.root.removeAttribute('aria-busy');
  }

  renderHeader(
    columns: readonly ColumnDef[],
    colOffsets: readonly number[],
    opts: HeaderRenderOpts = {},
  ): void {
    if (!this.header) return;
    const doc = this.header.ownerDocument;
    const features = opts.features;
    const frozenColCount = opts.frozenColCount ?? 0;
    const hiddenCols = opts.hiddenCols;
    const plan = opts.plan ?? defaultColumnHeaderPlan(columns);
    const affordanceBand = plan.affordanceBand;
    const heights = plan.heights;
    const bandTop = (b: number): number => heights.slice(0, b).reduce((a, h) => a + h, 0);
    this.leadingGutter = opts.gutter?.totalWidth ?? 0;

    // Ensure a `role="row"` band element per band; size + stack them.
    while (this.headerBandEls.length < plan.bands) {
      const bandEl = doc.createElement('div');
      bandEl.setAttribute('role', 'row');
      bandEl.className = 'mg-header-band';
      bandEl.style.position = 'relative';
      (this.header as HTMLElement).appendChild(bandEl);
      this.headerBandEls.push(bandEl);
    }
    for (let b = 0; b < this.headerBandEls.length; b++) {
      const bandEl = this.headerBandEls[b] as HTMLElement;
      if (b < plan.bands) {
        bandEl.style.display = '';
        bandEl.style.height = `${heights[b]}px`;
        bandEl.setAttribute('data-band', String(b));
      } else {
        bandEl.style.display = 'none';
      }
    }

    // Pool header cells (one per plan cell).
    while (this.headerSlots.length < plan.cells.length) {
      this.headerSlots.push(this.createHeaderSlot(doc));
    }
    for (let i = 0; i < this.headerSlots.length; i++) {
      const slot = this.headerSlots[i] as HeaderCellSlot;
      const spec = plan.cells[i];
      const { cell, label, body, filterBtn, resizeHandle, bandResize } = slot;
      const col = spec ? columns[spec.colIndex] : undefined;
      if (!spec || !col || hiddenCols?.has(spec.colIndex)) {
        cell.style.display = 'none';
        cell.removeAttribute('data-col-id');
        cell.removeAttribute('aria-colindex');
        cell.removeAttribute('aria-sort');
        cell.removeAttribute('aria-colspan');
        cell.removeAttribute('aria-rowspan');
        label.textContent = '';
        slot.colIndex = -1;
        continue;
      }
      // Re-parent into the correct band element.
      const bandEl = this.headerBandEls[spec.band] as HTMLElement;
      if (cell.parentElement !== bandEl) bandEl.appendChild(cell);
      slot.band = spec.band;
      slot.colIndex = spec.colIndex;
      slot.colSpan = spec.colSpan;

      cell.style.display = '';
      cell.setAttribute('data-col-id', col.id);
      cell.setAttribute('data-band', String(spec.band));
      cell.setAttribute('aria-colindex', String(spec.colIndex + 1));
      // Span across bands (height) + columns (width).
      const spanHeight = heights
        .slice(spec.band, spec.band + spec.rowSpan)
        .reduce((a, h) => a + h, 0);
      cell.style.height = `${spanHeight}px`;
      if (spec.colSpan > 1) cell.setAttribute('aria-colspan', String(spec.colSpan));
      else cell.removeAttribute('aria-colspan');
      if (spec.rowSpan > 1) cell.setAttribute('aria-rowspan', String(spec.rowSpan));
      else cell.removeAttribute('aria-rowspan');

      // Content: string → textContent; Node → mounted as-is (SEC-RENDERER-DOM-ONLY).
      if (typeof spec.content === 'string') {
        label.textContent = spec.content;
      } else {
        label.textContent = '';
        label.appendChild(spec.content);
      }
      label.classList.toggle('mg-header-label--wrap', plan.wrap);

      // Tooltip (`headerTooltip`) — title + accessible description on hover/focus.
      if (opts.tooltips && col.headerTooltip !== undefined) {
        cell.setAttribute('title', col.headerTooltip);
        cell.setAttribute('aria-description', col.headerTooltip);
      } else {
        cell.removeAttribute('title');
        cell.removeAttribute('aria-description');
      }

      // Affordances (sort/filter/resize) render only on the affordance band, and
      // only for single (non-spanning) column cells.
      const affordanceHost = spec.band === affordanceBand && spec.colSpan === 1;
      const sort = opts.sortState?.get(col.id);
      const sortable = affordanceHost && (features?.sorting ?? true) && col.flags?.sortable !== false;
      // `DOM-HEADER` — the sort indicator (`aria-sort` + arrow) lives on exactly the
      // one affordance-band, colSpan-1 cell of the sorted column. Sibling bands and
      // spanning cells share `col` but must NOT mirror the indicator, so gate on
      // `affordanceHost`; the else-branch strips any stale aria-sort/data-sort-order.
      if (sort && affordanceHost) {
        cell.setAttribute('aria-sort', sort.direction === 'asc' ? 'ascending' : 'descending');
        cell.setAttribute('data-sort-order', String(sort.order));
      } else {
        if (sortable) cell.setAttribute('aria-sort', 'none');
        else cell.removeAttribute('aria-sort');
        cell.removeAttribute('data-sort-order');
      }
      cell.toggleAttribute('data-mg-sortable', sortable);
      // `DOM-HEADER` dual-fire split: the label is the SORT affordance (click →
      // sort) ONLY when sortable; the rest of the cell line-selects the column.
      label.toggleAttribute('data-mg-sort', sortable);

      const reorderable =
        affordanceHost && (features?.reorder ?? true) && col.flags?.reorderable !== false;
      cell.toggleAttribute('data-mg-reorder', reorderable);

      const filterable =
        affordanceHost && (features?.filtering ?? true) && col.flags?.filterable !== false;
      filterBtn.style.display = filterable ? '' : 'none';
      filterBtn.setAttribute(
        'aria-label',
        this.translate('filter.ariaLabel', { column: col.header ?? col.id }),
      );
      filterBtn.classList.toggle('mg-header-filter--active', opts.activeFilters?.has(col.id) ?? false);
      filterBtn.setAttribute('data-col-id', col.id);

      const resizable =
        affordanceHost && (features?.resize ?? true) && col.flags?.resizable !== false;
      resizeHandle.style.display = resizable ? '' : 'none';

      // Band-height resize handle (bottom edge) — each band's own edge resizes it.
      const bandResizable = opts.headerResizeEnabled === true && spec.colSpan === 1;
      bandResize.style.display = bandResizable ? '' : 'none';
    }

    // `DOM-CORNER` — the row-header × column-header intersection.
    this.renderCorner(doc, opts, heights);

    this.headerColOffsets = colOffsets;
    this.headerFrozenColCount = frozenColCount;
    this.positionHeader(colOffsets, opts.scrollLeft ?? 0, frozenColCount);
  }

  /** Create/update the corner cell (`DOM-CORNER`), or hide it when no gutter. */
  private renderCorner(doc: Document, opts: HeaderRenderOpts, heights: number[]): void {
    const gutter = opts.gutter;
    const corner = opts.corner;
    if (!gutter || !corner) {
      if (this.cornerEl) this.cornerEl.style.display = 'none';
      return;
    }
    if (!this.cornerEl) {
      const el = doc.createElement('div');
      el.setAttribute('role', 'columnheader');
      el.setAttribute('data-mg-corner', '');
      el.className = 'mg-header-corner';
      el.style.position = 'absolute';
      el.style.top = '0';
      el.style.insetInlineStart = '0';
      const rh = doc.createElement('div');
      rh.className = 'mg-header-resize mg-rowheader-resize';
      rh.setAttribute('data-mg-rowheader-resize', '');
      rh.setAttribute('aria-hidden', 'true');
      el.appendChild(rh);
      // The corner (role=columnheader) must be owned by a role=row band
      // (`aria-required-parent`), so mount it in the first band; it spans all
      // bands' height via overflow.
      (this.headerBandEls[0] ?? (this.header as HTMLElement)).appendChild(el);
      this.cornerEl = el;
    }
    const el = this.cornerEl;
    if (this.headerBandEls[0] && el.parentElement !== this.headerBandEls[0]) {
      this.headerBandEls[0].appendChild(el);
    }
    const rh = el.querySelector('[data-mg-rowheader-resize]') as HTMLElement | null;
    el.style.display = '';
    el.style.width = `${gutter.totalWidth}px`;
    el.style.height = `${heights.reduce((a, h) => a + h, 0)}px`;
    el.setAttribute('aria-label', opts.cornerLabel ?? 'Select all');
    el.toggleAttribute('data-mg-select-all', corner.selectAll);
    // Content (before the resize handle), preserving the handle child.
    for (const n of Array.from(el.childNodes)) {
      if (n !== rh) el.removeChild(n);
    }
    if (corner.render) {
      const content = corner.render();
      if (typeof content === 'string') {
        if (content) el.insertBefore(doc.createTextNode(content), rh);
      } else {
        el.insertBefore(content, rh);
      }
    }
    if (rh) rh.style.display = opts.headerResizeEnabled && gutter.resizable ? '' : 'none';
  }

  private createHeaderSlot(doc: Document): HeaderCellSlot {
    const cell = doc.createElement('div');
    cell.setAttribute('role', 'columnheader');
    cell.className = 'mg-header-cell';
    cell.style.position = 'absolute';
    cell.style.top = '0';

    const label = doc.createElement('span');
    label.className = 'mg-header-label';
    cell.appendChild(label);

    const body = doc.createElement('span');
    body.className = 'mg-header-body';
    body.setAttribute('data-mg-header-body', '');
    body.setAttribute('aria-hidden', 'true');
    cell.appendChild(body);

    const filterBtn = doc.createElement('button');
    filterBtn.type = 'button';
    filterBtn.className = 'mg-header-filter';
    filterBtn.setAttribute('data-mg-filter-btn', '');
    filterBtn.setAttribute('aria-haspopup', 'true');
    filterBtn.setAttribute('aria-expanded', 'false');
    filterBtn.tabIndex = -1;
    filterBtn.textContent = '▼'; // ▼
    cell.appendChild(filterBtn);

    const resizeHandle = doc.createElement('div');
    resizeHandle.className = 'mg-header-resize';
    resizeHandle.setAttribute('data-mg-resize', '');
    resizeHandle.setAttribute('aria-hidden', 'true');
    cell.appendChild(resizeHandle);

    const bandResize = doc.createElement('div');
    bandResize.className = 'mg-header-band-resize';
    bandResize.setAttribute('data-mg-band-resize', '');
    bandResize.setAttribute('aria-hidden', 'true');
    bandResize.style.display = 'none';
    cell.appendChild(bandResize);

    (this.headerBandEls[0] ?? (this.header as HTMLElement)).appendChild(cell);
    return {
      cell,
      label,
      body,
      filterBtn,
      resizeHandle,
      bandResize,
      band: 0,
      colIndex: -1,
      colSpan: 1,
      frozen: false,
    };
  }

  /**
   * Position header cells to track horizontal scroll: a non-frozen columnheader
   * sits at `leadingGutter + colOffsets[c] - scrollLeft` (aligned with its body
   * column), a frozen one stays pinned. Called on scroll + after a resize/reorder.
   */
  positionHeader(
    colOffsets: readonly number[],
    scrollLeft: number,
    frozenColCount: number,
  ): void {
    this.headerColOffsets = colOffsets;
    this.headerFrozenColCount = frozenColCount;
    const g = this.leadingGutter;
    for (const slot of this.headerSlots) {
      if (slot.cell.style.display === 'none' || slot.colIndex < 0) continue;
      const c = slot.colIndex;
      const frozen = c < frozenColCount;
      slot.frozen = frozen;
      slot.cell.style.width = `${(colOffsets[c + slot.colSpan] as number) - (colOffsets[c] as number)}px`;
      // Logical inline positioning (`inset-inline-start`) so column order + the
      // frozen (leading) edge mirror under `dir=rtl`. Data columns are shifted
      // right by the leading row-header gutter width.
      slot.cell.style.insetInlineStart = `${g + (colOffsets[c] as number) - (frozen ? 0 : scrollLeft)}px`;
      slot.cell.style.left = '';
      slot.cell.classList.toggle('mg-header-cell--frozen', frozen);
      slot.cell.style.zIndex = frozen ? '4' : '';
    }
  }

  /** The header cell node for a column id (`LAYER-FILTER-MENU` anchor / affordance). */
  headerCellFor(columnId: ColumnId): HTMLElement | undefined {
    for (const slot of this.headerSlots) {
      if (
        slot.cell.style.display !== 'none' &&
        slot.colIndex >= 0 &&
        slot.cell.getAttribute('data-col-id') === columnId &&
        slot.band === (this.affordanceBandOf() ?? slot.band)
      ) {
        return slot.cell;
      }
    }
    // Fallback: any visible cell for the column.
    for (const slot of this.headerSlots) {
      if (slot.cell.style.display !== 'none' && slot.cell.getAttribute('data-col-id') === columnId) {
        return slot.cell;
      }
    }
    return undefined;
  }

  private affordanceBandOf(): number | undefined {
    for (const slot of this.headerSlots) {
      if (slot.cell.hasAttribute('data-mg-sortable')) return slot.band;
    }
    return undefined;
  }

  renderWindow(args: RenderWindowArgs): void {
    if (!this.body || !this.spacer) return;
    const { rowWindow, colWindow, rows, startIndex, columns, heightIndex, colOffsets } =
      args;
    const editingEnabled = args.editingEnabled !== false;
    const frozenRowCount = args.frozenRowCount ?? 0;
    const frozenColCount = args.frozenColCount ?? 0;
    const scrollTop = args.scrollTop ?? 0;
    const scrollLeft = args.scrollLeft ?? 0;
    const frozenRows = args.frozenRows ?? [];
    const merges = args.merges ?? [];
    const hiddenRows = args.hiddenRows;
    const hiddenCols = args.hiddenCols;
    const gutter = args.gutter;
    const gutterWidth = gutter?.totalWidth ?? 0;
    this.leadingGutter = gutterWidth;
    const doc = this.body.ownerDocument;

    const contentWidth = (colOffsets[colOffsets.length - 1] as number) + gutterWidth;
    this.spacer.style.height = `${heightIndex.totalHeight()}px`;
    this.spacer.style.width = `${contentWidth}px`;
    // Give the scrolling body a concrete inline size so an RTL row's inline-start
    // (right) edge references the content's right edge — the anchor logical
    // `inset-inline-start` cell offsets mirror against.
    this.body.style.width = `${contentWidth}px`;

    const rowStart = rowWindow.firstRow;
    const rowEnd = rowWindow.lastRow; // inclusive
    const colStart = colWindow.firstCol;
    const colEnd = colWindow.lastCol; // inclusive

    // Column render list: pinned frozen columns first, then the scrolled window
    // (deduped). Non-contiguous when the window has scrolled past the frozen prefix.
    const colList: number[] = [];
    for (let c = 0; c < frozenColCount && c < columns.length; c++) {
      if (!hiddenCols?.has(c)) colList.push(c);
    }
    if (colEnd >= colStart) {
      for (let c = Math.max(colStart, frozenColCount); c <= colEnd; c++) {
        if (columns[c] && !hiddenCols?.has(c)) colList.push(c);
      }
    }

    // Row render list: pinned frozen rows first (fetched off-window), then the
    // scrolled window (skipping any rows already covered by the frozen prefix).
    const rowList: RowEntry[] = [];
    for (let fr = 0; fr < frozenRowCount; fr++) {
      if (hiddenRows?.has(fr)) continue;
      const row = frozenRows[fr];
      if (row) rowList.push({ r: fr, row, frozen: true });
    }
    if (rowEnd >= rowStart && colList.length > 0) {
      for (let r = Math.max(rowStart, frozenRowCount); r <= rowEnd; r++) {
        if (hiddenRows?.has(r)) continue;
        const row = rows[r - startIndex];
        if (row) rowList.push({ r, row, frozen: false });
      }
    }

    // Dispatch (`PERF-SCROLL` dirty-diff). A scroll-only refresh (`args.reuse`) with
    // no freeze/merge/group-collapse active can RETAIN already-painted rows by keyed
    // identity and repaint only rows that newly entered the window; any other refresh
    // (content changed, or a freeze/merge/group layout) repaints the whole window via
    // the original always-correct sequential path.
    const ctx: PaintContext = {
      colList,
      colSig: colList.join(','),
      scrollTop,
      scrollLeft,
      editingEnabled,
      frozenColCount,
      columns,
      colOffsets,
      heightIndex,
      merges,
      gutter,
      gutterWidth,
    };
    const fastPath =
      args.reuse === true &&
      frozenRowCount === 0 &&
      frozenColCount === 0 &&
      merges.length === 0 &&
      !gutter &&
      !hiddenRows &&
      !hiddenCols;
    if (fastPath) this.renderKeyed(doc, rowList, ctx);
    else this.renderSequential(doc, rowList, ctx);
  }

  /** Full sequential repaint (always correct): pool slot `i` paints `rowList[i]`. */
  private renderSequential(
    doc: Document,
    rowList: readonly RowEntry[],
    ctx: PaintContext,
  ): void {
    const next = new Map<number, RowSlot>();
    let rowSlot = 0;
    for (const entry of rowList) {
      const slot = this.acquireRow(doc, rowSlot++);
      this.paintRow(doc, slot, entry, ctx);
      next.set(entry.r, slot);
    }
    // Recycle surplus rows beyond the ones used this pass.
    for (let i = rowSlot; i < this.rows.length; i++) this.hideRow(this.rows[i] as RowSlot);
    this.rowIndexToSlot = next;
  }

  /**
   * `PERF-SCROLL` keyed diff: reuse the pool slot already painting each still-visible
   * logical row (matched by rowKey + visible-column signature) UNTOUCHED — because a
   * row is absolutely positioned by its logical index, a retained row needs no DOM
   * write at all — and paint only the rows that newly entered the window into the
   * freed slots. This skips every per-cell attribute/content/geometry write for the
   * rows that merely scrolled within the window (the bulk of a fling).
   */
  private renderKeyed(
    doc: Document,
    rowList: readonly RowEntry[],
    ctx: PaintContext,
  ): void {
    const prev = this.rowIndexToSlot;
    const next = new Map<number, RowSlot>();
    const retained = new Set<RowSlot>();
    const toPaint: RowEntry[] = [];
    for (const entry of rowList) {
      const slot = prev.get(entry.r);
      if (
        slot &&
        !retained.has(slot) &&
        slot.rowKey === entry.row.key &&
        slot.colSig === ctx.colSig &&
        slot.el.style.display !== 'none'
      ) {
        next.set(entry.r, slot); // still visible + identical → leave the DOM as-is
        retained.add(slot);
      } else {
        toPaint.push(entry);
      }
    }
    // Slots not retained are free to paint the newly-entered rows into.
    const free: RowSlot[] = [];
    for (const slot of this.rows) if (!retained.has(slot)) free.push(slot);
    let fi = 0;
    for (const entry of toPaint) {
      const slot = free[fi++] ?? this.acquireRow(doc, this.rows.length);
      this.paintRow(doc, slot, entry, ctx);
      next.set(entry.r, slot);
    }
    // Hide any leftover free slots (rows that left the window without a replacement).
    for (; fi < free.length; fi++) this.hideRow(free[fi] as RowSlot);
    this.rowIndexToSlot = next;
  }

  /** Recycle a pool row slot out of the visible window (hidden, identity dropped). */
  private hideRow(slot: RowSlot): void {
    slot.el.style.display = 'none';
    slot.rowIndex = -1;
    slot.colCount = 0;
    slot.rowKey = null;
    for (const g of slot.gutterCells) g.style.display = 'none';
  }

  /**
   * Recycle a pooled body cell out of the render list: hide it AND strip the
   * identity attributes that make it queryable/announced (`data-col-id`,
   * `data-row-key`, `aria-colindex`, `aria-selected`, active class). A hidden cell
   * that kept its `data-col-id` would still match a `[data-col-id=…]` query even
   * though it paints nothing — the trailing-`hideColumn` leak (`CAP-COLUMN-MANAGE`).
   */
  private recycleCell(cell: HTMLElement): void {
    cell.style.display = 'none';
    cell.removeAttribute('data-col-id');
    cell.removeAttribute('data-row-key');
    cell.removeAttribute('aria-colindex');
    cell.removeAttribute('aria-selected');
    cell.classList.remove('mg-cell--active');
  }

  /** Paint one row entry fully into `slot` (row geometry + every visible cell). */
  private paintRow(doc: Document, slot: RowSlot, entry: RowEntry, ctx: PaintContext): void {
    const { r, row, frozen: frozenRow } = entry;
    const {
      colList,
      columns,
      colOffsets,
      heightIndex,
      merges,
      scrollTop,
      scrollLeft,
      frozenColCount,
      editingEnabled,
      gutter,
      gutterWidth,
    } = ctx;
    const top = heightIndex.offsetOf(r);
    const height = heightIndex.height(r);
    slot.el.style.display = '';
    slot.el.style.top = `${(frozenRow ? scrollTop : 0) + top}px`;
    slot.el.style.height = `${height}px`;
    slot.el.style.zIndex = frozenRow ? '3' : '';
    slot.el.classList.toggle('mg-row--frozen', frozenRow);
    slot.el.setAttribute('aria-rowindex', String(r + 1));
    slot.rowIndex = r;
    slot.colIndices = colList;

    // `DOM-ROWHEADER` — paint the M frozen leading gutter cells for this row.
    this.paintGutter(doc, slot, entry, gutter, scrollLeft);

    // P6 (PERF-FRAME-STEADY): resolve the merges intersecting THIS row once, so the
    // per-cell check is a column-only scan of the (usually 0–1) row-merges instead
    // of an O(merges) full row+column scan for every cell.
    const rowMerges =
      merges.length === 0
        ? EMPTY_MERGES
        : merges.filter((m) => r >= m.range.top && r <= m.range.bottom);

    let cellSlot = 0;
    for (const c of colList) {
      const col = columns[c] as ColumnDef;
      const cell = this.acquireCell(doc, slot, cellSlot++);
      const frozenCol = c < frozenColCount;

      // `CAP-MERGE` — resolve the merge region covering this cell (column-only scan;
      // the row is already guaranteed by `rowMerges`).
      let merge: MergeRegion | undefined;
      for (let mi = 0; mi < rowMerges.length; mi++) {
        const m = rowMerges[mi] as MergeRegion;
        if (c >= m.range.left && c <= m.range.right) {
          merge = m;
          break;
        }
      }
      const isAnchor = !!merge && merge.anchor.row === r && merge.anchor.col === c;
      if (merge && !isAnchor) {
        // A covered (non-anchor) cell: suppress it (not rendered / non-editable)
        // and drop its identity so it is no longer a queryable/announced cell.
        cell.style.display = 'none';
        cell.setAttribute('aria-hidden', 'true');
        cell.setAttribute('aria-readonly', 'true');
        cell.removeAttribute('data-row-key');
        cell.removeAttribute('aria-rowindex');
        cell.removeAttribute('aria-colindex');
        cell.removeAttribute('aria-selected');
        cell.classList.remove('mg-cell--active');
        continue;
      }
      cell.removeAttribute('aria-hidden');

      cell.style.display = '';
      // Logical inline offset (`inset-inline-start`): a non-frozen cell sits at
      // its content offset (the scroll container translates it); a frozen cell
      // adds the inline scroll distance to stay pinned to the leading edge.
      // Mirrors under `dir=rtl` with no LTR pixel-math (`scrollLeft` is the
      // non-negative inline scroll supplied by the grid).
      cell.style.insetInlineStart = `${gutterWidth + (frozenCol ? scrollLeft : 0) + (colOffsets[c] as number)}px`;
      cell.style.left = '';
      if (isAnchor && merge) {
        // The anchor spans the region: width across its columns, height across
        // its rows (overflowing its own row band; the covered cells are hidden).
        const right = merge.range.right;
        const bottom = merge.range.bottom;
        cell.style.width = `${(colOffsets[right + 1] as number) - (colOffsets[c] as number)}px`;
        cell.style.height = `${heightIndex.offsetOf(bottom + 1) - heightIndex.offsetOf(r)}px`;
        cell.style.zIndex = '1';
        cell.classList.add('mg-cell--merged');
        cell.setAttribute('aria-rowspan', String(bottom - merge.range.top + 1));
        cell.setAttribute('aria-colspan', String(right - merge.range.left + 1));
      } else {
        cell.style.width = `${(colOffsets[c + 1] as number) - (colOffsets[c] as number)}px`;
        cell.style.height = '100%';
        cell.classList.remove('mg-cell--merged');
        cell.removeAttribute('aria-rowspan');
        cell.removeAttribute('aria-colspan');
      }
      // Frozen cells lift above the scrolled body + carry an opaque fill; the
      // top-left corner (frozen row ∩ col) sits above both bands.
      const pinned = frozenRow || frozenCol;
      cell.classList.toggle('mg-cell--frozen', pinned);
      cell.style.zIndex = frozenRow && frozenCol ? '4' : frozenCol ? '2' : isAnchor ? '1' : '';
      cell.setAttribute('data-row-key', String(row.key));
      cell.setAttribute('data-col-id', col.id);
      cell.setAttribute('aria-rowindex', String(r + 1));
      cell.setAttribute('aria-colindex', String(c + 1));
      if (!cell.hasAttribute('aria-selected')) {
        cell.setAttribute('aria-selected', 'false');
      }
      const editable = col.editable === true && editingEnabled;
      cell.setAttribute('aria-readonly', editable ? 'false' : 'true');
      // Preserve an open editor overlay (`COMPONENT-EDIT`): a cell marked
      // `data-mg-editing` owns its content until the session tears down.
      if (!cell.hasAttribute('data-mg-editing')) {
        const value = getByPath(row.data, col.field);
        if (this.decorator) {
          this.decorator(cell, {
            rowKey: row.key,
            columnId: col.id,
            field: col.field,
            value,
            data: row.data,
            rowIndex: r,
            colIndex: c,
            column: col,
          });
        } else {
          cell.textContent = value == null ? '' : String(value);
        }
      }
    }
    slot.colCount = cellSlot;
    // Recycle surplus cells in this row: hide AND drop their identity, so a
    // column removed from the tail of the render list (e.g. `hideColumn` on the
    // trailing column, `CAP-COLUMN-MANAGE` `INV-COLUMN-HIDDEN-EXCLUDED`) leaves
    // no queryable/announced `data-col-id` body cell behind — matching how a
    // hidden middle column's cells are overwritten by the leftward shift.
    for (let i = cellSlot; i < slot.cells.length; i++) {
      this.recycleCell(slot.cells[i] as HTMLElement);
    }
    slot.rowKey = row.key;
    slot.colSig = ctx.colSig;
  }

  /**
   * `DOM-ROWHEADER` — paint the M frozen leading gutter cells for a row (pinned on
   * horizontal scroll, like a frozen column). Cells hidden when no gutter.
   */
  private paintGutter(
    doc: Document,
    slot: RowSlot,
    entry: RowEntry,
    gutter: RowHeaderPlan | undefined,
    scrollLeft: number,
  ): void {
    if (!gutter) {
      for (const g of slot.gutterCells) g.style.display = 'none';
      return;
    }
    const { r, row } = entry;
    let offset = 0;
    for (let b = 0; b < gutter.bands; b++) {
      const cell = this.acquireGutterCell(doc, slot, b);
      const width = gutter.widths[b] as number;
      cell.style.display = '';
      cell.style.insetInlineStart = `${scrollLeft + offset}px`;
      cell.style.width = `${width}px`;
      cell.setAttribute('data-row-key', String(row.key));
      cell.setAttribute('data-row-index', String(r));
      cell.setAttribute('aria-rowindex', String(r + 1));
      cell.setAttribute('data-band', String(b));
      const content = gutter.content(b, r, row.key, row.data);
      if (typeof content === 'string') cell.textContent = content;
      else {
        cell.textContent = '';
        cell.appendChild(content);
      }
      offset += width;
    }
    // Hide any surplus pooled gutter cells (fewer bands than before).
    for (let b = gutter.bands; b < slot.gutterCells.length; b++) {
      (slot.gutterCells[b] as HTMLElement).style.display = 'none';
    }
  }

  private acquireGutterCell(doc: Document, slot: RowSlot, index: number): HTMLElement {
    let cell = slot.gutterCells[index];
    if (!cell) {
      cell = doc.createElement('div');
      cell.setAttribute('role', 'rowheader');
      cell.className = 'mg-rowheader-cell';
      cell.setAttribute('tabindex', '-1');
      cell.style.position = 'absolute';
      cell.style.top = '0';
      cell.style.height = '100%';
      cell.style.zIndex = '5';
      slot.el.appendChild(cell);
      slot.gutterCells[index] = cell;
    }
    return cell;
  }

  /**
   * Iterate the live (visible) body cells with their logical 0-based row/col
   * indices — the seam `COMPONENT-INTERACTION` uses to apply selection state
   * (`aria-selected`, roving `tabindex`, active/focus class).
   */
  eachLiveCell(fn: (cell: HTMLElement, rowIndex: number, colIndex: number) => void): void {
    for (const slot of this.rows) {
      if (slot.rowIndex < 0 || slot.el.style.display === 'none') continue;
      for (let i = 0; i < slot.colCount; i++) {
        const cell = slot.cells[i] as HTMLElement;
        if (cell.style.display === 'none') continue;
        fn(cell, slot.rowIndex, slot.colIndices[i] as number);
      }
    }
  }

  /**
   * `CAP-COLUMN-MANAGE` autofit — the **bounded, VISIBLE-ONLY** widest-content
   * measure (px) for a column. Iterates ONLY the live (rendered + overscan) body
   * cells for `colIndex` via `eachLiveCell` — it NEVER scans the full column, so a
   * 1M-row dataset costs one viewport pass, not a million reads (Performance: the
   * autofit budget).
   *
   * Content width = max over the header label + each sampled cell of the text's
   * **intrinsic** width + horizontal padding. Intrinsic width is measured with a
   * single reusable off-screen `<span>` at the cell font (`measureTextWidth`) —
   * NOT `cell.scrollWidth`. `scrollWidth` is bounded below by the cell's own width
   * (an over-wide column's short-content cell reports `scrollWidth === colWidth`,
   * so the old measure could only ever GROW), whereas the detached span's width is
   * independent of the current column width — so autofit can both **grow** a
   * too-narrow column and **shrink** an over-wide one (the contract). In jsdom the
   * span reports width 0, so we fall back to the deterministic glyph estimate
   * (`approxTextWidth`). Returns `0` when the column has no live cells.
   */
  measureColumnContentWidth(
    colIndex: number,
    headerText: string,
    opts?: { padding?: number },
  ): number {
    const pad = opts?.padding ?? AUTOFIT_CELL_PADDING;
    let max = this.measureTextWidth(headerText) + pad;
    this.eachLiveCell((cell, _rowIndex, c) => {
      if (c !== colIndex) return;
      const text = cell.textContent ?? '';
      const w = this.measureTextWidth(text) + pad;
      if (w > max) max = w;
    });
    return Math.ceil(max);
  }

  /**
   * Intrinsic pixel width of `text` at the grid's cell font, measured with the
   * single reusable off-screen span. Falls back to the env-independent glyph
   * estimate when unmounted or when the DOM reports width 0 (jsdom, where layout
   * never runs) — so the measure is deterministic in tests and accurate in a real
   * browser. Padding-free (callers add cell padding); reuses one node across cells.
   */
  private measureTextWidth(text: string): number {
    const estimate = approxTextWidth(text);
    const doc = this.root?.ownerDocument;
    if (!this.root || !doc) return estimate;
    let node = this.measureNode;
    if (!node) {
      node = doc.createElement('span');
      node.setAttribute('aria-hidden', 'true');
      node.style.position = 'absolute';
      node.style.top = '-9999px';
      node.style.left = '-9999px';
      node.style.visibility = 'hidden';
      node.style.whiteSpace = 'nowrap';
      node.style.pointerEvents = 'none';
      // Inherit the grid's cell font (family/size/weight) from the root so the
      // measure matches painted cells; a stray padding/border must not inflate it.
      node.style.padding = '0';
      node.style.border = '0';
      this.root.appendChild(node);
      this.measureNode = node;
    }
    node.textContent = text;
    const measured = node.getBoundingClientRect().width || node.offsetWidth;
    return measured > 0 ? measured : estimate;
  }

  /** The live cell node for logical `(rowIndex, colIndex)`, or `undefined`. */
  cellAt(rowIndex: number, colIndex: number): HTMLElement | undefined {
    for (const slot of this.rows) {
      if (slot.rowIndex !== rowIndex || slot.el.style.display === 'none') continue;
      const i = slot.colIndices.indexOf(colIndex);
      if (i < 0 || i >= slot.colCount) return undefined;
      const cell = slot.cells[i];
      return cell && cell.style.display !== 'none' ? cell : undefined;
    }
    return undefined;
  }

  /** Count of body rows currently displayed (test hook — `CAP-GROUP` collapse). */
  liveRowCount(): number {
    let n = 0;
    for (const slot of this.rows) {
      if (slot.rowIndex >= 0 && slot.el.style.display !== 'none') n++;
    }
    return n;
  }

  /** Count of body cells currently displayed (test hook for `PERF-NODES`). */
  liveCellCount(): number {
    let n = 0;
    for (const slot of this.rows) {
      if (slot.rowIndex < 0 || slot.el.style.display === 'none') continue;
      for (let i = 0; i < slot.colCount; i++) {
        if ((slot.cells[i] as HTMLElement).style.display !== 'none') n++;
      }
    }
    return n;
  }

  destroy(): void {
    if (this.scrollEl && this.scrollListener) {
      this.scrollEl.removeEventListener('scroll', this.scrollListener);
    }
    this.root?.remove();
    this.measureNode = undefined;
    this.root = undefined;
    this.header = undefined;
    this.body = undefined;
    this.scrollEl = undefined;
    this.spacer = undefined;
    this.rows.length = 0;
    this.rowIndexToSlot = new Map();
    this.headerSlots = [];
    this.headerBandEls = [];
    this.cornerEl = undefined;
    this.scrollListener = undefined;
  }

  private acquireRow(doc: Document, slot: number): RowSlot {
    let row = this.rows[slot];
    if (!row) {
      const el = doc.createElement('div');
      el.setAttribute('role', 'row');
      el.className = 'mg-row';
      el.style.position = 'absolute';
      el.style.insetInlineStart = '0';
      el.style.width = '100%';
      (this.body as HTMLElement).appendChild(el);
      row = {
        el,
        cells: [],
        gutterCells: [],
        rowIndex: -1,
        colIndices: [],
        colCount: 0,
        rowKey: null,
        colSig: '',
      };
      this.rows[slot] = row;
    }
    return row;
  }

  private acquireCell(doc: Document, slot: RowSlot, index: number): HTMLElement {
    let cell = slot.cells[index];
    if (!cell) {
      cell = doc.createElement('div');
      cell.setAttribute('role', 'gridcell');
      cell.className = 'mg-cell';
      cell.setAttribute('tabindex', '-1');
      cell.style.position = 'absolute';
      cell.style.top = '0';
      cell.style.height = '100%';
      slot.el.appendChild(cell);
      slot.cells[index] = cell;
    }
    return cell;
  }
}

/**
 * Inject the default base stylesheet once per document: the `--mg-*` token
 * defaults (`SCREEN-GRID` theming), AA-contrast text colors, the selection
 * highlight, and the visible focus ring (`A11Y-GRID`, `--mg-focus-ring` ≥3:1).
 * Idempotent — keyed by a marker attribute so repeated mounts add it once.
 */
/** A trivial single-band label plan (`header ?? id`) when no `HeaderConfig` given. */
function defaultColumnHeaderPlan(columns: readonly ColumnDef[]): ColumnHeaderPlan {
  return {
    bands: 1,
    heights: [28],
    affordanceBand: 0,
    wrap: false,
    cells: columns.map((col, colIndex) => ({
      band: 0,
      colIndex,
      colSpan: 1,
      rowSpan: 1,
      content: col.header ?? col.id,
    })),
  };
}

/** The merge region covering logical `(row, col)`, or `undefined`. */
// P6: shared empty row-merge list (no allocation on the common no-merge path).
const EMPTY_MERGES: readonly MergeRegion[] = [];

function injectBaseStyles(doc: Document): void {
  if (doc.querySelector(`style[${STYLE_MARKER}]`)) return;
  const style = doc.createElement('style');
  style.setAttribute(STYLE_MARKER, '');
  style.textContent = BASE_CSS;
  (doc.head ?? doc.documentElement).appendChild(style);
}

/**
 * Default theme tokens + rules. Colors chosen for WCAG 2.1 AA: body text
 * `#1a1a1a` on `#ffffff` (≈16.9:1), header text `#1a1a1a` on `#f2f2f2`,
 * selection text `#1a1a1a` on `#cfe3fb` (≈13:1). Focus ring `#0b5fff` and the
 * active-cell border are ≥3:1 against their backgrounds.
 */
const BASE_CSS = `
[data-mini-grid] {
  --mg-font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  --mg-font-size: 13px;
  --mg-cell-padding: 4px 8px;
  --mg-row-height-default: 28px;
  --mg-border-color: #d4d4d4;
  --mg-header-bg: #f2f2f2;
  --mg-header-color: #1a1a1a;
  --mg-cell-bg: #ffffff;
  --mg-cell-color: #1a1a1a;
  --mg-selection-bg: #cfe3fb;
  --mg-selection-border: #0b5fff;
  --mg-active-border: #0b5fff;
  --mg-focus-ring: #0b5fff;
  --mg-invalid-border: #b3261e;
  --mg-invalid-color: #7a1a15;
  --mg-invalid-bg: #fde8e6;
  --mg-fill-handle-color: #0b5fff;
  --mg-frozen-shadow: rgba(0, 0, 0, 0.18);
  font-family: var(--mg-font-family);
  font-size: var(--mg-font-size);
  color: var(--mg-cell-color);
  background: var(--mg-cell-bg);
}
[data-mini-grid].mg-theme-dark {
  --mg-border-color: #3a3a3a;
  --mg-header-bg: #262626;
  --mg-header-color: #f2f2f2;
  --mg-cell-bg: #1a1a1a;
  --mg-cell-color: #f2f2f2;
  --mg-selection-bg: #1e3a5f;
  --mg-selection-border: #66a3ff;
  --mg-active-border: #66a3ff;
  --mg-focus-ring: #66a3ff;
  --mg-invalid-border: #f2b8b5;
  --mg-invalid-color: #f2b8b5;
  --mg-invalid-bg: #3a1512;
  --mg-fill-handle-color: #66a3ff;
  --mg-frozen-shadow: rgba(0, 0, 0, 0.5);
}
/* Density preset (UX comfortable default / compact) — tightens padding + the
   default row height token (--mg-cell-padding / --mg-row-height-default). */
[data-mini-grid].mg-density-compact {
  --mg-cell-padding: 1px 6px;
  --mg-row-height-default: 22px;
}
[data-mini-grid] .mg-header {
  background: var(--mg-header-bg);
  color: var(--mg-header-color);
  font-weight: 600;
  border-bottom: 1px solid var(--mg-border-color);
}
[data-mini-grid] .mg-header-cell,
[data-mini-grid] .mg-cell {
  box-sizing: border-box;
  padding: var(--mg-cell-padding);
  border-right: 1px solid var(--mg-border-color);
  border-bottom: 1px solid var(--mg-border-color);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
[data-mini-grid] .mg-cell {
  background: var(--mg-cell-bg);
  color: var(--mg-cell-color);
  /* Logical default alignment: start = left in LTR, right in RTL (mirrors with
     dir on DOM-ROOT — no physical text-align, so i18n RTL flips it for free). */
  text-align: start;
}
[data-mini-grid] .mg-header-label {
  text-align: start;
}
/* Header cells carry their own bg/color (not just the .mg-header container) so
   the contrast is resolvable on each absolutely-positioned columnheader — AA in
   both themes (A11Y-GRID / axe color-contrast). */
[data-mini-grid] .mg-header-cell {
  background: var(--mg-header-bg);
  color: var(--mg-header-color);
  display: flex;
  align-items: center;
  gap: 2px;
  /* Let the right-edge resize handle straddle the border (the label keeps its
     own ellipsis clip, so header text still never overflows). */
  overflow: visible;
}
/* CAP-SORT/-FILTER/-RESIZE/-REORDER header affordances (DOM-HEADER). */
[data-mini-grid] .mg-header-label {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-mini-grid] .mg-header-cell[aria-sort='ascending'] .mg-header-label::after {
  content: ' \\2191'; /* up arrow */
}
[data-mini-grid] .mg-header-cell[aria-sort='descending'] .mg-header-label::after {
  content: ' \\2193'; /* down arrow */
}
[data-mini-grid] .mg-header-cell[data-mg-reorder] .mg-header-label {
  cursor: grab;
}
[data-mini-grid] .mg-header-filter {
  flex: 0 0 auto;
  padding: 0 2px;
  font-size: 9px;
  line-height: 1;
  color: var(--mg-header-color);
  background: transparent;
  border: 0;
  border-radius: 2px;
  cursor: pointer;
}
[data-mini-grid] .mg-header-filter:hover,
[data-mini-grid] .mg-header-filter:focus-visible {
  background: var(--mg-selection-bg);
  outline: none;
}
[data-mini-grid] .mg-header-filter--active {
  color: var(--mg-selection-border);
  font-weight: 700;
}
[data-mini-grid] .mg-header-resize {
  position: absolute;
  top: 0;
  bottom: 0;
  inset-inline-end: -4px;
  width: 9px;
  cursor: col-resize;
  z-index: 5;
}
/* CAP-HEADER (v1.3) — multi-band header region (DOM-HEADER bands, DOM-ROWHEADER
   gutter, DOM-CORNER). Each band is a role="row" strip; cells absolutely
   positioned within. */
[data-mini-grid] .mg-header-band {
  position: relative;
  width: 100%;
}
/* The line-select "body" zone fills the free space after the label so a click on
   the header cell body (outside the sort affordance) line-selects the column. */
[data-mini-grid] .mg-header-body {
  flex: 1 1 auto;
  align-self: stretch;
  min-width: 0;
  cursor: pointer;
}
/* Multi-line / wrapping header labels (header.columns.wrap). */
[data-mini-grid] .mg-header-label--wrap {
  white-space: normal;
  overflow: visible;
  text-overflow: clip;
}
/* The sort affordance region — a pointer cursor to signal it triggers sort. */
[data-mini-grid] .mg-header-label[data-mg-sort] {
  cursor: pointer;
}
/* DOM-CORNER — the row-header × column-header intersection (select-all). */
[data-mini-grid] .mg-header-corner {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--mg-cell-padding);
  background: var(--mg-header-bg);
  color: var(--mg-header-color);
  border-right: 1px solid var(--mg-border-color);
  border-bottom: 1px solid var(--mg-border-color);
  cursor: pointer;
  z-index: 6;
}
/* DOM-ROWHEADER — a frozen leading-edge gutter cell (role="rowheader"). */
[data-mini-grid] .mg-rowheader-cell {
  box-sizing: border-box;
  padding: var(--mg-cell-padding);
  background: var(--mg-header-bg);
  color: var(--mg-header-color);
  font-weight: 600;
  border-right: 1px solid var(--mg-border-color);
  border-bottom: 1px solid var(--mg-border-color);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  text-align: center;
  cursor: pointer;
}
/* Band-height resize handle (bottom edge of the affordance band). */
[data-mini-grid] .mg-header-band-resize {
  position: absolute;
  inset-inline: 0;
  bottom: -4px;
  height: 9px;
  cursor: row-resize;
  z-index: 5;
}
/* CAP-FREEZE — pinned cells carry an opaque fill + a boundary shadow so the
   scrolled body shows through neither the frozen rows (top) nor columns (left). */
[data-mini-grid] .mg-cell--frozen {
  background: var(--mg-cell-bg);
}
[data-mini-grid] .mg-header-cell--frozen {
  box-shadow: 2px 0 3px -1px var(--mg-frozen-shadow);
}
/* CAP-MERGE — the anchor cell spans its region (width/height set inline) and
   carries an opaque fill so it cleanly covers the suppressed covered cells. */
[data-mini-grid] .mg-cell--merged {
  background: var(--mg-cell-bg);
  display: flex;
  align-items: center;
}
[data-mini-grid] .mg-cell[aria-selected='true'] {
  background: var(--mg-selection-bg);
}
/* CAP-GROUP — the outline collapse/expand toggle overlay (keyboard-operable). It
   is a sibling of the grid root (kept out of the grid role="grid"/rowgroup/row
   ARIA tree), so its styles are self-contained (they do not rely on the grid's
   --mg-* var scope). AA-contrast: #1a1a1a on #f2f2f2. */
.mg-group-outline {
  position: absolute;
  top: 0;
  /* Span the full inline width so toggle buttons positioned by inset-inline-start
     reference the correct (mirrored) edge under dir=rtl. */
  inset-inline: 0;
  pointer-events: none;
  z-index: 6;
}
.mg-group-toggle {
  position: absolute;
  box-sizing: border-box;
  width: 16px;
  height: 16px;
  padding: 0;
  font: 11px/14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  text-align: center;
  color: #1a1a1a;
  background: #f2f2f2;
  border: 1px solid #767676;
  border-radius: 3px;
  cursor: pointer;
  pointer-events: auto;
}
.mg-group-toggle:hover,
.mg-group-toggle:focus-visible {
  outline: 2px solid #0b5fff;
  outline-offset: 1px;
}
[data-mini-grid] .mg-cell.mg-cell--active {
  outline: 2px solid var(--mg-active-border);
  outline-offset: -2px;
}
/* COMPONENT-CLIPBOARD — the fill handle at the active range's bottom-right corner
   (BIND-POINTER: drag to fill; touch fill on JOURNEY-TOUCH). A DOM node only. */
[data-mini-grid] .mg-fill-handle {
  position: absolute;
  width: 8px;
  height: 8px;
  inset-block-end: -4px;
  inset-inline-end: -4px;
  background: var(--mg-fill-handle-color);
  border: 1px solid var(--mg-cell-bg);
  border-radius: 1px;
  cursor: crosshair;
  z-index: 4;
  pointer-events: auto;
  touch-action: none;
}
/* COMPONENT-CONDFMT — in-cell data bar (behind text) + icon-set glyph. Drawn as
   DOM nodes only (SEC-RENDERER-DOM-ONLY); never innerHTML of untrusted content. */
[data-mini-grid] .mg-databar {
  position: absolute;
  top: 2px;
  bottom: 2px;
  inset-inline-start: 0;
  z-index: -1;
  border-radius: 1px;
  pointer-events: none;
}
[data-mini-grid] .mg-icon {
  display: inline-block;
  margin-inline-end: 4px;
}
[data-mini-grid] .mg-cell:focus,
[data-mini-grid] .mg-cell:focus-visible {
  outline: 2px solid var(--mg-focus-ring);
  outline-offset: -2px;
}
[data-mini-grid]:focus,
[data-mini-grid]:focus-visible {
  outline: 2px solid var(--mg-focus-ring);
  outline-offset: -2px;
}
/* LAYER-EDITOR (DOM-EDITOR) — the in-cell edit overlay + its control. */
[data-mini-grid] .mg-editor {
  box-sizing: border-box;
  background: var(--mg-cell-bg);
  z-index: 2;
}
[data-mini-grid] .mg-editor-input,
[data-mini-grid] .mg-editor-select {
  color: var(--mg-cell-color);
  background: var(--mg-cell-bg);
  outline: 2px solid var(--mg-active-border);
  outline-offset: -2px;
}
[data-mini-grid] .mg-editor-input[aria-invalid='true'],
[data-mini-grid] .mg-editor-select[aria-invalid='true'] {
  outline-color: var(--mg-invalid-border);
}
/* LAYER-VALIDATION-TIP — the inline validation message under the editor. */
[data-mini-grid] .mg-validation-tip {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 3;
  max-width: 240px;
  padding: 2px 6px;
  font-size: 12px;
  color: var(--mg-invalid-color);
  background: var(--mg-invalid-bg);
  border: 1px solid var(--mg-invalid-border);
  white-space: normal;
}
/* LAYER-CONTEXT-MENU (A11Y-CONTEXT-MENU) — portaled to <body>, so its styles are
   self-contained (do not rely on the grid's --mg-* var scope). AA-contrast:
   #1a1a1a on #ffffff (light) / #f2f2f2 on #1a1a1a (dark). */
.mg-context-menu {
  position: fixed;
  min-width: 180px;
  padding: 4px 0;
  background: #ffffff;
  color: #1a1a1a;
  border: 1px solid #d4d4d4;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  font-size: 13px;
}
.mg-context-menu-item {
  padding: 4px 12px;
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
}
.mg-context-menu-item:hover:not([aria-disabled='true']),
.mg-context-menu-item:focus,
.mg-context-menu-item:focus-visible {
  background: #cfe3fb;
  outline: none;
}
.mg-context-menu-item[aria-disabled='true'] {
  color: #595959; /* AA (≈7:1) on #fff while reading as "disabled" */
  cursor: default;
}
.mg-context-menu-sep {
  height: 0;
  margin: 4px 0;
  border-top: 1px solid #d4d4d4;
}
.mg-context-menu--dark {
  background: #1a1a1a;
  color: #f2f2f2;
  border-color: #3a3a3a;
}
.mg-context-menu--dark .mg-context-menu-item:hover:not([aria-disabled='true']),
.mg-context-menu--dark .mg-context-menu-item:focus,
.mg-context-menu--dark .mg-context-menu-item:focus-visible {
  background: #1e3a5f;
}
.mg-context-menu--dark .mg-context-menu-item[aria-disabled='true'] {
  color: #a6a6a6;
}
.mg-context-menu--dark .mg-context-menu-sep {
  border-color: #3a3a3a;
}
/* LAYER-FILTER-MENU (A11Y-FILTER-MENU) — portaled to <body>, self-contained
   styles (AA-contrast, matching the context menu). */
.mg-filter-menu {
  position: fixed;
  z-index: 10;
  min-width: 200px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: #ffffff;
  color: #1a1a1a;
  border: 1px solid #d4d4d4;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  font-size: 13px;
}
.mg-filter-menu label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
}
.mg-filter-menu select,
.mg-filter-menu input {
  font: inherit;
  padding: 3px 4px;
  color: #1a1a1a;
  background: #ffffff;
  border: 1px solid #767676;
  border-radius: 3px;
}
.mg-filter-menu .mg-filter-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
}
.mg-filter-menu button {
  font: inherit;
  padding: 3px 10px;
  cursor: pointer;
  color: #1a1a1a;
  background: #f2f2f2;
  border: 1px solid #767676;
  border-radius: 3px;
}
.mg-filter-menu button:hover,
.mg-filter-menu button:focus-visible,
.mg-filter-menu select:focus-visible,
.mg-filter-menu input:focus-visible {
  outline: 2px solid #0b5fff;
  outline-offset: 1px;
}
.mg-filter-menu--dark {
  background: #1a1a1a;
  color: #f2f2f2;
  border-color: #3a3a3a;
}
.mg-filter-menu--dark select,
.mg-filter-menu--dark input {
  color: #f2f2f2;
  background: #1a1a1a;
  border-color: #a6a6a6;
}
.mg-filter-menu--dark button {
  color: #f2f2f2;
  background: #262626;
  border-color: #a6a6a6;
}
/* CE-SELECT-POPOVER — the select editor's option listbox, portaled to body so
   it escapes the cell's overflow clip. Self-contained styles (AA-contrast,
   matching the context/filter menus); scrolls internally for long lists. */
.mg-select-popover {
  position: fixed;
  z-index: 11;
  min-width: 120px;
  max-height: 240px;
  overflow-y: auto;
  padding: 4px 0;
  background: #ffffff;
  color: #1a1a1a;
  border: 1px solid #d4d4d4;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  font-size: 13px;
}
.mg-select-option {
  padding: 4px 12px;
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
}
.mg-select-option:hover,
.mg-select-option.mg-select-option--active,
.mg-select-option:focus,
.mg-select-option:focus-visible {
  background: #cfe3fb;
  outline: none;
}
.mg-select-popover--dark {
  background: #1a1a1a;
  color: #f2f2f2;
  border-color: #3a3a3a;
}
.mg-select-popover--dark .mg-select-option:hover,
.mg-select-popover--dark .mg-select-option.mg-select-option--active,
.mg-select-popover--dark .mg-select-option:focus,
.mg-select-popover--dark .mg-select-option:focus-visible {
  background: #1e3a5f;
}
@media (prefers-reduced-motion: reduce) {
  [data-mini-grid] .mg-scroll { scroll-behavior: auto; }
}
/* A11Y-GRID live regions — visually hidden (sr-only) but read by assistive tech.
   Mounted on the grid's container (a sibling of role="grid"), so the rule is
   standalone (not scoped under [data-mini-grid]). Never aria-hidden, never
   focusable — announcing must not steal focus. */
[data-mg-live] {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  border: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}
/* Forced-colors / high-contrast (A11Y-GRID, AC-FORCED-COLORS). Under a forced
   palette the OS may drop backgrounds/fills, so pin borders + focus + selection
   to SYSTEM colors so they stay visible, and keep conditional-format decorations
   (data bars/color scales) from being the SOLE carrier — the cell value text is
   always present, and a decorative bar keeps a visible outline. */
@media (forced-colors: active) {
  [data-mini-grid] .mg-header,
  [data-mini-grid] .mg-header-cell,
  [data-mini-grid] .mg-cell {
    border-color: CanvasText;
  }
  [data-mini-grid] .mg-cell:focus,
  [data-mini-grid] .mg-cell:focus-visible,
  [data-mini-grid] .mg-cell.mg-cell--active,
  [data-mini-grid]:focus,
  [data-mini-grid]:focus-visible,
  [data-mini-grid] .mg-editor-input,
  [data-mini-grid] .mg-editor-select {
    outline-color: Highlight;
  }
  [data-mini-grid] .mg-cell[aria-selected='true'] {
    background: Highlight;
    color: HighlightText;
    forced-color-adjust: none;
  }
  [data-mini-grid] .mg-header-filter--active {
    outline: 1px solid Highlight;
  }
  /* Conditional-format data bar is decorative — keep a visible edge so its shape
     survives when the fill is dropped (meaning is never color-alone). */
  [data-mini-grid] .mg-databar {
    outline: 1px solid CanvasText;
    forced-color-adjust: none;
  }
  .mg-context-menu,
  .mg-filter-menu {
    border: 1px solid CanvasText;
  }
  .mg-context-menu-item:focus,
  .mg-context-menu-item:focus-visible,
  .mg-context-menu-item:hover:not([aria-disabled='true']) {
    outline: 2px solid Highlight;
    outline-offset: -2px;
  }
  .mg-group-toggle {
    border-color: CanvasText;
  }
}
`;
