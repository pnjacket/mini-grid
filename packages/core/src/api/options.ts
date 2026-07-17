/**
 * Public option & column types (`LIB-OPTIONS` / `LIB-COLUMN-DEF`) — projections
 * of `ENTITY-COLUMN` / `ENTITY-SHEET`. Slice-1 subset; expands in later slices.
 */
import type {
  CellRenderer,
  CellStyle,
  ColumnId,
  ColumnType,
  Comparator,
  FilterSpec,
  FormatterFn,
  FreezePane,
  GroupAxis,
  GroupNode,
  HeaderConfig,
  HeaderRenderer,
  MenuBuilder,
  MenuTarget,
  MergeRegion,
  OnDuplicateKey,
  Range,
  RowData,
  RowKey,
  SortSpec,
} from '../types.js';
import type {
  ConditionalRuleInput,
} from '../format/conditional.js';
import type { DataTransport, WorkerLike } from '../protocol/transport.js';
import type { KeyMap } from '../interaction/keymap.js';
import type { MessageBundle } from '../i18n/i18n.js';
import type { Selection } from '../selection/selection.js';
import type { FeatureFlag, FeatureFlags } from './features.js';
import type {
  BeforeEvent,
  GridAfterEvents,
  GridBeforeEvents,
  GridEvent,
} from './event-bus.js';
import type { Unsubscribe } from '../store/store.js';
import type { EditorSpec } from '../editing/editors.js';
import type { ValidationRule } from '../editing/validation.js';
import type { EditResult, RowChanges } from '../editing/edit-session.js';
import type { CellRef } from '../types.js';
import type { ExportOptions } from '../export/export.js';
import type { GridState } from '../state/state-serde.js';

export interface ColumnFlags {
  sortable?: boolean;
  filterable?: boolean;
  resizable?: boolean;
  reorderable?: boolean;
}

/** `LIB-COLUMN-DEF` — projection of `ENTITY-COLUMN`. */
export interface ColumnDef {
  id: ColumnId;
  field: string;
  header?: string;
  type?: ColumnType;
  width?: number;
  editable?: boolean;
  /** `LIB-EDITOR-API` — overrides the `type`-default editor for this column. */
  editor?: EditorSpec;
  /** `LIB-VALIDATOR-API` — declarative built-in rules run on commit. */
  validation?: readonly ValidationRule[];
  /**
   * `CAP-FMT-VALUE` — value-format mask (`ENTITY-COLUMN.formatMask`): a mask
   * string (`number`/`currency:USD`/`percent`/`date`) or a `FormatterFn`
   * (`LIB-FORMATTER-API`). Affects the DISPLAY string only; editing edits raw.
   */
  formatMask?: string | FormatterFn;
  /** `CAP-FMT-CELL` — base cell style for the column (bottom of the cascade). */
  defaultStyle?: CellStyle;
  /**
   * `LIB-RENDERER-API` — custom cell renderer returning a DOM `Node` (or a plain
   * string, applied via `textContent`). No raw-HTML-string path
   * (`SEC-RENDERER-DOM-ONLY`).
   */
  renderer?: CellRenderer;
  comparator?: Comparator;
  flags?: ColumnFlags;
  /**
   * `CAP-HEADER` (v1.3) — per-column header renderer; overrides
   * `header.columns.render` for this column (`HeaderRenderer`,
   * `SEC-RENDERER-DOM-ONLY`).
   */
  headerRender?: HeaderRenderer;
  /** `CAP-HEADER` (v1.3) — simple tooltip text (title/aria) on the column header. */
  headerTooltip?: string;
  /**
   * `CAP-COLUMN-MANAGE` (v1.3) — omit the column from the view + ordered-index
   * projection (`INV-COLUMN-HIDDEN-EXCLUDED`): not rendered, width 0, but its
   * `id`/`field`/styles + data are retained so `showColumn` restores it (distinct
   * from the destructive `removeColumn`). Default `false`.
   */
  hidden?: boolean;
  /**
   * `CAP-COLUMN-MANAGE` (v1.3) — leading-edge pin (RTL-aware; the pinned columns
   * form a **leading contiguous block**, `INV-COLUMN-PIN-LEADING`, joining the
   * frozen leading prefix). No trailing option.
   */
  pinned?: 'leading';
}

/** `LIB-OPTIONS` — the options accepted by `createGrid`. */
export interface GridOptions {
  /** Optional initial dataset; equivalent to a `setData(data)` after mount. */
  data?: readonly RowData[];
  /** Column definitions (required). */
  columns: readonly ColumnDef[];
  /**
   * Per-capability feature flags (`PATTERN-FEATURE-FLAGS`). Each flag defaults to
   * `true`; a disabled feature is never registered (no affordance, no cost).
   */
  features?: Partial<FeatureFlags>;
  /** Row-identity field; when absent, identity is the positional index. */
  keyField?: string;
  /** Duplicate-key policy at bind (default `'reject'`). */
  onDuplicateKey?: OnDuplicateKey;
  /** Preserve selection/history across rebind (default reset). */
  preserveOnRebind?: boolean;
  /**
   * `CAP-HEADER` (v1.3) — the unified, symmetric header-region config
   * (`HeaderConfig`): N column-header bands + optional M row-header gutter
   * columns + corner + tooltips, with developer-driven per-cell renderers and
   * spans (no imposed hierarchy). Absent = today's single default column-header
   * row, no row-header, no corner. Replaces the removed v1.2 flat
   * `rowHeader?`/`rowHeaderSelect?`/`rowHeaderWidth?` fields. A malformed
   * `header` / an overlapping or out-of-bounds span throws `INVALID_OPTIONS`.
   */
  header?: HeaderConfig;
  /**
   * `CAP-MENU` (v1.4) — configures **both** context menus (the body-cell
   * `LAYER-CONTEXT-MENU` and the dedicated header/row/corner `LAYER-HEADER-MENU`)
   * with **one target-branched** `MenuBuilder` (switches on `ctx.target.kind`). A
   * `MenuBuilder` **replaces** the defaults; `'default'`/absent = the shipped
   * default builder (today's cell items + the header built-ins — no regression);
   * `false` = **no context menu**. An unknown built-in `command` in the returned
   * items → `INVALID_OPTIONS` at open time.
   */
  menu?: MenuBuilder | 'default' | false;
  /** Initial freeze pane (`ENTITY-FREEZE-PANE`); counts clamped to extents. */
  frozen?: { rows?: number; cols?: number };
  /** Minimum column width (px) enforced by `setColumnWidth`/drag-resize. Default 32. */
  minColumnWidth?: number;
  /**
   * Undo/redo history bound (`ENTITY-HISTORY.maxDepth`). `null`/absent =
   * unlimited (default); `N` keeps at most the last `N` commands.
   */
  historyMaxDepth?: number | null;
  /** Emit User-Timing perf marks (measurement-hooks contract). */
  perf?: boolean;
  /** Estimated default row height in px (until measured). */
  rowHeight?: number;
  /** Overscan rows/cols beyond the visible window. */
  overscan?: number;
  /**
   * `BIND-KEYS` remap — a partial override merged over the default key map
   * (arrows/Home/End/PageUp-Down/Tab/Escape). Absent = the defaults.
   */
  keyBindings?: Partial<KeyMap>;
  /** Text direction for `DOM-ROOT`. Alias of `direction` (kept for back-compat). */
  dir?: 'ltr' | 'rtl';
  /**
   * `LIB-LOCALE` — initial BCP-47 locale (`COMPONENT-I18N`). Drives `Intl`
   * number/currency/percent/date formatting (`CAP-FMT-VALUE` masks), plural
   * selection, and the auto text direction. Default `'en-US'`.
   */
  locale?: string;
  /**
   * `LIB-LOCALE` — initial text direction (`dir` on `DOM-ROOT`). Overrides the
   * locale-inferred default; takes precedence over `dir`.
   */
  direction?: 'ltr' | 'rtl';
  /**
   * `LIB-LOCALE` — an initial host message bundle merged over the English default
   * catalog (`COMPONENT-I18N` string externalization).
   */
  localeBundle?: MessageBundle;
  /** Theme applied as `mg-theme-{light|dark}` (`CAP-THEME`). */
  theme?: 'light' | 'dark';
  /**
   * Density preset (`CAP-THEME`/UX) — `comfortable` (default) or `compact`
   * (tighter `--mg-cell-padding` + a shorter default row height).
   */
  density?: 'comfortable' | 'compact';
  /**
   * `A11Y-GRID` — opt in to **edit-commit announcements** on the live region
   * (polite: "{column} set to {value}"). OFF by default: moving focus to the
   * committed cell already conveys its value, and announcing every commit is
   * chatty. Sort/filter/insert/delete/validation announcements are always on.
   */
  announceEdits?: boolean;
  /**
   * `SEC-CSP-COMPAT` — same-origin **module worker** URL for the data engine. A
   * strict-CSP host serves the worker from an allowed origin (no `blob:`); the
   * grid loads it via `new Worker(workerUrl, { type: 'module' })`. Ignored when
   * `createWorker`/`createTransport` is supplied. Absent = the in-process
   * transport (main thread) — the default, which needs no worker at all.
   */
  workerUrl?: string | URL;
  /**
   * Supply a real `Worker` to run the data engine off-thread. When omitted the
   * default in-process transport runs the engine on the main thread (the default
   * for jsdom/unit tests and non-worker environments).
   */
  createWorker?: () => WorkerLike;
  /**
   * Testing/advanced seam: supply the `DataTransport` directly (takes precedence
   * over `createWorker`). Lets tests drive a crashable/erroring transport to
   * exercise `WORKER_CRASHED`/`WORKER_OP_FAILED` routing.
   */
  createTransport?: () => DataTransport;
  /**
   * `DEP-XLSX` seam — override the lazy exceljs loader used by `exportXlsx`.
   * Defaults to a dynamic `import('exceljs')`. Unit tests inject a fake exceljs
   * (mapping-assertion stub) or a rejecting loader (`XLSX_UNAVAILABLE` fail-soft).
   */
  loadExcel?: () => Promise<unknown>;
}

export interface SetDataOptions {
  keyField?: string;
  onDuplicateKey?: OnDuplicateKey;
  preserveOnRebind?: boolean;
}

/** The live grid instance surface realized in Slice 1. */
export interface Grid {
  readonly options: GridOptions;
  /** `LIB-SET-DATA` — bind/rebind the dataset. */
  setData(
    rows: readonly RowData[],
    opts?: SetDataOptions,
  ): Promise<{ rowCount: number }>;
  /** `LIB-GET-ROWS` — window by ordered index, clamped to `[0, rowCount)`. */
  getRows(range: {
    startIndex: number;
    endIndex: number;
  }): Promise<{ startIndex: number; rows: Array<{ key: RowKey; data: RowData }> }>;
  /** `LIB-GET-COUNT`. */
  getRowCount(): Promise<{ rowCount: number; totalRowCount: number }>;
  /** `LIB-SCROLL` — scroll a row/col (or cell) into view. */
  scrollTo(target: { rowIndex?: number; colIndex?: number }): void;
  /**
   * `LIB-SORT` — apply a sort spec (worker rebuilds the ordered index). Empty
   * `entries` = unsorted (natural order). **Undoable** (`sort` command reverts to
   * the previous spec). Vetoable via `EVT-BEFORE-SORT`; fires `EVT-AFTER-SORT`.
   * Gated behind the `sorting` flag. Resolves `{ spec, rowCount }`.
   */
  sort(spec: SortSpec): Promise<{ spec: SortSpec; rowCount: number }>;
  /**
   * `LIB-FILTER` — apply a filter spec (worker rebuilds the ordered index). An
   * **empty** `perColumn` = no filter (all rows), never an error. **Not undoable**
   * (transient view state). Vetoable via `EVT-BEFORE-FILTER`; fires
   * `EVT-AFTER-FILTER`. Gated behind the `filtering` flag. Resolves
   * `{ spec, rowCount, totalRowCount }`.
   */
  filter(spec: FilterSpec): Promise<{ spec: FilterSpec; rowCount: number; totalRowCount: number }>;
  /** The current sort spec (`ENTITY-SORT-SPEC`). */
  getSortSpec(): SortSpec;
  /** The current filter spec (`ENTITY-FILTER`). */
  getFilterSpec(): FilterSpec;
  /**
   * `LIB-RESIZE` — set a column's width (px, clamped to `minColumnWidth`).
   * Undoable (`resize`); vetoable via `EVT-BEFORE-RESIZE`; fires `EVT-AFTER-RESIZE`.
   * Gated behind the `resize` flag.
   */
  setColumnWidth(columnId: ColumnId, width: number): void;
  /**
   * `LIB-REORDER` — move a column to `toIndex` (clamped), keeping its `id` stable.
   * Undoable (`reorder`); vetoable via `EVT-BEFORE-REORDER`; fires `EVT-AFTER-REORDER`.
   * Gated behind the `reorder` flag.
   */
  moveColumn(columnId: ColumnId, toIndex: number): void;
  /**
   * `LIB-FREEZE` — set the freeze pane (`ENTITY-FREEZE-PANE`); counts clamped to
   * extents (`INV-FREEZE-PREFIX`). Frozen top rows / left columns render pinned.
   * Undoable (`freeze`); vetoable via `EVT-BEFORE-FREEZE-CHANGE`; fires
   * `EVT-AFTER-FREEZE-CHANGE`. Gated behind the `freeze` flag.
   */
  setFrozen(o: { rows?: number; cols?: number }): void;
  /** The current freeze pane (`ENTITY-FREEZE-PANE`). */
  getFrozen(): FreezePane;
  /**
   * `LIB-MERGE` — merge a `Range` into one `ENTITY-MERGE-REGION` (anchor = top-left;
   * the anchor spans, covered cells are suppressed + non-editable). Throws
   * `MERGE_OVERLAP` on an overlap or a `<2`-cell range (`INV-MERGE-NONOVERLAP`/
   * `-MIN2`). Undoable (`merge`); vetoable/notify `EVT-*-MERGE-CHANGE`. Gated
   * behind the `merge` flag.
   */
  merge(range: Range): void;
  /** `LIB-MERGE` — dissolve the merge region intersecting `range`. Undoable. */
  unmerge(range: Range): void;
  /** The current merge regions (`ENTITY-MERGE-REGION` projections). */
  getMerges(): MergeRegion[];
  /**
   * `LIB-GROUP` — create an outline group over a row/column span
   * (`ENTITY-GROUP-NODE`); returns its `{ id }`. Throws `GROUP_OVERLAP` on a
   * partial same-axis overlap (`INV-GROUP-NEST`). Undoable; vetoable/notify
   * `EVT-*-GROUP-CHANGE`. Gated behind the `group` flag.
   */
  group(o: { axis: GroupAxis; start: number; span: number }): { id: string };
  /** `LIB-GROUP` — remove a group node by id (undoable). */
  ungroup(id: string): void;
  /**
   * `LIB-GROUP` — collapse/expand a group: a collapsed row (column) group hides
   * its spanned rows (columns) from the virtualization window. Undoable.
   */
  setCollapsed(id: string, collapsed: boolean): void;
  /** The current group nodes (`ENTITY-GROUP-NODE` projections). */
  getGroups(): GroupNode[];
  /** `LIB-SELECTION` — the current selection (`ENTITY-SELECTION` projection). */
  getSelection(): Selection;
  /**
   * `LIB-SELECTION` — replace the selection (ranges clamped to extents); fires
   * `EVT-SELECTION-CHANGE`.
   */
  setSelection(sel: Selection): void;
  /**
   * `LIB-SELECTION` *(v1.3)* — add a **disjoint** range to the set (Ctrl/Cmd+click
   * semantics); the added range becomes the active/primary range. With
   * `multiRangeSelect` off it degrades to a single-range replace
   * (`INV-SELECTION-WELLFORMED`). Fires `EVT-SELECTION-CHANGE`.
   */
  addRange(range: Range): void;
  /**
   * `LIB-SELECTION` *(v1.3)* — line-select a whole row (materializes a full-width
   * range, `INV-SELECTION-LINE`). `additive` (Ctrl/Cmd) adds it disjointly.
   */
  selectRow(index: number, opts?: { additive?: boolean }): void;
  /** `LIB-SELECTION` *(v1.3)* — line-select several rows (first replaces, rest add). */
  selectRows(indices: readonly number[]): void;
  /**
   * `LIB-SELECTION` *(v1.3)* — line-select a whole column (materializes a
   * full-height range, `INV-SELECTION-LINE`). `additive` (Ctrl/Cmd) adds it disjointly.
   */
  selectColumn(index: number, opts?: { additive?: boolean }): void;
  /** `LIB-SELECTION` *(v1.3)* — line-select several columns (first replaces, rest add). */
  selectColumns(indices: readonly number[]): void;
  /** `LIB-SELECTION` *(v1.3)* — select the whole sheet (corner select-all). */
  selectAll(): void;
  /** `LIB-SELECTION` *(v1.3)* — clear the whole selection set. */
  clearSelection(): void;
  /**
   * `LIB-COLUMN-MANAGE` *(v1.3)* — hide a column: excludes it from the visible
   * view + ordered-index projection (`INV-COLUMN-HIDDEN-EXCLUDED`) while retaining
   * its def + data (restore via `showColumn`). Sync, idempotent (hiding a hidden
   * column is a no-op); fires `EVT-COLUMN-HIDDEN`. Unknown `id` throws
   * `INVALID_COLUMN_DEF`. Gated behind the `columnManage` flag. `CAP-COLUMN-MANAGE`.
   */
  hideColumn(id: ColumnId): void;
  /** `LIB-COLUMN-MANAGE` *(v1.3)* — restore a hidden column (idempotent); fires `EVT-COLUMN-HIDDEN`. */
  showColumn(id: ColumnId): void;
  /**
   * `LIB-COLUMN-MANAGE` *(v1.3)* — pin a column to the leading edge (`'leading'`)
   * or unpin (`null`). Pinned columns reflow into a leading contiguous block that
   * joins the frozen leading prefix (`INV-COLUMN-PIN-LEADING`), RTL-aware. Sync,
   * idempotent; fires `EVT-COLUMN-PINNED`. Unknown `id` throws `INVALID_COLUMN_DEF`;
   * an `edge` other than `'leading'`/`null` throws `INVALID_OPTIONS`. `CAP-COLUMN-MANAGE`.
   */
  pinColumn(id: ColumnId, edge: 'leading' | null): void;
  /**
   * `LIB-COLUMN-MANAGE` *(v1.3)* — size a column to its widest **visible** content
   * (bounded measure — samples only rendered/visible cells, never scans the full
   * column). Sets the width + fires `EVT-COLUMN-AUTOFIT`; a hidden column is a
   * no-op. Undoable (`resize`). Gated behind the `autofit` flag. `CAP-COLUMN-MANAGE`.
   */
  autofitColumn(id: ColumnId): void;
  /** `LIB-COLUMN-MANAGE` *(v1.3)* — autofit every visible column (bounded); fires `EVT-COLUMN-AUTOFIT`. */
  autofitAllColumns(): void;
  /**
   * Subscribe to a grid event (`EVT-*`). Before-events deliver a vetoable
   * `BeforeEvent` (`preventDefault()`); after/notify events deliver a
   * `GridEvent`. Returns an unsubscribe.
   */
  on<K extends keyof GridBeforeEvents & string>(
    type: K,
    handler: (event: BeforeEvent<GridBeforeEvents[K]>) => void,
  ): Unsubscribe;
  on<K extends keyof GridAfterEvents & string>(
    type: K,
    handler: (event: GridEvent<GridAfterEvents[K]>) => void,
  ): Unsubscribe;
  /** Unsubscribe a handler previously passed to `on`. */
  off<K extends (keyof GridAfterEvents | keyof GridBeforeEvents) & string>(
    type: K,
    handler: (event: never) => void,
  ): void;
  /**
   * `LIB-UPDATE-CELL` — programmatic single-cell edit (same commit path as the
   * interactive editor). Resolves `{ rowKey, columnId, oldValue, newValue,
   * changeState }` and fires `EVT-AFTER-EDIT`; rejects with
   * `GridError{VALIDATION_FAILED}` on invalid input (+ `EVT-VALIDATION-ERROR`).
   */
  updateCell(rowKey: RowKey, columnId: ColumnId, value: unknown): Promise<EditResult>;
  /**
   * `LIB-FORMULA-GET` *(v1.5)* — the raw `=…` source of a formula cell, or
   * `undefined` when the cell is not a formula (or the `formula` flag is off).
   * `CAP-FORMULA`.
   */
  getCellFormula(rowKey: RowKey, columnId: ColumnId): string | undefined;
  /**
   * `LIB-FORMULA-RECALC` *(v1.5)* — force a full formula recalculation; resolves
   * `{ changed, cycles, elapsedMs }` and fires `EVT-AFTER-RECALC`. A no-op
   * (zeroed summary) when the `formula` flag is off. `CAP-FORMULA`.
   */
  recalculate(): Promise<{ changed: number; cycles: number; elapsedMs: number }>;
  /**
   * `LIB-CLIPBOARD` — serialize the current selection range to TSV and write it to
   * the system clipboard (read-only). Gated behind the `clipboard` flag.
   */
  copy(): Promise<void>;
  /**
   * `LIB-CLIPBOARD` — `copy()` then clear the (editable) source cells as one
   * undoable `Command`. Gated behind `clipboard` + `editing`.
   */
  cut(): Promise<void>;
  /**
   * `LIB-CLIPBOARD` — read `text/plain` from the clipboard, parse as TSV
   * (`SEC-PASTE-UNTRUSTED`: never `text/html`, never evaluated), and apply the
   * block anchored at the active cell (expanding the target range). Each cell runs
   * the edit/commit path (validation applies; invalid cells rejected); the whole
   * paste is one undoable `Command`. Vetoable via `EVT-BEFORE-PASTE`; fires
   * `EVT-AFTER-PASTE`. Resolves `{ targetRange }`.
   */
  paste(): Promise<{ targetRange: Range }>;
  /**
   * `LIB-CLIPBOARD` — pattern-fill the current selection's values across `range`
   * (the fill target, a superset of the source). One undoable `Command`. Gated
   * behind `clipboard` + `editing`.
   */
  fill(range: Range): Promise<void>;
  /** `LIB-EDIT-CONTROL` — open an editor on a rendered cell (`LAYER-EDITOR`). */
  beginEdit(cell: CellRef): void;
  /** `LIB-EDIT-CONTROL` — commit the open editor (resolves the `EditResult`). */
  commitEdit(): Promise<EditResult | undefined>;
  /** `LIB-EDIT-CONTROL` — cancel the open editor, discarding the draft. */
  cancelEdit(): void;
  /**
   * `LIB-INSERT-ROWS` — insert `rows` at `atIndex` (clamped `[0, rowCount]`).
   * Inserted rows are `changeState:'new'`; adjusts the selection; undoable
   * (`insertRows`); vetoable via `EVT-BEFORE-INSERT`; fires `EVT-AFTER-INSERT`.
   */
  insertRows(
    atIndex: number,
    rows: readonly RowData[],
  ): Promise<{ atIndex: number; count: number; rowCount: number }>;
  /**
   * `LIB-REMOVE-ROWS` — remove rows by key (empty array = no-op). Removed rows are
   * tombstoned `changeState:'removed'` (unless they were `'new'`, then dropped);
   * undoable (`removeRows`); vetoable via `EVT-BEFORE-DELETE`; fires `EVT-AFTER-DELETE`.
   */
  removeRows(rowKeys: readonly RowKey[]): Promise<{ removed: RowKey[]; rowCount: number }>;
  /**
   * `LIB-COLUMN-CRUD` — insert a blank column at `atIndex` (grid-minted id+field;
   * every row gets an empty value at the new field). Undoable (`insertCols`);
   * vetoable via `EVT-BEFORE-INSERT-COL`; fires `EVT-AFTER-INSERT-COL`.
   */
  insertColumn(atIndex: number): Promise<{ column: ColumnDef; atIndex: number }>;
  /**
   * `LIB-COLUMN-CRUD` — **destructively** remove a column: drops its `ColumnDef`
   * and deletes its field from every `row.data` (affected rows become `'dirty'`).
   * Undoable (`removeCols`); vetoable via `EVT-BEFORE-DELETE-COL`; fires
   * `EVT-AFTER-DELETE-COL`.
   */
  removeColumn(columnId: ColumnId): Promise<{ columnId: ColumnId; removedField: string }>;
  /**
   * `LIB-GET-CHANGES` — pending row changes bucketed by `changeState`
   * (`{ new, dirty, removed }` by key). Requires `keyField` for reliable diffing
   * (else best-effort, `severity:'warning'` on `EVT-ERROR`).
   */
  getChanges(): Promise<RowChanges>;
  /**
   * `LIB-SET-STYLE` — write the sparse cell-style overlay over a logical range
   * (`ENTITY-CELL-STYLE`, keyed by `(rowKey, columnId)`); merges per property.
   * Undoable (`style` command). Gated behind the `formatting` flag.
   */
  setStyle(range: Range, style: CellStyle): void;
  /** `LIB-SET-STYLE` — clear the overlay over a range (undoable). */
  clearStyle(range: Range): void;
  /**
   * `LIB-COND-FMT` — add a conditional-format rule (`ENTITY-CONDITIONAL-RULE`);
   * returns its `{ id }`. Undoable. Gated behind `conditionalFormatting`.
   */
  addConditionalRule(rule: ConditionalRuleInput): { id: string };
  /** `LIB-COND-FMT` — remove a conditional rule by id (undoable). */
  removeConditionalRule(id: string): void;
  /** `LIB-THEME` — switch theme (`mg-theme-{light|dark}`). Gated behind `theme`. */
  setTheme(theme: 'light' | 'dark'): void;
  /**
   * `LIB-LOCALE.setLocale` — swap the active locale (`COMPONENT-I18N`): re-locales
   * `Intl` number/currency/percent/date masks (`CAP-FMT-VALUE`) + plural selection,
   * merges an optional host message `bundle` over the English default (no bundle =
   * reset to English), and auto-updates the text direction from the locale.
   * Idempotent; gated behind the `i18n` flag.
   */
  setLocale(locale: string, bundle?: MessageBundle): void;
  /**
   * `LIB-LOCALE.setDirection` — set `dir` on `DOM-ROOT` (`'ltr'`/`'rtl'`). RTL fully
   * mirrors: column order, horizontal scroll, the frozen (leading) edge, default
   * cell alignment, and the resize/reorder/fill handles + menus. Idempotent; gated
   * behind the `i18n` flag.
   */
  setDirection(direction: 'ltr' | 'rtl'): void;
  /** `LIB-UNDO` — revert the last command (no-op when the stack is empty). */
  undo(): Promise<void>;
  /** `LIB-REDO` — re-apply the last undone command (no-op when empty). */
  redo(): Promise<void>;
  /**
   * `CAP-FEATURE-FLAGS` — is a capability enabled? A disabled feature registers
   * no affordance (`PATTERN-FEATURE-FLAGS`).
   */
  isFeatureEnabled(flag: FeatureFlag): boolean;
  /** Measurement-hooks: buffered perf marks (opt-in via `options.perf`). */
  getPerfMarks(): Array<{ name: string; startTime: number; duration: number }>;
  /**
   * `LIB-EXPORT.exportCsv` — serialize the current sorted/filtered view (or the
   * full dataset with `opts.allData`) to RFC-4180 CSV, applying
   * `SEC-EXPORT-FORMULA-GUARD` (default on; `opts.sanitizeFormulas:false` opts
   * out). Dependency-free. Resolves a `text/csv` `Blob`. Gated behind `export`.
   */
  exportCsv(opts?: ExportOptions): Promise<Blob>;
  /**
   * `LIB-EXPORT.exportXlsx` — styled `.xlsx` export via a **lazy-loaded** exceljs
   * (`DEP-XLSX`). If exceljs is absent/fails to import, rejects
   * `GridError{XLSX_UNAVAILABLE}` (+ `EVT-ERROR`) — CSV export is unaffected.
   * Maps value/type, `formatMask`→`numFmt`, resolved `CellStyle`→
   * font/fill/border/alignment, merges, freeze, and column widths. Serialization
   * failures reject `EXPORT_FAILED`. Gated behind `export`.
   */
  exportXlsx(opts?: ExportOptions): Promise<Blob>;
  /**
   * `LIB-STATE.serializeState` — snapshot the grid **layout** (column order +
   * widths, sort/filter, freeze, merges, groups, cell styles, conditional rules)
   * as a versioned `GridState` (NOT the row data). Gated behind `persistState`.
   */
  serializeState(): GridState;
  /**
   * `LIB-STATE.restoreState` — apply a previously serialized `GridState`. Accepts
   * the current + documented prior `version`s; an unknown future version emits an
   * `INVALID_OPTIONS` warning and best-effort applies recognized fields. Gated
   * behind `persistState`.
   */
  restoreState(state: GridState): void;
  /**
   * `A11Y-GRID` — announce `message` on the accessible live region without
   * moving focus (polite by default; `{ assertive: true }` for errors). The
   * grid announces its own ambient updates (sort/filter/insert/delete/validation)
   * automatically; this exposes the same channel to the host. Coalesced with the
   * grid's own announcements (final state wins within one scheduling window).
   */
  announce(message: string, opts?: { assertive?: boolean }): void;
  /**
   * `LIB-MENU` *(v1.4)* — open a context menu programmatically over `target` at
   * `position` (default: the target node). Invokes the configured (or default)
   * `MenuBuilder` with the derived `MenuContext`, resolves `builtinItems`/`command`
   * ids + drops flag-off built-ins, mounts the `role="menu"` overlay, and fires
   * `EVT-MENU-OPEN`. `menu:false` ⇒ a no-op; an unknown target ref → `INVALID_OPTIONS`.
   * `CAP-MENU`.
   */
  openMenu(target: MenuTarget, position?: { x: number; y: number }): void;
  /** `LIB-MENU` *(v1.4)* — close any open context menu (light-dismiss). `CAP-MENU`. */
  closeMenu(): void;
  /** `LIB-DESTROY` — unmount and release resources (idempotent). */
  destroy(): void;
}
