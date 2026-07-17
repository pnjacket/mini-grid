/**
 * Shared identity & value types (Interfaces & Contracts — "Shared conventions
 * & types"). Single-sourced so every element references these. All camelCase.
 */

/** Row identity: the host value at `keyField`, or the positional index. */
export type RowKey = string | number;

/** Stable, developer-supplied column identifier (unique within the sheet). */
export type ColumnId = string;

/** A row's record. Cell values project from here (`INV-CELL-DERIVED`). */
export type RowData = Record<string, unknown>;

/** `ENTITY-ROW.changeState` — the row change-tracking state machine. */
export type ChangeState = 'clean' | 'dirty' | 'new' | 'removed';

/** `CellRef` — addresses one cell by row key + column id. */
export interface CellRef {
  rowKey: RowKey;
  columnId: ColumnId;
}

/** `Range` — inclusive, normalized (`top<=bottom`, `left<=right`) logical indices. */
export interface Range {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** `CellStyle` — projection of `ENTITY-CELL-STYLE` (all optional). */
export interface CellStyle {
  textColor?: string;
  fillColor?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number | 'bold';
  italic?: boolean;
  underline?: boolean;
  borders?: {
    top?: CellBorder;
    right?: CellBorder;
    bottom?: CellBorder;
    left?: CellBorder;
  };
  align?: {
    h?: 'start' | 'center' | 'end';
    v?: 'top' | 'middle' | 'bottom';
  };
  wrap?: boolean;
  indent?: number;
  formatMask?: string;
}

export interface CellBorder {
  style: 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted';
  color: string;
}

/** Column value type (`ENTITY-COLUMN.type`). */
export type ColumnType =
  | 'text'
  | 'number'
  | 'date'
  | 'boolean'
  | 'select'
  | 'custom';

/** `type Comparator = (a, b) => number` — runs in the data engine (`LIB-COMPARATOR-API`). */
export type Comparator = (a: unknown, b: unknown) => number;

/** Context passed to a `FilterPredicate` when the engine evaluates it. */
export interface FilterContext {
  rowKey: RowKey;
  columnId: ColumnId;
  field: string;
  data: Readonly<RowData>;
}

/** `type FilterPredicate = (value, ctx) => boolean` (`LIB-COMPARATOR-API`). */
export type FilterPredicate = (value: unknown, ctx: FilterContext) => boolean;

/**
 * `BuiltinFilter` (v1.1, `ADR-SORT-FILTER-SEAM`) — a **serializable** per-column
 * filter descriptor. Because it carries no functions it survives `postMessage`,
 * so a fully-built-in `FilterSpec` runs OFF-THREAD in the worker (the engine
 * compiles the descriptor → predicate worker-side). Comparison ops (`gt`/`lt`/
 * `between`/`equals`/`notEquals`) carry an already-coerced comparable `value`/
 * `values` (numbers for number/date columns, lower-cased strings for text); the
 * text ops (`contains`/`startsWith`/`endsWith`/`in`) carry raw strings.
 */
export interface BuiltinFilter {
  op:
    | 'equals'
    | 'notEquals'
    | 'contains'
    | 'startsWith'
    | 'endsWith'
    | 'gt'
    | 'lt'
    | 'between'
    | 'in'
    | 'blank'
    | 'notBlank';
  value?: string | number;
  values?: (string | number)[];
}

/**
 * `ColumnFilter` (v1.1) — a per-column filter is EITHER a serializable
 * `BuiltinFilter` descriptor (worker-side) OR a custom `FilterPredicate` function
 * (main-thread; can't cross `postMessage`). The presence of any function in a
 * `FilterSpec` forces the whole filter op onto the main thread
 * (`ADR-SORT-FILTER-SEAM`).
 */
export type ColumnFilter = BuiltinFilter | FilterPredicate;

export type SortDirection = 'asc' | 'desc';

/**
 * `SortSpec` — precedence follows entry order; empty = natural order. An entry's
 * optional `comparator` (v1.1) is a **custom function** (`LIB-COMPARATOR-API`);
 * its presence forces the sort onto the main thread (`ADR-SORT-FILTER-SEAM`).
 * The declarative `{ columnId, direction }` shape is serializable and runs in the
 * worker.
 */
export interface SortSpec {
  entries: { columnId: ColumnId; direction: SortDirection; comparator?: Comparator }[];
}

/**
 * `FilterSpec` — AND-combined per-column filters; empty = no filter (all rows).
 * *(v1.1)* each entry is a `ColumnFilter` = serializable `BuiltinFilter` OR a
 * custom `FilterPredicate` function.
 */
export interface FilterSpec {
  perColumn: Record<ColumnId, ColumnFilter>;
}

/**
 * `ENTITY-FREEZE-PANE` projection — the count of frozen (pinned) top rows + left
 * columns. `INV-FREEZE-PREFIX`: each count is clamped to `[0, extent]`.
 */
export interface FreezePane {
  rows: number;
  cols: number;
}

/**
 * `ENTITY-MERGE-REGION` projection — a rectangular span of `≥2` cells rendered as
 * one cell. `anchor` is always the region's top-left `(range.top, range.left)`;
 * the anchor holds the value and is the (only) editable cell of the region.
 * `INV-MERGE-NONOVERLAP` (pairwise-disjoint) + `INV-MERGE-MIN2` (`≥2` cells).
 */
export interface MergeRegion {
  range: Range;
  anchor: { row: number; col: number };
}

/** `ENTITY-GROUP-NODE.axis` — the outline axis a group nests along. */
export type GroupAxis = 'row' | 'column';

/**
 * `ENTITY-GROUP-NODE` projection — an outline/grouping node over a contiguous
 * span of rows or columns. Same-axis nodes are disjoint-or-nested (a forest —
 * `INV-GROUP-NEST`); `level` is the nesting depth; `collapsed` hides the spanned
 * rows/cols from the virtualization window.
 */
export interface GroupNode {
  id: string;
  axis: GroupAxis;
  start: number;
  span: number;
  level: number;
  collapsed: boolean;
}

/** Duplicate-key policy at bind (`INV-ROWKEY-UNIQUE`). */
export type OnDuplicateKey = 'reject' | 'last-wins';

/**
 * `CellContext` — the read-only projection handed to developer-supplied cell
 * extension points (`LIB-RENDERER-API`, `LIB-FORMATTER-API`,
 * `LIB-CONDFMT-PREDICATE`). Identity + derived value (`INV-CELL-DERIVED`) + the
 * row record + the cell's live logical position.
 */
export interface CellContext {
  rowKey: RowKey;
  columnId: ColumnId;
  field: string;
  value: unknown;
  data: Readonly<RowData>;
  rowIndex: number;
  colIndex: number;
}

/**
 * `LIB-FORMATTER-API` — `FormatterFn = (value, ctx) => string`. Pure; maps a raw
 * cell value to its **display** string (editing still edits the raw value).
 */
export type FormatterFn = (value: unknown, ctx: CellContext) => string;

/**
 * `LIB-RENDERER-API` — `CellRenderer = (ctx) => Node | string`. Returns a DOM
 * **Node** (or a plain string, applied via `textContent`). There is **no
 * raw-HTML-string path** — a returned string is never `innerHTML`
 * (`SEC-RENDERER-DOM-ONLY`), so HTML injection through a renderer is
 * structurally impossible.
 */
export type CellRenderer = (ctx: CellContext) => Node | string;

/**
 * `LIB-CONDFMT-PREDICATE` — `CondFmtPredicate = (cell) => CellStyle | null`. Pure;
 * a `custom` conditional rule maps a cell to a style overlay (or `null` = no
 * contribution).
 */
export type CondFmtPredicate = (cell: CellContext) => CellStyle | null;

// ===========================================================================
// `CAP-HEADER` (v1.3) — the unified, symmetric header region (`DOM-HEADER`/
// `DOM-ROWHEADER`/`DOM-CORNER`). A **developer-populated** region with NO imposed
// hierarchy: N column-header bands + M row-header columns, each cell's content +
// span chosen freely by a `HeaderRenderer` (no parent/child tree).
// ===========================================================================

/**
 * `HeaderRenderer` (v1.3) — the symmetric per-cell header renderer. `band` is the
 * 0-based band index (0 = topmost column band / leading-most row band; the
 * **bottom/primary** column band is `bands-1`). A returned **string renders as
 * text via `textContent`**, a `Node` is inserted as-is — **no raw-HTML sink**
 * (`SEC-RENDERER-DOM-ONLY`); the `{ content, colSpan?, rowSpan? }` form declares a
 * header-cell **span/merge** (developer-driven; no hierarchy imposed). Overlapping
 * or out-of-bounds spans are rejected at config time → `INVALID_OPTIONS`.
 */
export type HeaderRenderer = (ctx: HeaderRenderContext) => HeaderRenderResult;

/** The read-only projection handed to a `HeaderRenderer`. */
export interface HeaderRenderContext {
  axis: 'column' | 'row';
  band: number;
  columnId?: ColumnId;
  rowKey?: RowKey;
  rowIndex?: number;
  colIndex?: number;
  data?: Readonly<RowData>;
}

/** A `HeaderRenderer`'s return: bare content, or content + a span/merge. */
export type HeaderRenderResult =
  | string
  | Node
  | { content: string | Node; colSpan?: number; rowSpan?: number };

/**
 * `HeaderConfig` (v1.3, all fields optional; absent = today's single default
 * column-header row, no row-header, no corner) — carried on
 * `GridOptions.header`. Fully symmetric header-region config.
 */
export interface HeaderConfig {
  /** N column-header bands (rows). */
  columns?: {
    /** Number of column-header rows (default 1). */
    bands?: number;
    /** Band height px (a single value applies to all; an array is per-band). */
    height?: number | number[];
    /** Drag to resize band height (gated by the `headerResize` flag). */
    resizable?: boolean;
    /** Multi-line / wrapping header labels. */
    wrap?: boolean;
    /** Per-cell renderer; falls back to the built-in `header ?? id` label helper. */
    render?: HeaderRenderer;
    /**
     * Which band carries the sort/filter/resize affordances (default `'bottom'`
     * = the primary band `bands-1`).
     */
    affordances?: 'bottom' | number;
  };
  /** M row-header columns (the frozen leading-edge gutter); `false`/absent = none. */
  rows?:
    | false
    | {
        /** Number of row-header columns (default 1). */
        bands?: number;
        /** Row-header width px (single = all bands; array = per-band). */
        width?: number | number[];
        /** Drag to resize row-header width (gated by the `headerResize` flag). */
        resizable?: boolean;
        /** Built-in convenience helper or a custom renderer (default `'number'`). */
        content?: 'number' | 'key' | HeaderRenderer;
        /** Click a gutter cell → line-select the whole row (default `true`). */
        select?: boolean;
      };
  /** The row-header × column-header intersection cell. */
  corner?: {
    /** Developer-customizable corner content. */
    render?: HeaderRenderer;
    /** Click the corner → select-all (default `true`). */
    selectAll?: boolean;
  };
  /** Enable `ColumnDef.headerTooltip` string tooltips (default `true` when any set). */
  tooltips?: boolean;
  /**
   * `CAP-COLUMN-MANAGE` — enable the autofit affordance (double-click a column
   * resize handle to fit + the `autofitAllColumns()` action). Composes with the
   * `autofit` feature flag.
   */
  autofit?: boolean;
  /**
   * `CAP-MENU` (v1.4) — enable the dedicated header context-menu **surface**
   * (`LAYER-HEADER-MENU`); its **content** comes from `GridOptions.menu` (the
   * target-branched `MenuBuilder`). Default `true` when `header` is set.
   */
  menu?: boolean;
}

// ===========================================================================
// `CAP-MENU` (v1.4) — configurable, target-branched context menus. ONE builder
// drives both the body-cell `LAYER-CONTEXT-MENU` and the dedicated header/
// row-header/corner `LAYER-HEADER-MENU`, branching on `MenuContext.target.kind`.
// ===========================================================================

/** The four surfaces a menu can open over (`MenuContext.target.kind`). */
export type MenuTargetKind = 'cell' | 'column-header' | 'row-header' | 'corner';

/**
 * `BuiltinCommandId` — the command-id catalog (the raw `{ command }` built-in
 * path: grid supplies behavior, developer supplies presentation). Each routes to
 * its owning `LIB-*`; a built-in whose capability flag is **off** auto-hides.
 * (Superset of the interfaces-doc catalog — adds `select-all`.)
 */
export type BuiltinCommandId =
  | 'copy'
  | 'cut'
  | 'paste'
  | 'insert-row-above'
  | 'insert-row-below'
  | 'delete-rows'
  | 'insert-col-left'
  | 'insert-col-right'
  | 'delete-cols'
  | 'sort-asc'
  | 'sort-desc'
  | 'clear-sort'
  | 'filter'
  | 'hide-column'
  | 'show-column'
  | 'pin-column'
  | 'unpin-column'
  | 'autofit'
  | 'autofit-all'
  | 'group-by'
  | 'ungroup'
  | 'select-all';

/**
 * `MenuContext` — the read-only projection handed to a `MenuBuilder` (and to a
 * `MenuItem` `handler`/`render`). `target.kind` selects the surface; the branch
 * fields populate per kind.
 */
export interface MenuContext {
  target: {
    kind: MenuTargetKind;
    cellRef?: CellRef;
    columnId?: ColumnId;
    rowKey?: RowKey;
  };
  /** The current range-set (`Selection.ranges`). */
  selection: Range[];
  /** The cell value for a `'cell'` target (best-effort). */
  value?: unknown;
  /** The originating pointer/keyboard `Event`. */
  event: Event;
  /** The viewport anchor point. */
  position: { x: number; y: number };
}

/** A `MenuItem` `action`/toggle/radio handler (may itself do async work). */
export type MenuItemHandler = (ctx: MenuContext) => void;
/**
 * A `custom` `MenuItem`'s renderer: returns **developer-owned DOM** mounted
 * **as-is** (NOT auto-escaped — `SEC-MENU-CUSTOM-RENDER`, a developer-trust
 * boundary distinct from the cell `SEC-RENDERER-DOM-ONLY` guarantee).
 */
export type MenuItemRender = (ctx: MenuContext) => Node;

/** Common fields shared by every interactive `MenuItem` kind. */
interface MenuItemCommon {
  id: string;
  /** Literal label (used as text as-is). */
  label?: string;
  /** i18n key resolved through the bundle via `LIB-LOCALE` (as text). */
  labelKey?: string;
  icon?: string | Node;
  /** Hint text only — **not** a key binding. */
  shortcut?: string;
  /** Omit the item entirely. */
  hidden?: boolean;
  /** Render greyed + `aria-disabled`. */
  disabled?: boolean;
}

export interface MenuActionItem extends MenuItemCommon {
  kind: 'action';
  handler?: MenuItemHandler;
  command?: BuiltinCommandId | string;
}
export interface MenuSeparatorItem {
  kind: 'separator';
  id?: string;
  group?: string;
}
export interface MenuSubmenuItem extends MenuItemCommon {
  kind: 'submenu';
  children: MenuItem[];
}
export interface MenuToggleItem extends MenuItemCommon {
  kind: 'checkbox' | 'toggle';
  checked?: boolean;
  handler?: MenuItemHandler;
  command?: BuiltinCommandId | string;
}
export interface MenuRadioItem extends MenuItemCommon {
  kind: 'radio';
  group: string;
  checked?: boolean;
  handler?: MenuItemHandler;
  command?: BuiltinCommandId | string;
}
export interface MenuCustomItem extends MenuItemCommon {
  kind: 'custom';
  render: MenuItemRender;
}

/** `MenuItem` — a discriminated union on `kind`. */
export type MenuItem =
  | MenuActionItem
  | MenuSeparatorItem
  | MenuSubmenuItem
  | MenuToggleItem
  | MenuRadioItem
  | MenuCustomItem;

/**
 * `MenuBuilder` — a **single** builder switching on `ctx.target.kind` to return
 * the cell menu vs the dedicated header/row-header/corner menus. Synchronous
 * (returns `MenuItem[]` immediately; async/loading item state is [FUTURE-SCOPE]).
 */
export type MenuBuilder = (ctx: MenuContext) => MenuItem[];

/** `LIB-MENU` — the programmatic `openMenu(target, position?)` target. */
export type MenuTarget =
  | { kind: 'cell'; cellRef: CellRef }
  | { kind: 'column-header'; columnId: ColumnId }
  | { kind: 'row-header'; rowKey: RowKey }
  | { kind: 'corner' };
