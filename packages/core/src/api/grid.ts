/**
 * `COMPONENT-API` — the public `Grid` facade. `createGrid` mounts the DOM, wires
 * the store, viewport, renderer, and data client over the selected transport,
 * and exposes the Slice-1 read-only surface: `LIB-CREATE`/`-DESTROY`,
 * `LIB-SET-DATA`, `LIB-GET-ROWS`, `LIB-GET-COUNT`, `LIB-SCROLL`, plus perf marks.
 */
import { GridError, routeError } from '../errors.js';
import { PerfRecorder } from '../perf/perf.js';
import { DataClient } from '../protocol/data-client.js';
import { EngineHost } from '../protocol/engine-host.js';
import { InProcessTransport, WorkerTransport } from '../protocol/transport.js';
import type { DataTransport, WorkerLike } from '../protocol/transport.js';
import { Announcer } from '../a11y/announcer.js';
import type { StructResult } from '../protocol/data-client.js';
import type { WireColumn, WireRow } from '../protocol/messages.js';
import { ReactiveStore } from '../store/store.js';
import { HeightIndex } from '../viewport/height-index.js';
import { Viewport } from '../viewport/viewport.js';
import { GridRenderer } from '../render/renderer.js';
import type { ChangeState, RowData, RowKey } from '../types.js';
import { EventBus } from './event-bus.js';
import type {
  GridAfterEvents,
  GridBeforeEvents,
  GridEventBus,
  ViewportRange,
} from './event-bus.js';
import { FeatureRegistry } from './features.js';
import type { FeatureFlag } from './features.js';
import { isFormulaSource } from '../formula/index.js';
import { InteractionController } from '../interaction/interaction.js';
import { ContextMenuController } from '../interaction/context-menu.js';
import type { MenuTargetResolution } from '../interaction/context-menu.js';
import {
  BUILTIN_COMMAND_IDS,
  COMMAND_FLAG,
  COMMAND_LABEL_KEY,
  defaultMenuBuilder,
  isBuiltinCommand,
} from '../interaction/menu.js';
import type { RenderMenuItem } from '../interaction/menu.js';
import { resolveKeyMap } from '../interaction/keymap.js';
import type { Selection } from '../selection/selection.js';
import { EditController } from '../editing/edit-session.js';
import type { RowChanges } from '../editing/edit-session.js';
import { ClipboardController } from '../clipboard/clipboard.js';
import type { Command } from '../editing/history.js';
import { getByPath, setByPath } from '../util/path.js';
import type {
  CellContext,
  CellRef,
  CellStyle,
  ColumnFilter,
  ColumnId,
  FilterSpec,
  FreezePane,
  GroupAxis,
  GroupNode,
  MenuBuilder,
  MenuContext,
  MenuItem,
  MenuTarget,
  MenuTargetKind,
  MergeRegion,
  Range,
  BuiltinCommandId,
  SortSpec,
} from '../types.js';
import type { ColumnDef, Grid, GridOptions, SetDataOptions } from './options.js';
import { HeaderController } from '../worksheet/header-controller.js';
import { ColumnManageController } from '../worksheet/column-manage.js';
import { resolveHeaderConfig } from '../worksheet/header-config.js';
import type { HeaderPlan } from '../worksheet/header-config.js';
import { MergeModel } from '../worksheet/merge.js';
import { GroupModel } from '../worksheet/group.js';
import { FilterMenuController } from '../worksheet/filter-menu.js';
import type { ColumnFilterState } from '../worksheet/filter-menu.js';
import {
  StyleCascade,
  applyResolvedStyle,
  appendDataBar,
  prependIcon,
} from '../format/style-cascade.js';
import { formatValue } from '../format/format-mask.js';
import { I18nController } from '../i18n/i18n.js';
import type { MessageBundle } from '../i18n/i18n.js';
import { ConditionalFormatEngine } from '../format/conditional.js';
import type { ConditionalRuleInput } from '../format/conditional.js';
import type { CellDecorInfo } from '../render/renderer.js';
import { ExportController } from '../export/export.js';
import type { ExportColumn, ExportOptions } from '../export/export.js';
import {
  GRID_STATE_VERSION,
  checkStateVersion,
} from '../state/state-serde.js';
import type { GridState } from '../state/state-serde.js';

const DEFAULT_ROW_HEIGHT = 28;
const DEFAULT_OVERSCAN = 4;
const DEFAULT_VIEWPORT_HEIGHT = 400;
const DEFAULT_VIEWPORT_WIDTH = 800;
const DEFAULT_COL_WIDTH = 100;

function validateOptions(options: GridOptions): void {
  if (options == null || typeof options !== 'object') {
    throw new GridError('INVALID_OPTIONS', 'createGrid requires an options object', {
      source: 'config',
    });
  }
  if (!Array.isArray(options.columns)) {
    throw new GridError('INVALID_OPTIONS', 'options.columns must be an array', {
      source: 'config',
    });
  }
  options.columns.forEach((col, index) => {
    if (!col || typeof col.id !== 'string' || typeof col.field !== 'string') {
      throw new GridError(
        'INVALID_COLUMN_DEF',
        `Column at index ${index} must have string id + field`,
        { source: 'config', context: { columnIndex: index } },
      );
    }
  });
}

/**
 * `ADR-WORKER-OPS` (v1.1) — instantiate the bundled MODULE WORKER as the sibling
 * `worker.js` chunk (`new Worker(new URL('./worker.js', import.meta.url), …)`).
 * Returns `null` when a real `Worker` is unavailable (Node/jsdom) or construction
 * throws (e.g. a bundler that didn't emit the chunk, or a CSP that blocks it), so
 * the caller falls back to the in-process transport.
 */
function createDefaultWorker(): WorkerLike | null {
  if (typeof Worker === 'undefined') return null;
  try {
    const url = new URL('./worker.js', import.meta.url);
    return new Worker(url, { type: 'module' }) as unknown as WorkerLike;
  } catch {
    return null;
  }
}

function createTransport(options: GridOptions): DataTransport {
  if (options.createTransport) {
    return options.createTransport();
  }
  if (options.createWorker) {
    return new WorkerTransport(options.createWorker());
  }
  // `SEC-CSP-COMPAT` — a strict-CSP host serves a same-origin ESM module worker
  // (no `blob:`); we load it via the standard `Worker` constructor (no eval, no
  // inline script). An explicit `workerUrl` override wins over the bundled default.
  if (options.workerUrl) {
    const worker = new Worker(options.workerUrl, { type: 'module' });
    return new WorkerTransport(worker as unknown as WorkerLike);
  }
  // `ADR-SORT-FILTER-SEAM` (v1.1) — the REAL `WorkerTransport` is now the DEFAULT:
  // when a real `Worker` exists (browser) the data engine runs off the main
  // thread, so built-in sort/filter never block rendering. Node/jsdom (unit tests)
  // have no `Worker` → fall back to the in-process transport on the main thread.
  const worker = createDefaultWorker();
  if (worker) return new WorkerTransport(worker);
  return new InProcessTransport(new EngineHost());
}

export function createGrid(container: HTMLElement, options: GridOptions): Grid {
  validateOptions(options);

  const perf = new PerfRecorder(options.perf ?? false);
  // Event bus (EVT-*) + feature-flag registry (PATTERN-FEATURE-FLAGS).
  const bus: GridEventBus = new EventBus<GridAfterEvents, GridBeforeEvents>();
  const features = new FeatureRegistry(options.features);
  const store = new ReactiveStore();

  // `COMPONENT-I18N` / `CAP-I18N` — string externalization + locale formats + RTL.
  // `t` is threaded into every UI surface (header/filter/context menu/validation);
  // the active locale drives `Intl` masks + plural selection; direction sets `dir`.
  const i18nEnabled = features.isEnabled('i18n');
  const i18n = new I18nController({
    ...(options.locale !== undefined ? { locale: options.locale } : {}),
    ...(options.direction ?? options.dir
      ? { direction: options.direction ?? options.dir }
      : {}),
    ...(options.localeBundle ? { bundle: options.localeBundle } : {}),
  });
  const t = i18n.t;
  /**
   * The non-negative inline scroll distance. In RTL the browser reports a negative
   * `scrollLeft`; the renderer positions with logical `inset-inline-start`, so it
   * needs the magnitude. Fed to `computeColWindow` + the renderer so virtualization
   * offsets, frozen counter-translation, and header tracking mirror correctly.
   */
  const inlineScroll = (): number =>
    i18n.getDirection() === 'rtl' ? -scrollLeft : scrollLeft;

  // The live, mutable column model (structural column CRUD splices this array in
  // place, so the interaction/edit controllers — which hold the reference — see
  // the change). Cloned from options so `grid.options.columns` stays the input.
  const columns: ColumnDef[] = options.columns.map((c) => ({ ...c }));
  store.setColumns(columns); // enforces INV-COLKEY-UNIQUE

  // EVT-STATE-CHANGE — the store's microtask-coalesced batched change (one
  // notification per tick) is surfaced as a single coalesced state-change event.
  store.subscribe(() => {
    bus.emit('stateChange', {});
  });

  const toWireColumns = (cols: readonly ColumnDef[]): WireColumn[] =>
    cols.map((c) => ({
      id: c.id,
      field: c.field,
      ...(c.type !== undefined ? { type: c.type } : {}),
    }));

  const density = options.density ?? 'comfortable';
  const rowHeight =
    options.rowHeight ?? (density === 'compact' ? 22 : DEFAULT_ROW_HEIGHT);
  const overscan = options.overscan ?? DEFAULT_OVERSCAN;
  const colWidths = columns.map((c) => c.width ?? DEFAULT_COL_WIDTH);

  const transport = createTransport(options);
  const client = new DataClient(transport, perf);

  // `ADR-SORT-FILTER-SEAM` — give the client the live columns (with their custom
  // comparators) + key field so it can detect a custom comparator/predicate and
  // route that op through the main thread while built-in sort/filter run in the
  // worker off the main thread. Read lazily so column CRUD stays reflected.
  client.setViewContext({
    columns: () =>
      columns.map((c) => ({
        id: c.id,
        field: c.field,
        ...(c.type !== undefined ? { type: c.type } : {}),
        ...(c.comparator ? { comparator: c.comparator } : {}),
      })),
    keyField: () => options.keyField ?? null,
  });

  // PATTERN-ERROR routing: runtime/async worker errors (data-op/export/adapter)
  // reject their op (DataClient) AND surface on EVT-ERROR; config errors surface
  // only by reject/throw. Never console-only. WORKER_CRASHED flows here too.
  client.onError((err) => {
    routeError(err, (routed) => bus.emit('error', { error: routed }));
  });
  const heightIndex = new HeightIndex(rowHeight);
  const viewport = new Viewport(heightIndex, colWidths);
  const renderer = new GridRenderer();

  let scrollTop = 0;
  let scrollLeft = 0;
  let destroyed = false;

  // `A11Y-GRID` — `aria-busy` on `DOM-ROOT` while an async data op (window fetch
  // / sort / filter / load) is pending. A depth counter keeps it set across
  // nested/overlapping ops and clears it only when the last one settles. The
  // placeholder→filled window arrival is conveyed by this attribute (not a
  // live-region announcement — a named exclusion).
  let busyDepth = 0;
  function beginBusy(): void {
    if (busyDepth++ === 0) renderer.setBusy(true);
  }
  function endBusy(): void {
    if (busyDepth > 0 && --busyDepth === 0) renderer.setBusy(false);
  }
  async function busy<T>(p: Promise<T>): Promise<T> {
    beginBusy();
    try {
      return await p;
    } finally {
      endBusy();
    }
  }

  // Last rendered window (for viewport-change diffing + `renderedRowRange`).
  let lastRowWindow = { firstRow: 0, lastRow: -1 };
  let lastViewport: ViewportRange | null = null;
  // RowKey for each rendered row index (feeds `LIB-SELECTION`'s active cell).
  // (P7 measured `.clear()`-reuse here but the bench showed `new Map` is faster for
  // these small window maps, so it was kept as-is — see refresh below.)
  let rowKeyByIndex = new Map<number, RowKey>();
  // Reverse map + per-key data for the rendered window (feeds `COMPONENT-EDIT`).
  let indexByKey = new Map<RowKey, number>();
  let rowDataByKey = new Map<RowKey, RowData>();
  // `true` while a `LAYER-EDITOR` is open (interaction defers to the editor).
  let editingActive = false;
  const editingEnabled = features.isEnabled('editing');
  const clipboardEnabled = features.isEnabled('clipboard');
  // `CAP-FORMULA` — main-thread formula mirror (cellKey → raw `=…` source) so the
  // editor seeds the FORMULA, not its computed value (`INV-FORMULA-DERIVED`). Kept
  // in sync in the applyEdit/paste host wrappers (both transports) + seeded on load.
  const formulaEnabled = features.isEnabled('formula');
  const formulaMirror = new Map<string, string>();
  const fKey = (rowKey: RowKey, field: string): string => `${String(rowKey)} ${field}`;
  const updateFormulaMirror = (rowKey: RowKey, field: string, value: unknown): void => {
    const k = fKey(rowKey, field);
    if (isFormulaSource(value)) formulaMirror.set(k, value);
    else formulaMirror.delete(k);
  };
  // `CAP-SELECT` — disjoint multi-range + header line-select (`CE-MULTI-RANGE-SELECT`).
  const multiRangeEnabled = features.isEnabled('multiRangeSelect');

  // ==========================================================================
  // Slice 18 — unified header region (`CAP-HEADER`, `DOM-HEADER`/`-ROWHEADER`/
  // `-CORNER`). N column-header bands + optional M row-header gutter columns +
  // corner, developer-populated with no imposed hierarchy. Each axis toggleable.
  // ==========================================================================
  const headerEnabled = features.isEnabled('header');
  const rowHeaderEnabled = features.isEnabled('rowHeader');
  const headerResizeEnabled = features.isEnabled('headerResize');
  // `CAP-MENU` (v1.4) — the dedicated header/row/corner menu surface toggle
  // (`LAYER-HEADER-MENU`): its own `headerMenu` flag + the `header.menu` sub-toggle
  // (default `true` when `header` is set). Content still comes from `GridOptions.menu`.
  const headerMenuEnabled =
    features.isEnabled('headerMenu') && headerEnabled && options.header?.menu !== false;
  // `CAP-MENU` (v1.4) — resolve `GridOptions.menu`: a custom `MenuBuilder` replaces
  // the default; `'default'`/absent = the shipped default builder; `false` = no menu.
  const menuDisabled = options.menu === false;
  const resolvedMenuBuilder: MenuBuilder =
    typeof options.menu === 'function' ? options.menu : defaultMenuBuilder;
  // Resize overrides (mutated by the band-height / row-header-width drag gestures).
  let bandHeightOverride: number[] | null = null;
  let gutterWidthOverride: number[] | null = null;

  /** Build the resolved header plan (validates → throws `INVALID_OPTIONS`). */
  function buildHeaderPlan(): HeaderPlan {
    const plan = resolveHeaderConfig(headerEnabled ? options.header : undefined, columns, {
      rowHeaderEnabled,
      headerResizeEnabled,
      defaultBandHeight: rowHeight,
    });
    if (bandHeightOverride) {
      for (let b = 0; b < plan.columns.heights.length; b++) {
        if (bandHeightOverride[b] != null) plan.columns.heights[b] = bandHeightOverride[b] as number;
      }
    }
    if (gutterWidthOverride && plan.rows) {
      plan.rows.widths = gutterWidthOverride.slice(0, plan.rows.bands);
      plan.rows.totalWidth = plan.rows.widths.reduce((a, w) => a + w, 0);
    }
    return plan;
  }

  // Validate the header config once at create (the `INVALID_OPTIONS` throw point).
  let headerPlan: HeaderPlan = buildHeaderPlan();

  // ==========================================================================
  // Slice 6a — worksheet: public sort/filter (`CAP-SORT`/`-FILTER`), column
  // resize/reorder (`CAP-RESIZE`/`-REORDER`), and freeze panes (`CAP-FREEZE`).
  // The engine already sorts/filters (`MSG-SORT`/`-FILTER`); this exposes them
  // publicly with header UI + the `LAYER-FILTER-MENU`. Each gated by its flag.
  // ==========================================================================
  const sortingEnabled = features.isEnabled('sorting');
  const filteringEnabled = features.isEnabled('filtering');
  const resizeEnabled = features.isEnabled('resize');
  const reorderEnabled = features.isEnabled('reorder');
  const freezeEnabled = features.isEnabled('freeze');
  // `CAP-COLUMN-MANAGE` (`LIB-COLUMN-MANAGE`) — hide/show + leading pin + autofit,
  // each independently toggleable (`columnManage` gates hide/show/pin; `autofit`
  // gates the autofit affordance).
  const columnManageEnabled = features.isEnabled('columnManage');
  const autofitEnabled = features.isEnabled('autofit');
  let columnManage: ColumnManageController;
  const minColumnWidth = options.minColumnWidth ?? 32;

  let sortSpec: SortSpec = { entries: [] };
  const filterPredicates = new Map<ColumnId, ColumnFilter>();
  const filterDescriptors = new Map<ColumnId, ColumnFilterState>();
  const frozen: FreezePane = { rows: 0, cols: 0 };

  // ==========================================================================
  // Slice 6b — cell merge (`CAP-MERGE`, `ENTITY-MERGE-REGION`) + row/column
  // grouping/outline (`CAP-GROUP`, `ENTITY-GROUP-NODE`). Each gated by its flag.
  // A collapsed row group hides its rows from the virtualization window (via a
  // zero-height mark in the `HeightIndex` + a render skip); a collapsed column
  // group closes its columns to zero width.
  // ==========================================================================
  const mergeEnabled = features.isEnabled('merge');
  const groupEnabled = features.isEnabled('group');
  const mergeModel = new MergeModel();
  const groupModel = new GroupModel();
  /** Rows currently marked zero-height in the `HeightIndex` (collapsed groups). */
  let appliedHiddenRows = new Set<number>();
  /** Cached hidden row/col index sets (recomputed when a group changes). */
  let hiddenRowsCache: ReadonlySet<number> = new Set();
  let hiddenColsCache: ReadonlySet<number> = new Set();
  /** Row visibility (collapse) changed → re-sync zero-height marks next refresh. */
  let rowVizDirty = false;

  /** `INV-FREEZE-PREFIX` at render time — clamp the frozen counts to live extents. */
  const frozenRowExtent = (): number => Math.min(frozen.rows, store.getCounts().rowCount);
  /** Count of `pinned:'leading'` columns (they reflow to the leading edge). */
  const pinnedColCount = (): number => columns.reduce((n, c) => (c.pinned === 'leading' ? n + 1 : n), 0);
  /**
   * `INV-FREEZE-PREFIX` + `INV-COLUMN-PIN-LEADING` at render time — the frozen
   * leading block is the union of the developer freeze prefix and the pinned block.
   * Both are leading prefixes (pinned columns reflow to positions `0..P-1`), so the
   * union is simply the longer prefix `max(freeze, pinned)`, clamped to the extent.
   */
  const frozenColExtent = (): number =>
    Math.min(columns.length, Math.max(Math.min(frozen.cols, columns.length), pinnedColCount()));

  /** Header sort-state map (columnId → direction + 1-based multi-sort precedence). */
  function sortStateMap(): Map<
    ColumnId,
    { direction: 'asc' | 'desc'; order: number; multi: boolean }
  > {
    const map = new Map<ColumnId, { direction: 'asc' | 'desc'; order: number; multi: boolean }>();
    sortSpec.entries.forEach((e, i) =>
      map.set(e.columnId, {
        direction: e.direction,
        order: i + 1,
        multi: sortSpec.entries.length > 1,
      }),
    );
    return map;
  }

  /** Re-render the header with current sort state, feature gates, filters + freeze. */
  function refreshHeader(): void {
    headerPlan = buildHeaderPlan();
    renderer.renderHeader(columns, viewport.getColOffsets(), {
      sortState: sortStateMap(),
      activeFilters: new Set(filterPredicates.keys()),
      features: {
        sorting: sortingEnabled,
        filtering: filteringEnabled,
        resize: resizeEnabled,
        reorder: reorderEnabled,
      },
      frozenColCount: frozenColExtent(),
      scrollLeft: inlineScroll(),
      plan: headerPlan.columns,
      tooltips: headerPlan.tooltips,
      headerResizeEnabled,
      cornerLabel: t('header.selectAll'),
      ...(headerPlan.rows ? { gutter: headerPlan.rows } : {}),
      ...(headerPlan.corner ? { corner: headerPlan.corner } : {}),
      ...(hiddenColsCache.size ? { hiddenCols: hiddenColsCache } : {}),
    });
  }

  /** `headerResize` — set a column-header band height (px) + re-render the header. */
  function setBandHeight(band: number, height: number): void {
    if (!bandHeightOverride) bandHeightOverride = headerPlan.columns.heights.slice();
    while (bandHeightOverride.length <= band) bandHeightOverride.push(rowHeight);
    bandHeightOverride[band] = Math.max(16, height);
    refreshHeader();
  }

  /** `headerResize` — set the row-header gutter width (px); shifts the body columns. */
  function setRowHeaderWidth(width: number): void {
    if (!headerPlan.rows) return;
    const bands = headerPlan.rows.bands;
    const widths = (gutterWidthOverride ?? headerPlan.rows.widths).slice(0, bands);
    const others = widths.slice(0, bands - 1).reduce((a, w) => a + w, 0);
    widths[bands - 1] = Math.max(16, width - others);
    gutterWidthOverride = widths;
    refreshHeader();
    void refresh();
  }

  /** Effective column widths: a column hidden by a collapsed group closes to 0. */
  function effectiveColWidths(): number[] {
    return columns.map((c, i) =>
      hiddenColsCache.has(i) ? 0 : c.width ?? DEFAULT_COL_WIDTH,
    );
  }

  /** Push the effective (collapse-aware) column widths into the viewport. */
  function syncColWidths(): void {
    viewport.setColWidths(effectiveColWidths());
  }

  // ==========================================================================
  // `CAP-COLUMN-MANAGE` — the hidden/pinned view-projection helpers. Hidden
  // columns fold into the same width-0 `hiddenCols` render path collapsed column
  // groups already use (`INV-COLUMN-HIDDEN-EXCLUDED`); pinned columns reflow to a
  // leading contiguous block (`INV-COLUMN-PIN-LEADING`) that joins the frozen
  // prefix via `frozenColExtent`.
  // ==========================================================================
  /** Column indices hidden via `ENTITY-COLUMN.hidden` (`CAP-COLUMN-MANAGE`). */
  function manageHiddenColIndices(): Set<number> {
    const s = new Set<number>();
    columns.forEach((c, i) => {
      if (c.hidden === true) s.add(i);
    });
    return s;
  }

  /** The full hidden-column set: collapsed-group columns ∪ `hidden` columns. */
  function computeHiddenCols(): ReadonlySet<number> {
    const group = groupModel.hiddenCols();
    const managed = manageHiddenColIndices();
    if (managed.size === 0) return group;
    const merged = new Set<number>(group);
    for (const i of managed) merged.add(i);
    return merged;
  }

  /**
   * `INV-COLUMN-PIN-LEADING` — stably partition the live column model so all
   * `pinned:'leading'` columns occupy the leading positions (in their existing
   * relative order), unpinned columns following. Mutates `columns` in place so the
   * interaction/edit/clipboard controllers (which hold the array reference) see it.
   */
  function reflowPinnedOrder(): void {
    const pinned = columns.filter((c) => c.pinned === 'leading');
    if (pinned.length === 0 || pinned.length === columns.length) return;
    const rest = columns.filter((c) => c.pinned !== 'leading');
    const next = [...pinned, ...rest];
    columns.length = 0;
    columns.push(...next);
  }

  /** Re-project the mutated hidden/pinned column model into viewport/store/renderer. */
  function reprojectColumns(): void {
    hiddenColsCache = computeHiddenCols();
    store.setColumns(columns);
    syncColWidths();
    refreshHeader();
    renderer.setAria(store.getCounts().rowCount, columns.length);
  }

  /** `LIB-COLUMN-MANAGE.hideColumn`/`showColumn` primitive — toggle + reproject. */
  function setColumnHidden(id: ColumnId, hidden: boolean): void {
    const col = columns.find((c) => c.id === id);
    if (!col) return;
    if (hidden) col.hidden = true;
    else delete col.hidden;
    reprojectColumns();
    void refresh();
  }

  /** `LIB-COLUMN-MANAGE.pinColumn` primitive — toggle pin + reflow leading block. */
  function setColumnPinned(id: ColumnId, pinned: 'leading' | null): void {
    const col = columns.find((c) => c.id === id);
    if (!col) return;
    if (pinned === 'leading') col.pinned = 'leading';
    else delete col.pinned;
    reflowPinnedOrder();
    reprojectColumns();
    void refresh();
  }

  /**
   * `LIB-COLUMN-MANAGE` autofit — the **bounded, VISIBLE-ONLY** measure. Delegates
   * to the renderer's `measureColumnContentWidth`, which samples only the live
   * (rendered/overscan) cells for the column — never a full-column scan over the
   * dataset (Performance). Returns `null` for an unknown/hidden column.
   */
  function measureColumnWidth(id: ColumnId): number | null {
    const idx = columns.findIndex((c) => c.id === id);
    if (idx < 0) return null;
    const col = columns[idx] as ColumnDef;
    if (col.hidden === true) return null;
    const headerText = col.header ?? String(id);
    return renderer.measureColumnContentWidth(idx, headerText);
  }

  // `CAP-COLUMN-MANAGE` — honor create-time `hidden`/`pinned` column defs before
  // the first paint: reflow the pinned leading block + seed the hidden-col set so
  // hidden columns render at width 0 from the outset (`INV-COLUMN-HIDDEN-EXCLUDED`/
  // `-PIN-LEADING`).
  reflowPinnedOrder();
  store.setColumns(columns); // keep the store order in sync with the pinned reflow
  hiddenColsCache = computeHiddenCols();
  syncColWidths();

  renderer.setTranslator(t);
  perf.measure('mg:mount', () => {
    renderer.mount(container, {
      dir: i18n.getDirection(),
      theme: options.theme ?? 'light',
      density,
      rowHeight,
    });
    refreshHeader();
    renderer.setAria(0, columns.length);
  });

  const viewportHeight = (): number =>
    container.clientHeight || DEFAULT_VIEWPORT_HEIGHT;
  const viewportWidth = (): number =>
    container.clientWidth || DEFAULT_VIEWPORT_WIDTH;

  // `COMPONENT-EDIT` — the edit-session controller (declared before the
  // interaction controller so its keyboard/pointer edit triggers can reach it).
  let editController: EditController;

  // `COMPONENT-INTERACTION` — keyboard + pointer + roving-focus/ARIA controller.
  const controller = new InteractionController({
    root: renderer.element as HTMLElement,
    scrollEl: renderer.scrollContainer as HTMLElement,
    renderer,
    bus,
    columns,
    keyMap: resolveKeyMap(options.keyBindings),
    getRowCount: () => store.getCounts().rowCount,
    getColCount: () => columns.length,
    pageRows: () => Math.max(1, Math.floor(viewportHeight() / rowHeight) - 1),
    resolveRowKey: (rowIndex) => rowKeyByIndex.get(rowIndex),
    renderedRowRange: () => lastRowWindow,
    ensureVisible,
    isEditing: () => editingActive,
    onBeginEdit: (row, col, initialText) =>
      editController.beginEditAt(row, col, initialText),
    onPointerCommit: () => {
      void editController.commitEdit().catch(() => {
        /* validation failure keeps the editor open (rejected) */
      });
    },
    multiRange: () => multiRangeEnabled,
  });

  editController = new EditController(
    {
      document: container.ownerDocument,
      bus,
      columns,
      t,
      isEditingEnabled: () => editingEnabled,
      isFormulaEnabled: () => formulaEnabled,
      applyEdit: (rowKey, field, value) => {
        const p = client.applyEdit(rowKey, field, value);
        // Sync the formula mirror only on success (a parse-failed edit rejects).
        if (formulaEnabled) void p.then(() => updateFormulaMirror(rowKey, field, value)).catch(() => {});
        return p;
      },
      applyPasteBatch: (anchor, cells) => {
        const p = client.pasteApply(anchor, cells);
        if (formulaEnabled) {
          void p
            .then(() => {
              for (const c of cells) updateFormulaMirror(c.rowKey, c.field, c.value);
            })
            .catch(() => {});
        }
        return p;
      },
      getCellValue: (rowKey, field) => {
        // `CAP-FORMULA` — an editor seeds the raw formula, not its computed value.
        if (formulaEnabled) {
          const f = formulaMirror.get(fKey(rowKey, field));
          if (f !== undefined) return f;
        }
        const data = rowDataByKey.get(rowKey);
        return data ? getByPath(data, field) : undefined;
      },
      getRowData: (rowKey) => rowDataByKey.get(rowKey),
      cellNodeAt: (row, col) => renderer.cellAt(row, col),
      resolveRowKey: (row) => rowKeyByIndex.get(row),
      resolveRowIndex: (rowKey) => indexByKey.get(rowKey),
      refresh: () => refresh(),
      setEditing: (active) => {
        editingActive = active;
      },
      focusCell: (row, col) => {
        renderer.cellAt(row, col)?.focus();
      },
      moveAfterCommit: (direction) =>
        controller.moveActive(
          direction === 'down' ? 'down' : direction === 'right' ? 'right' : 'left',
        ),
      mergeAnchorOf: (row, col) =>
        mergeEnabled ? mergeModel.anchorOf(row, col) : undefined,
    },
    options.historyMaxDepth ?? null,
  );

  // `COMPONENT-CLIPBOARD` — copy/cut/paste/fill (`LIB-CLIPBOARD`) + fill handle,
  // gated behind the `clipboard` flag. Writes route through `COMPONENT-EDIT`'s
  // batch-commit (validation + one undoable `Command`); paste parses TSV as PLAIN
  // TEXT (`SEC-PASTE-UNTRUSTED`).
  const clipboard = new ClipboardController({
    document: container.ownerDocument,
    bus,
    columns,
    root: renderer.element as HTMLElement,
    isEnabled: () => clipboardEnabled,
    isEditingEnabled: () => editingEnabled,
    isEditing: () => editingActive,
    rowCount: () => store.getCounts().rowCount,
    colCount: () => columns.length,
    // Copy/cut/fill + the fill handle operate on the PRIMARY (active) range under
    // a multi-range set (`CE-MULTI-RANGE-SELECT`).
    getSelectionRange: () => controller.getActiveRange(),
    getActiveIndex: () => controller.getActiveIndex(),
    getRowsWindow: async (top, bottomExclusive) => {
      const res = await client.getRows(top, bottomExclusive);
      return res.rows.map((r) => ({ key: r.key, data: r.data }));
    },
    commitBatch: (anchor, writes) => editController.applyBatch(anchor, writes),
    setSelectionRange: (range, active) =>
      controller.setSelection({
        ranges: [range],
        anchor: { row: active.row, col: active.col },
        activeCell: null,
      }),
    cellAt: (row, col) => renderer.cellAt(row, col),
  });
  // Keep the fill handle positioned after selection changes.
  bus.on('selectionChange', () => clipboard.afterRender());

  // ==========================================================================
  // Slice 5 — cell formatting (`COMPONENT-FORMAT`) + conditional formatting
  // (`COMPONENT-CONDFMT`) + theming. Each gated behind its feature flag.
  // ==========================================================================
  const formattingEnabled = features.isEnabled('formatting');
  const condEnabled = features.isEnabled('conditionalFormatting');
  const themeEnabled = features.isEnabled('theme');
  /** Highest data `version` for which conditional aggregates were (re)computed. */
  let lastAggVersion = -1;

  let cascade: StyleCascade | undefined;
  const condEngine: ConditionalFormatEngine | undefined = condEnabled
    ? new ConditionalFormatEngine(
        (columnId, kind, n) => client.aggregate(columnId, kind, n),
        () => {
          cascade?.invalidate();
          void refresh();
        },
      )
    : undefined;

  if (formattingEnabled || condEnabled) {
    cascade = new StyleCascade({
      columnDefaultStyle: formattingEnabled
        ? // P3 (PERF-CELL-PATH): O(1) via the store's `columnById` map (re-derived on
          // every column mutation), not an O(columns) `find` per cell on memo miss.
          (columnId) => store.getColumn(columnId)?.defaultStyle
        : () => undefined,
      ...(condEngine ? { evaluateConditional: (ctx) => condEngine.evaluate(ctx) } : {}),
    });

    // `PATTERN-STYLE-CASCADE` — the per-visible-cell paint hook: format the
    // display value (masks), run a custom renderer (DOM-only), resolve + apply
    // the cascade, then draw data bars / icons (all DOM nodes — `SEC-*`).
    renderer.setCellDecorator((cell, info) => decorateCell(cell, info));
  }

  function decorateCell(cell: HTMLElement, info: CellDecorInfo): void {
    const ctx: CellContext = {
      rowKey: info.rowKey,
      columnId: info.columnId,
      field: info.field,
      value: info.value,
      data: info.data,
      rowIndex: info.rowIndex,
      colIndex: info.colIndex,
    };
    // Content: a custom renderer (Node or string via textContent), else the
    // value-format mask (`CAP-FMT-VALUE`) when formatting is on, else raw text.
    const renderCell = info.column.renderer;
    if (renderCell) {
      const out = renderCell(ctx);
      if (typeof out === 'string') {
        cell.textContent = out; // SEC-RENDERER-DOM-ONLY: never innerHTML
      } else {
        cell.textContent = '';
        cell.appendChild(out);
      }
    } else if (formattingEnabled) {
      // `CAP-FMT-VALUE` masks resolve under the active locale (`COMPONENT-I18N`):
      // `setLocale` re-locales `Intl` number/currency/percent/date output.
      cell.textContent = formatValue(info.value, info.column.formatMask, ctx, i18n.getLocale());
    } else {
      cell.textContent = info.value == null ? '' : String(info.value);
    }

    const resolved = cascade!.resolve(ctx);
    applyResolvedStyle(cell, resolved);
    if (resolved.icon !== undefined) prependIcon(cell, resolved.icon);
    if (resolved.dataBar) appendDataBar(cell, resolved.dataBar);
  }

  /** Clamp a value into `[lo, hi]` (empty range → `lo`). */
  function clampIdx(v: number, lo: number, hi: number): number {
    if (hi < lo) return lo;
    return Math.max(lo, Math.min(v, hi));
  }

  /** Resolve a logical `Range` to the `(rowKey, columnId)` refs it covers. */
  async function resolveRangeRefs(range: Range): Promise<CellRef[]> {
    const { rowCount } = store.getCounts();
    const colCount = columns.length;
    if (rowCount === 0 || colCount === 0) return [];
    const top = clampIdx(Math.min(range.top, range.bottom), 0, rowCount - 1);
    const bottom = clampIdx(Math.max(range.top, range.bottom), 0, rowCount - 1);
    const left = clampIdx(Math.min(range.left, range.right), 0, colCount - 1);
    const right = clampIdx(Math.max(range.left, range.right), 0, colCount - 1);
    const res = await client.getRows(top, bottom + 1);
    const cols = columns.slice(left, right + 1);
    const refs: CellRef[] = [];
    for (const row of res.rows) {
      for (const col of cols) refs.push({ rowKey: row.key, columnId: col.id });
    }
    return refs;
  }

  async function setStyleImpl(range: Range, style: CellStyle): Promise<void> {
    if (!cascade) return;
    const refs = await resolveRangeRefs(range);
    if (refs.length === 0) return;
    const prior = refs.map((ref) => ({ ref, prev: cascade!.getOverlay(ref.rowKey, ref.columnId) }));
    const apply = (): void => {
      for (const { ref } of prior) cascade!.mergeStyle(ref.rowKey, ref.columnId, style);
    };
    const revert = (): void => {
      for (const { ref, prev } of prior) cascade!.setOverlay(ref.rowKey, ref.columnId, prev);
    };
    apply();
    await refresh();
    editController.history.push({
      kind: 'style',
      targetThread: 'main',
      apply: async () => {
        apply();
        await refresh();
      },
      revert: async () => {
        revert();
        await refresh();
      },
    });
    bus.emit('stateChange', {});
  }

  async function clearStyleImpl(range: Range): Promise<void> {
    if (!cascade) return;
    const refs = await resolveRangeRefs(range);
    const prior = refs
      .map((ref) => ({ ref, prev: cascade!.getOverlay(ref.rowKey, ref.columnId) }))
      .filter((p) => p.prev !== undefined);
    if (prior.length === 0) return;
    const apply = (): void => {
      for (const { ref } of prior) cascade!.clearOverlay(ref.rowKey, ref.columnId);
    };
    const revert = (): void => {
      for (const { ref, prev } of prior) cascade!.setOverlay(ref.rowKey, ref.columnId, prev);
    };
    apply();
    await refresh();
    editController.history.push({
      kind: 'style',
      targetThread: 'main',
      apply: async () => {
        apply();
        await refresh();
      },
      revert: async () => {
        revert();
        await refresh();
      },
    });
    bus.emit('stateChange', {});
  }

  function addConditionalRuleImpl(input: ConditionalRuleInput): { id: string } {
    const { id } = condEngine!.add(input);
    const snapshot = { ...condEngine!.getRules().find((r) => r.id === id)! };
    cascade!.invalidate();
    void condEngine!
      .prime()
      .then(() => {
        lastAggVersion = client.version;
        cascade!.invalidate();
        return refresh();
      })
      .catch(() => {
        /* aggregate fetch failure routes via client.onError → EVT-ERROR */
      });
    void refresh();
    editController.history.push({
      kind: 'conditionalRule',
      targetThread: 'main',
      apply: async () => {
        condEngine!.add(snapshot);
        cascade!.invalidate();
        await condEngine!.prime();
        await refresh();
      },
      revert: async () => {
        condEngine!.remove(id);
        cascade!.invalidate();
        await refresh();
      },
    });
    bus.emit('stateChange', {});
    return { id };
  }

  function removeConditionalRuleImpl(id: string): void {
    const rule = condEngine!.getRules().find((r) => r.id === id);
    if (!rule) return;
    const snapshot = { ...rule };
    condEngine!.remove(id);
    cascade!.invalidate();
    void refresh();
    editController.history.push({
      kind: 'conditionalRule',
      targetThread: 'main',
      apply: async () => {
        condEngine!.remove(id);
        cascade!.invalidate();
        await refresh();
      },
      revert: async () => {
        condEngine!.add(snapshot);
        cascade!.invalidate();
        await condEngine!.prime();
        await refresh();
      },
    });
    bus.emit('stateChange', {});
  }

  /**
   * `CAP-GROUP` — re-sync the collapsed-row zero-height marks in the `HeightIndex`
   * (only when a group change or structural shift dirtied them). A collapsed
   * row-axis group's rows get height 0, so the scroll geometry closes them up and
   * the renderer skips them (`hiddenRowsCache`).
   */
  function syncRowVisibility(rowCount: number): void {
    if (!groupEnabled || !rowVizDirty) return;
    const desired = groupModel.hiddenRows();
    for (const r of appliedHiddenRows) heightIndex.setMeasured(r, rowHeight);
    const next = new Set<number>();
    for (const r of desired) {
      if (r < rowCount) {
        heightIndex.setMeasured(r, 0);
        next.add(r);
      }
    }
    appliedHiddenRows = next;
    hiddenRowsCache = desired;
    hiddenColsCache = computeHiddenCols();
    syncColWidths();
    rowVizDirty = false;
  }

  async function refresh(opts?: {
    scrollOnly?: boolean;
    // P9 (PERF-FRAME-STEADY): a scroll-only refresh reuses the window `onScroll`
    // already computed for the sync `EVT-SCROLL` payload, instead of recomputing it.
    rowWindow?: ReturnType<typeof viewport.computeRowWindow>;
    colWindow?: ReturnType<typeof viewport.computeColWindow>;
  }): Promise<void> {
    if (destroyed) return;
    const { rowCount } = store.getCounts();
    heightIndex.setCount(rowCount);
    syncRowVisibility(rowCount);
    renderer.setAria(rowCount, columns.length);

    const rowWindow =
      opts?.rowWindow ??
      viewport.computeRowWindow(scrollTop, viewportHeight(), overscan, rowCount);
    const colWindow =
      opts?.colWindow ?? viewport.computeColWindow(inlineScroll(), viewportWidth(), overscan);

    let rows: DataClientRows = [];
    let startIndex = 0;
    if (rowWindow.lastRow >= rowWindow.firstRow) {
      const res = await busy(
        perf.measureAsync(
          'mg:window-query',
          client.getRows(rowWindow.firstRow, rowWindow.lastRow + 1),
        ),
      );
      rows = res.rows;
      startIndex = res.startIndex;
    }

    // `CAP-FREEZE` — the frozen top rows are pinned regardless of the scroll
    // window, so fetch their data off-window and hand it to the renderer.
    const fRowCount = frozenRowExtent();
    const fColCount = frozenColExtent();
    let frozenRows: DataClientRows = [];
    if (fRowCount > 0) {
      const fr = await busy(client.getRows(0, fRowCount));
      frozenRows = fr.rows;
    }
    if (destroyed) return;
    // P7 (PERF-FRAME-STEADY): resolve the merge list once (was called twice — for the
    // `.length` guard and the value — allocating the mapped array twice per frame).
    const mergeList = mergeEnabled ? mergeModel.list() : [];
    renderer.renderWindow({
      rowWindow,
      colWindow,
      rows,
      startIndex,
      columns,
      heightIndex,
      colOffsets: viewport.getColOffsets(),
      editingEnabled,
      frozenRowCount: fRowCount,
      frozenColCount: fColCount,
      scrollTop,
      scrollLeft: inlineScroll(),
      frozenRows,
      // `PERF-SCROLL` — a scroll-only refresh may reuse already-painted rows (keyed
      // dirty-diff); any content/layout-changing refresh repaints the full window.
      reuse: opts?.scrollOnly === true,
      ...(mergeList.length ? { merges: mergeList } : {}),
      ...(headerPlan.rows ? { gutter: headerPlan.rows } : {}),
      ...(hiddenRowsCache.size ? { hiddenRows: hiddenRowsCache } : {}),
      ...(hiddenColsCache.size ? { hiddenCols: hiddenColsCache } : {}),
    });
    renderer.positionHeader(viewport.getColOffsets(), inlineScroll(), fColCount);
    renderGroupOutline();

    // Refresh the index↔key + key→data maps for the rendered window
    // (`LIB-SELECTION` active cell; `COMPONENT-EDIT` seed/veto/validation).
    rowKeyByIndex = new Map<number, RowKey>();
    indexByKey = new Map<RowKey, number>();
    rowDataByKey = new Map<RowKey, RowData>();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      rowKeyByIndex.set(startIndex + i, row.key);
      indexByKey.set(row.key, startIndex + i);
      rowDataByKey.set(row.key, row.data);
    }
    lastRowWindow = rowWindow;

    // `COMPONENT-INTERACTION` repaints selection state on the new cells.
    controller.afterRender();
    // `COMPONENT-CLIPBOARD` re-anchors the fill handle to the new cells.
    clipboard.afterRender();

    // `EVT-VIEWPORT-CHANGE` — emit when the visible logical window changed.
    const vp: ViewportRange = {
      firstRow: rowWindow.firstRow,
      lastRow: rowWindow.lastRow,
      firstCol: colWindow.firstCol,
      lastCol: colWindow.lastCol,
    };
    if (
      !lastViewport ||
      lastViewport.firstRow !== vp.firstRow ||
      lastViewport.lastRow !== vp.lastRow ||
      lastViewport.firstCol !== vp.firstCol ||
      lastViewport.lastCol !== vp.lastCol
    ) {
      lastViewport = vp;
      bus.emit('viewportChange', vp);
    }

    // Conditional-format aggregates are full-dataset (`ADR-CONDFMT-AGG`): when the
    // worker index `version` advanced (edit/insert/remove/rebind), drop + refetch
    // them, then invalidate the cascade + repaint. Guarded so scroll-only refreshes
    // (version unchanged) never refetch, and the re-entrant refresh terminates.
    if (condEngine && condEngine.hasRules() && client.version !== lastAggVersion) {
      lastAggVersion = client.version;
      void condEngine.onDataChanged().catch(() => {
        /* aggregate refetch failure routes via client.onError → EVT-ERROR */
      });
    }
  }

  /** `LIB-SCROLL` internals — scroll a cell into view then await the render. */
  async function ensureVisible(rowIndex: number, colIndex: number): Promise<void> {
    const top = heightIndex.offsetOf(rowIndex);
    const bottom = top + heightIndex.height(rowIndex);
    const vh = viewportHeight();
    if (top < scrollTop) scrollTop = top;
    else if (bottom > scrollTop + vh) scrollTop = bottom - vh;

    // Work in the non-negative inline axis (content coords), then convert to the
    // raw `scrollLeft` (negative in RTL) so a column scrolls into view in both dirs.
    const colOffsets = viewport.getColOffsets();
    const colInlineStart = colOffsets[colIndex] ?? 0;
    const colInlineEnd = colOffsets[colIndex + 1] ?? colInlineStart;
    const vw = viewportWidth();
    let inline = inlineScroll();
    if (colInlineStart < inline) inline = colInlineStart;
    else if (colInlineEnd > inline + vw) inline = colInlineEnd - vw;
    scrollLeft = i18n.getDirection() === 'rtl' ? -inline : inline;

    renderer.setScroll(scrollTop, scrollLeft);
    await refresh();
  }

  renderer.onScroll((top, left) => {
    scrollTop = top;
    scrollLeft = left;
    // Track the header horizontally with the body immediately (frozen columns
    // stay pinned); the async `refresh` repaints the window right after.
    renderer.positionHeader(viewport.getColOffsets(), inlineScroll(), frozenColExtent());
    // `EVT-SCROLL` — raw per-scroll notification of the (synchronously computed)
    // visible window; `EVT-VIEWPORT-CHANGE` follows from `refresh` on a real change.
    const { rowCount } = store.getCounts();
    const rowWindow = viewport.computeRowWindow(top, viewportHeight(), overscan, rowCount);
    const inlineLeft = i18n.getDirection() === 'rtl' ? -left : left;
    const colWindow = viewport.computeColWindow(inlineLeft, viewportWidth(), overscan);
    bus.emit('scroll', {
      firstRow: rowWindow.firstRow,
      lastRow: rowWindow.lastRow,
      firstCol: colWindow.firstCol,
      lastCol: colWindow.lastCol,
    });
    // `PERF-SCROLL` — a pure scroll changes no cell content, so the renderer may
    // retain still-visible rows and repaint only the newly-entered ones (dirty-diff).
    // P9: reuse the windows just computed (no second compute inside `refresh`).
    void refresh({ scrollOnly: true, rowWindow, colWindow });
  });

  // ==========================================================================
  // Structural CRUD (`LIB-INSERT-ROWS`/`-REMOVE-ROWS`/`-COLUMN-CRUD`) — each op
  // routes through the engine (`MSG-INSERT`/`-REMOVE`/`-INSERT-COL`/`-REMOVE-COL`)
  // via the `DataClient`, transitions `changeState` on the shared `ChangeTracker`
  // (`INV-ROWSTATE`), re-clamps the selection (`INV-RANGE-BOUNDS`), and pushes an
  // undoable `Command` onto 4a's `History` stack. Vetoable via `EVT-BEFORE-*`.
  // ==========================================================================
  let structSeq = 0;
  const keyFieldOf = (): string | null => options.keyField ?? null;
  const tracker = editController.changeTracker;

  const mintRowKey = (): RowKey => `mgrow${++structSeq}`;
  function mintColumn(): ColumnDef {
    let token: string;
    do {
      token = `mgcol${++structSeq}`;
    } while (columns.some((c) => c.id === token || c.field === token));
    return { id: token, field: token, header: t('column.defaultHeader'), width: DEFAULT_COL_WIDTH, type: 'text', editable: true };
  }
  function blankRow(): RowData {
    const kf = keyFieldOf();
    return kf ? { [kf]: mintRowKey() } : {};
  }
  /** Mint a `RowKey` for each row (blank rows get a fresh key at `keyField`). */
  function toWireRows(rows: readonly RowData[]): WireRow[] {
    const kf = keyFieldOf();
    return rows.map((data) => {
      let key: RowKey;
      if (kf) {
        const v = getByPath(data, kf);
        if (v === undefined || v === null) {
          key = mintRowKey();
          setByPath(data, kf, key);
        } else {
          key = v as RowKey;
        }
      } else {
        key = mintRowKey();
      }
      return { key, data };
    });
  }
  const applyStructCounts = (res: StructResult): void => {
    store.setCounts(res.rowCount, res.totalRowCount);
  };

  // --- Structural adjustment of merges/groups/freeze (Domain rules) ----------
  // A row/column insert/delete shifts (and, when the op lands inside, expands or
  // shrinks/dissolves) every merge region + group span, and increments/decrements
  // the freeze prefix — then re-clamps to the live extents (`INV-*` stay valid).
  function clampFreezeToExtents(): void {
    frozen.rows = clampIdx(frozen.rows, 0, store.getCounts().rowCount);
    frozen.cols = clampIdx(frozen.cols, 0, columns.length);
  }
  function structRowInsert(at: number, count: number): void {
    if (mergeEnabled) mergeModel.adjustRowInsert(at, count);
    if (groupEnabled) {
      groupModel.adjustRowInsert(at, count);
      rowVizDirty = true;
    }
    if (at < frozen.rows) frozen.rows += count;
    clampFreezeToExtents();
  }
  function structRowDelete(indices: readonly number[]): void {
    if (mergeEnabled) mergeModel.adjustRowDelete(indices);
    if (groupEnabled) {
      groupModel.adjustRowDelete(indices);
      rowVizDirty = true;
    }
    frozen.rows -= indices.filter((i) => i < frozen.rows).length;
    clampFreezeToExtents();
  }
  function structColInsert(at: number): void {
    if (mergeEnabled) mergeModel.adjustColInsert(at, 1);
    if (groupEnabled) {
      groupModel.adjustColInsert(at, 1);
      rowVizDirty = true;
    }
    if (at < frozen.cols) frozen.cols += 1;
    clampFreezeToExtents();
  }
  function structColDelete(colIndex: number): void {
    if (mergeEnabled) mergeModel.adjustColDelete([colIndex]);
    if (groupEnabled) {
      groupModel.adjustColDelete([colIndex]);
      rowVizDirty = true;
    }
    if (colIndex < frozen.cols) frozen.cols -= 1;
    clampFreezeToExtents();
  }
  // Snapshot/restore the merge + group models so a structural undo restores them
  // exactly (the forward adjust is re-applied on redo from the restored state).
  function cloneMerges(): MergeRegion[] {
    return mergeModel.list().map((m) => ({ range: { ...m.range }, anchor: { ...m.anchor } }));
  }
  function restoreMerges(list: readonly MergeRegion[]): void {
    mergeModel.clear();
    for (const m of list) mergeModel.addRegion(m);
  }
  function cloneGroups(): GroupNode[] {
    return groupModel.list().map((n) => ({ ...n }));
  }
  function restoreGroups(list: readonly GroupNode[]): void {
    groupModel.clear();
    for (const n of list) groupModel.addNode(n);
    rowVizDirty = true;
  }
  function restoreStructures(
    merges: readonly MergeRegion[],
    groups: readonly GroupNode[],
    freeze: FreezePane,
  ): void {
    if (mergeEnabled) restoreMerges(merges);
    if (groupEnabled) restoreGroups(groups);
    frozen.rows = freeze.rows;
    frozen.cols = freeze.cols;
    clampFreezeToExtents();
  }
  /** Re-project the mutated column model into the viewport/store/renderer/ARIA. */
  function onColumnsChanged(): void {
    syncColWidths();
    store.setColumns(columns); // re-derives columnById + re-checks INV-COLKEY-UNIQUE
    refreshHeader();
    renderer.setAria(store.getCounts().rowCount, columns.length);
  }

  async function insertRowsImpl(
    atIndex: number,
    rows: readonly RowData[],
  ): Promise<{ atIndex: number; count: number; rowCount: number }> {
    const wireRows = toWireRows(rows);
    const count = wireRows.length;
    if (count === 0) return { atIndex, count: 0, rowCount: store.getCounts().rowCount };
    if (bus.emitVetoable('beforeInsert', { atIndex, count })) {
      return { atIndex, count: 0, rowCount: store.getCounts().rowCount };
    }
    let landedAt = atIndex;
    const mergesBefore = cloneMerges();
    const groupsBefore = cloneGroups();
    const freezeBefore: FreezePane = { ...frozen };
    const doInsert = async (): Promise<void> => {
      const res = await client.insertRows(landedAt, wireRows);
      landedAt = res.atIndex ?? landedAt;
      for (const r of wireRows) tracker.set(r.key, 'new');
      applyStructCounts(res);
      controller.adjustForRowInsert(landedAt, count);
      structRowInsert(landedAt, count);
      await refresh();
      controller.afterStructuralChange();
    };
    const undoInsert = async (): Promise<void> => {
      const res = await client.removeRows(wireRows.map((r) => r.key));
      for (const r of wireRows) tracker.delete(r.key); // inserted rows were 'new' → dropped
      applyStructCounts(res);
      controller.adjustForRowDelete(res.removed?.map((e) => e.index) ?? []);
      restoreStructures(mergesBefore, groupsBefore, freezeBefore);
      await refresh();
      controller.afterStructuralChange();
    };
    await doInsert();
    pushCommand('insertRows', doInsert, undoInsert);
    bus.emit('afterInsert', { atIndex: landedAt, count });
    return { atIndex: landedAt, count, rowCount: store.getCounts().rowCount };
  }

  async function removeRowsImpl(
    rowKeys: readonly RowKey[],
  ): Promise<{ removed: RowKey[]; rowCount: number }> {
    if (rowKeys.length === 0) return { removed: [], rowCount: store.getCounts().rowCount };
    if (bus.emitVetoable('beforeDelete', { rowKeys: [...rowKeys] })) {
      return { removed: [], rowCount: store.getCounts().rowCount };
    }
    const firstRes = await client.removeRows(rowKeys);
    const removedEntries = firstRes.removed ?? [];
    if (removedEntries.length === 0) return { removed: [], rowCount: store.getCounts().rowCount };
    // Snapshot prior states BEFORE the transition (for undo restore).
    const snapshot = removedEntries.map((e) => ({
      index: e.index,
      row: e.row as WireRow,
      priorState: tracker.get(e.row.key) as ChangeState,
    }));
    const applyTransition = (): void => {
      for (const s of snapshot) {
        if (s.priorState === 'new') tracker.delete(s.row.key); // new → removed drops the row
        else tracker.set(s.row.key, 'removed'); // tombstone for the diff
      }
    };
    const delIndices = snapshot.map((s) => s.index);
    const mergesBefore = cloneMerges();
    const groupsBefore = cloneGroups();
    const freezeBefore: FreezePane = { ...frozen };
    applyTransition();
    applyStructCounts(firstRes);
    controller.adjustForRowDelete(delIndices);
    structRowDelete(delIndices);
    await refresh();
    controller.afterStructuralChange();

    const undoRemove = async (): Promise<void> => {
      const asc = [...snapshot].sort((a, b) => a.index - b.index);
      let last: StructResult | undefined;
      for (const s of asc) {
        last = await client.insertRows(s.index, [s.row]);
        if (s.priorState === 'clean') tracker.delete(s.row.key);
        else tracker.set(s.row.key, s.priorState);
      }
      if (last) applyStructCounts(last);
      controller.adjustForRowInsert(asc[0]?.index ?? 0, asc.length);
      restoreStructures(mergesBefore, groupsBefore, freezeBefore);
      await refresh();
      controller.afterStructuralChange();
    };
    const redoRemove = async (): Promise<void> => {
      const res = await client.removeRows(snapshot.map((s) => s.row.key));
      applyTransition();
      applyStructCounts(res);
      controller.adjustForRowDelete(delIndices);
      structRowDelete(delIndices);
      await refresh();
      controller.afterStructuralChange();
    };
    pushCommand('removeRows', redoRemove, undoRemove);
    bus.emit('afterDelete', { rowKeys: snapshot.map((s) => s.row.key) });
    return { removed: snapshot.map((s) => s.row.key), rowCount: store.getCounts().rowCount };
  }

  async function insertColumnImpl(
    atIndex: number,
  ): Promise<{ column: ColumnDef; atIndex: number }> {
    const at = Math.max(0, Math.min(atIndex, columns.length));
    const column = mintColumn();
    if (bus.emitVetoable('beforeInsertCol', { atIndex: at })) return { column, atIndex: at };
    const wire = toWireColumns([column])[0]!;
    const mergesBefore = cloneMerges();
    const groupsBefore = cloneGroups();
    const freezeBefore: FreezePane = { ...frozen };
    const doInsert = async (): Promise<void> => {
      const res = await client.insertColumn(at, wire);
      columns.splice(at, 0, column);
      structColInsert(at);
      onColumnsChanged();
      controller.adjustForColInsert(at);
      applyStructCounts(res);
      await refresh();
      controller.afterStructuralChange();
    };
    const undoInsert = async (): Promise<void> => {
      const res = await client.removeColumn(column.id, column.field);
      const idx = columns.findIndex((c) => c.id === column.id);
      if (idx >= 0) columns.splice(idx, 1);
      restoreStructures(mergesBefore, groupsBefore, freezeBefore);
      onColumnsChanged();
      controller.adjustForColDelete(idx >= 0 ? idx : at);
      applyStructCounts(res);
      await refresh();
      controller.afterStructuralChange();
    };
    await doInsert();
    pushCommand('insertCols', doInsert, undoInsert);
    bus.emit('afterInsertCol', { atIndex: at });
    return { column, atIndex: at };
  }

  async function removeColumnImpl(
    columnId: ColumnId,
  ): Promise<{ columnId: ColumnId; removedField: string }> {
    const colIndex = columns.findIndex((c) => c.id === columnId);
    if (colIndex < 0) return { columnId, removedField: '' };
    const col = columns[colIndex]!;
    const field = col.field;
    if (bus.emitVetoable('beforeDeleteCol', { columnId })) return { columnId, removedField: field };

    const firstRes = await client.removeColumn(columnId, field);
    const removedValues = firstRes.removedValues ?? [];
    const priorStates = removedValues.map((v) => ({
      rowKey: v.rowKey,
      priorState: tracker.get(v.rowKey) as ChangeState,
    }));
    const dirtyTransition = (): void => {
      for (const p of priorStates) {
        if (p.priorState === 'clean' || p.priorState === 'dirty') tracker.set(p.rowKey, 'dirty');
        // 'new' rows stay 'new'; 'removed' stays removed.
      }
    };
    const mergesBefore = cloneMerges();
    const groupsBefore = cloneGroups();
    const freezeBefore: FreezePane = { ...frozen };
    dirtyTransition();
    columns.splice(colIndex, 1);
    structColDelete(colIndex);
    onColumnsChanged();
    controller.adjustForColDelete(colIndex);
    applyStructCounts(firstRes);
    await refresh();
    controller.afterStructuralChange();

    const undoRemove = async (): Promise<void> => {
      const res = await client.insertColumn(colIndex, toWireColumns([col])[0]!, removedValues);
      columns.splice(colIndex, 0, col);
      restoreStructures(mergesBefore, groupsBefore, freezeBefore);
      onColumnsChanged();
      controller.adjustForColInsert(colIndex);
      for (const p of priorStates) {
        if (p.priorState === 'clean') tracker.delete(p.rowKey);
        else tracker.set(p.rowKey, p.priorState);
      }
      applyStructCounts(res);
      await refresh();
      controller.afterStructuralChange();
    };
    const redoRemove = async (): Promise<void> => {
      const res = await client.removeColumn(columnId, field);
      const idx = columns.findIndex((c) => c.id === columnId);
      if (idx >= 0) columns.splice(idx, 1);
      structColDelete(idx >= 0 ? idx : colIndex);
      onColumnsChanged();
      controller.adjustForColDelete(idx >= 0 ? idx : colIndex);
      dirtyTransition();
      applyStructCounts(res);
      await refresh();
      controller.afterStructuralChange();
    };
    pushCommand('removeCols', redoRemove, undoRemove);
    bus.emit('afterDeleteCol', { columnId });
    return { columnId, removedField: firstRes.removedField ?? field };
  }

  async function getChangesImpl(): Promise<RowChanges> {
    const changes = tracker.getChanges();
    if (!keyFieldOf()) {
      // Best-effort without a key (positional identity is unstable) — surface a
      // warning on `EVT-ERROR` but still return the tracked changes.
      routeError(
        new GridError(
          'WORKER_OP_FAILED',
          'getChanges() is best-effort without a keyField',
          { source: 'data-op', severity: 'warning' },
        ),
        (routed) => bus.emit('error', { error: routed }),
      );
    }
    return changes;
  }

  function pushCommand(
    kind: Command['kind'],
    apply: () => Promise<void>,
    revert: () => Promise<void>,
  ): void {
    editController.history.push({ kind, targetThread: 'worker', apply, revert });
  }

  // ==========================================================================
  // `CAP-SORT` — public sort (`LIB-SORT`). Worker rebuilds the ordered index
  // (`MSG-SORT`); undoable (revert to the previous `SortSpec`, Excel parity).
  // ==========================================================================
  async function applySort(target: SortSpec): Promise<void> {
    const res = await busy(client.sort(target));
    sortSpec = target;
    store.setCounts(res.rowCount, res.totalRowCount);
    await refresh();
    refreshHeader();
  }

  async function sortImpl(spec: SortSpec): Promise<{ spec: SortSpec; rowCount: number }> {
    if (!sortingEnabled) {
      return { spec: sortSpec, rowCount: store.getCounts().rowCount };
    }
    if (bus.emitVetoable('beforeSort', { spec })) {
      return { spec: sortSpec, rowCount: store.getCounts().rowCount };
    }
    const prevSpec = sortSpec;
    // Optimistically record the new intent BEFORE the async worker round-trip so a
    // rapid header re-click (`cycleSort`) reads the fresh spec, not the last-applied
    // one. Under the real `WorkerTransport` the round-trip is no longer a microtask,
    // so without this a fast second click would recompute from stale state and the
    // asc→desc cycle would stall (`ADR-SORT-FILTER-SEAM`). Reflect it in the header
    // immediately too. Restored to `prevSpec` on veto is unnecessary — veto already
    // returned above; this point is only reached once the sort will proceed.
    sortSpec = spec;
    refreshHeader();
    await applySort(spec);
    editController.history.push({
      kind: 'sort',
      targetThread: 'worker',
      apply: () => applySort(spec),
      revert: () => applySort(prevSpec),
    });
    const rowCount = store.getCounts().rowCount;
    bus.emit('afterSort', { spec, rowCount });
    return { spec, rowCount };
  }

  /** Header click → cycle a column's sort (asc→desc→none); Shift = multi-sort append. */
  function cycleSort(columnId: ColumnId, additive: boolean): void {
    const entries = sortSpec.entries;
    const existing = entries.find((e) => e.columnId === columnId);
    let next: SortSpec;
    if (additive) {
      // Keep every other key in place; cycle just this one asc→desc→removed.
      const list: SortSpec['entries'] = [];
      let found = false;
      for (const e of entries) {
        if (e.columnId === columnId) {
          found = true;
          if (e.direction === 'asc') list.push({ columnId, direction: 'desc' });
          // 'desc' → drop the key (removed from the multi-sort).
        } else {
          list.push({ ...e });
        }
      }
      if (!found) list.push({ columnId, direction: 'asc' });
      next = { entries: list };
    } else {
      // Plain click sorts by this column alone: none→asc→desc→none.
      if (!existing) next = { entries: [{ columnId, direction: 'asc' }] };
      else if (existing.direction === 'asc') next = { entries: [{ columnId, direction: 'desc' }] };
      else next = { entries: [] };
    }
    void sortImpl(next);
  }

  // ==========================================================================
  // `CAP-FILTER` — public filter (`LIB-FILTER`). Worker rebuilds the ordered
  // index (`MSG-FILTER`); **not undoable** (transient view state). Empty spec =
  // all rows. The per-column `LAYER-FILTER-MENU` predicates roll up into it.
  // ==========================================================================
  const currentFilterSpec = (): FilterSpec => ({
    perColumn: Object.fromEntries(filterPredicates),
  });

  async function filterImpl(
    spec: FilterSpec,
  ): Promise<{ spec: FilterSpec; rowCount: number; totalRowCount: number }> {
    if (!filteringEnabled) {
      const c = store.getCounts();
      return { spec: currentFilterSpec(), rowCount: c.rowCount, totalRowCount: c.totalRowCount };
    }
    if (bus.emitVetoable('beforeFilter', { spec })) {
      const c = store.getCounts();
      return { spec, rowCount: c.rowCount, totalRowCount: c.totalRowCount };
    }
    const res = await busy(client.filter(spec));
    store.setCounts(res.rowCount, res.totalRowCount);
    // Reconcile the per-column predicate map with the applied spec (a direct
    // `grid.filter(spec)` bypasses the menu; keep the header "active" state true).
    filterPredicates.clear();
    for (const [cid, pred] of Object.entries(spec.perColumn)) filterPredicates.set(cid, pred);
    for (const cid of [...filterDescriptors.keys()]) {
      if (!filterPredicates.has(cid)) filterDescriptors.delete(cid);
    }
    // Keep the scroll offset inside the (possibly smaller) filtered extent.
    scrollTop = Math.min(scrollTop, Math.max(0, heightIndex.totalHeight() - viewportHeight()));
    await refresh();
    refreshHeader();
    bus.emit('afterFilter', {
      spec,
      rowCount: res.rowCount,
      totalRowCount: res.totalRowCount,
    });
    return { spec, rowCount: res.rowCount, totalRowCount: res.totalRowCount };
  }

  /** `LAYER-FILTER-MENU` apply/clear → set/remove a column predicate, then filter. */
  function applyColumnFilter(
    columnId: ColumnId,
    predicate: ColumnFilter | null,
    descriptor: ColumnFilterState | null,
  ): void {
    if (predicate) {
      filterPredicates.set(columnId, predicate);
      if (descriptor) filterDescriptors.set(columnId, descriptor);
    } else {
      filterPredicates.delete(columnId);
      filterDescriptors.delete(columnId);
    }
    void filterImpl(currentFilterSpec());
  }

  // ==========================================================================
  // `CAP-RESIZE` — column width (`LIB-RESIZE`). Undoable (`resize`).
  // ==========================================================================
  async function applyWidth(columnId: ColumnId, width: number): Promise<void> {
    const col = columns.find((c) => c.id === columnId);
    if (!col) return;
    col.width = width;
    syncColWidths();
    refreshHeader();
    await refresh();
  }

  function commitWidth(columnId: ColumnId, fromWidth: number, toWidth: number): void {
    if (!resizeEnabled) return;
    const to = Math.max(minColumnWidth, Math.round(toWidth));
    if (to === fromWidth) {
      void applyWidth(columnId, fromWidth); // snap back a no-op drag
      return;
    }
    if (bus.emitVetoable('beforeResize', { columnId, width: to })) {
      void applyWidth(columnId, fromWidth);
      return;
    }
    void applyWidth(columnId, to);
    editController.history.push({
      kind: 'resize',
      targetThread: 'main',
      apply: () => applyWidth(columnId, to),
      revert: () => applyWidth(columnId, fromWidth),
    });
    bus.emit('afterResize', { columnId, width: to });
  }

  function setColumnWidthImpl(columnId: ColumnId, width: number): void {
    if (!resizeEnabled) return;
    const col = columns.find((c) => c.id === columnId);
    if (!col) return;
    commitWidth(columnId, col.width ?? DEFAULT_COL_WIDTH, width);
  }

  // ==========================================================================
  // `CAP-REORDER` — move a column (`LIB-REORDER`); id stays stable. Undoable.
  // ==========================================================================
  async function applyMove(columnId: ColumnId, toIndex: number): Promise<void> {
    const from = columns.findIndex((c) => c.id === columnId);
    if (from < 0) return;
    const target = clampIdx(toIndex, 0, columns.length - 1);
    if (from === target) return;
    const [col] = columns.splice(from, 1);
    columns.splice(target, 0, col as ColumnDef);
    onColumnsChanged();
    controller.afterStructuralChange();
    await refresh();
  }

  function moveColumnImpl(columnId: ColumnId, toIndex: number): void {
    if (!reorderEnabled) return;
    const from = columns.findIndex((c) => c.id === columnId);
    if (from < 0) return;
    const target = clampIdx(toIndex, 0, columns.length - 1);
    if (from === target) return;
    if (bus.emitVetoable('beforeReorder', { columnId, fromIndex: from, toIndex: target })) return;
    void applyMove(columnId, target);
    editController.history.push({
      kind: 'reorder',
      targetThread: 'main',
      apply: () => applyMove(columnId, target),
      revert: () => applyMove(columnId, from),
    });
    bus.emit('afterReorder', { columnId, fromIndex: from, toIndex: target });
  }

  // ==========================================================================
  // `CAP-FREEZE` — freeze pane (`LIB-FREEZE`, `ENTITY-FREEZE-PANE`). Undoable;
  // counts clamped to extents (`INV-FREEZE-PREFIX`).
  // ==========================================================================
  async function applyFrozen(next: FreezePane): Promise<void> {
    frozen.rows = next.rows;
    frozen.cols = next.cols;
    refreshHeader();
    await refresh();
  }

  function setFrozenImpl(o: { rows?: number; cols?: number }): void {
    if (!freezeEnabled) return;
    const rowMax = store.getCounts().rowCount;
    const colMax = columns.length;
    const nextRows = clampIdx(o.rows ?? frozen.rows, 0, rowMax);
    const nextCols = clampIdx(o.cols ?? frozen.cols, 0, colMax);
    const prev: FreezePane = { rows: frozen.rows, cols: frozen.cols };
    if (nextRows === prev.rows && nextCols === prev.cols) return;
    if (
      bus.emitVetoable('beforeFreezeChange', {
        frozenRowCount: nextRows,
        frozenColCount: nextCols,
      })
    ) {
      return;
    }
    const next: FreezePane = { rows: nextRows, cols: nextCols };
    void applyFrozen(next);
    editController.history.push({
      kind: 'freeze',
      targetThread: 'main',
      apply: () => applyFrozen(next),
      revert: () => applyFrozen(prev),
    });
    bus.emit('afterFreezeChange', { frozenRowCount: nextRows, frozenColCount: nextCols });
  }

  // ==========================================================================
  // `CAP-MERGE` — cell merge (`LIB-MERGE`, `ENTITY-MERGE-REGION`). Validates
  // `INV-MERGE-NONOVERLAP` + `INV-MERGE-MIN2` (else throws `MERGE_OVERLAP`);
  // undoable; vetoable `EVT-BEFORE-MERGE-CHANGE` / notify `EVT-AFTER-MERGE-CHANGE`.
  // ==========================================================================
  function clampRange(range: Range): Range {
    const rowMax = store.getCounts().rowCount - 1;
    const colMax = columns.length - 1;
    return {
      top: clampIdx(Math.min(range.top, range.bottom), 0, Math.max(0, rowMax)),
      bottom: clampIdx(Math.max(range.top, range.bottom), 0, Math.max(0, rowMax)),
      left: clampIdx(Math.min(range.left, range.right), 0, Math.max(0, colMax)),
      right: clampIdx(Math.max(range.left, range.right), 0, Math.max(0, colMax)),
    };
  }

  function mergeImpl(range: Range): void {
    if (!mergeEnabled) return;
    const r = clampRange(range);
    if (bus.emitVetoable('beforeMergeChange', { range: r, merged: true })) return;
    // Throws `MERGE_OVERLAP` on overlap / <2 cells (INV-MERGE-NONOVERLAP/-MIN2).
    const region = mergeModel.add(r);
    void refresh();
    editController.history.push({
      kind: 'merge',
      targetThread: 'main',
      apply: async () => {
        mergeModel.addRegion({ range: region.range, anchor: region.anchor });
        await refresh();
      },
      revert: async () => {
        mergeModel.removeAt(region.range);
        await refresh();
      },
    });
    bus.emit('afterMergeChange', { range: region.range, merged: true });
  }

  function unmergeImpl(range: Range): void {
    if (!mergeEnabled) return;
    const r = clampRange(range);
    const target = mergeModel.find(r);
    if (!target) return;
    if (bus.emitVetoable('beforeMergeChange', { range: target.range, merged: false })) return;
    const snapshot: MergeRegion = { range: { ...target.range }, anchor: { ...target.anchor } };
    mergeModel.removeRegion(target);
    void refresh();
    editController.history.push({
      kind: 'unmerge',
      targetThread: 'main',
      apply: async () => {
        mergeModel.removeAt(snapshot.range);
        await refresh();
      },
      revert: async () => {
        mergeModel.addRegion(snapshot);
        await refresh();
      },
    });
    bus.emit('afterMergeChange', { range: snapshot.range, merged: false });
  }

  // ==========================================================================
  // `CAP-GROUP` — row/column grouping + outline (`LIB-GROUP`, `ENTITY-GROUP-NODE`).
  // Validates `INV-GROUP-NEST` (else throws `GROUP_OVERLAP`); collapse hides the
  // spanned rows/cols; undoable; vetoable/notify `EVT-*-GROUP-CHANGE`.
  // ==========================================================================
  function groupImpl(o: { axis: GroupAxis; start: number; span: number }): { id: string } {
    if (!groupEnabled) return { id: '' };
    // Throws `GROUP_OVERLAP` on a partial same-axis overlap (INV-GROUP-NEST).
    const node = groupModel.add(o);
    if (bus.emitVetoable('beforeGroupChange', { node: { ...node } })) {
      groupModel.remove(node.id);
      return { id: '' };
    }
    rowVizDirty = true;
    void refresh();
    editController.history.push({
      kind: 'group',
      targetThread: 'main',
      apply: async () => {
        groupModel.addNode(node);
        rowVizDirty = true;
        await refresh();
      },
      revert: async () => {
        groupModel.remove(node.id);
        rowVizDirty = true;
        await refresh();
      },
    });
    bus.emit('afterGroupChange', { node: { ...node } });
    return { id: node.id };
  }

  function ungroupImpl(id: string): void {
    if (!groupEnabled) return;
    const node = groupModel.get(id);
    if (!node) return;
    if (bus.emitVetoable('beforeGroupChange', { node: { ...node } })) return;
    const snapshot: GroupNode = { ...node };
    groupModel.remove(id);
    rowVizDirty = true;
    void refresh();
    editController.history.push({
      kind: 'ungroup',
      targetThread: 'main',
      apply: async () => {
        groupModel.remove(id);
        rowVizDirty = true;
        await refresh();
      },
      revert: async () => {
        groupModel.addNode(snapshot);
        rowVizDirty = true;
        await refresh();
      },
    });
    bus.emit('afterGroupChange', { node: snapshot });
  }

  function setCollapsedImpl(id: string, collapsed: boolean): void {
    if (!groupEnabled) return;
    const node = groupModel.get(id);
    if (!node || node.collapsed === collapsed) return;
    if (bus.emitVetoable('beforeGroupChange', { node: { ...node } })) return;
    groupModel.setCollapsed(id, collapsed);
    rowVizDirty = true;
    void refresh();
    editController.history.push({
      kind: 'group',
      targetThread: 'main',
      apply: async () => {
        groupModel.setCollapsed(id, collapsed);
        rowVizDirty = true;
        await refresh();
      },
      revert: async () => {
        groupModel.setCollapsed(id, !collapsed);
        rowVizDirty = true;
        await refresh();
      },
    });
    const updated = groupModel.get(id) as GroupNode;
    bus.emit('afterGroupChange', { node: { ...updated } });
  }

  // `CAP-GROUP` outline overlay — a collapse/expand toggle per group node
  // (keyboard-operable `<button aria-expanded>`), appended to the scrolling body
  // so row toggles track vertical scroll.
  let groupOutline: HTMLElement | undefined;
  let onOutlineClick: ((e: MouseEvent) => void) | undefined;
  // P5 (PERF-FRAME-STEADY): persistent group-toggle buttons keyed by group id, so a
  // (scroll-only) refresh repositions them instead of tearing down + recreating all.
  const groupToggleNodes = new Map<string, HTMLButtonElement>();
  if (groupEnabled) {
    // Host the outline as a container overlay — a sibling of the grid root, so its
    // toggle buttons stay OUTSIDE the grid's `role="grid"`/`rowgroup`/`row` ARIA
    // tree (`A11Y-GRID`/axe forbid non-row children there). Positions are computed
    // in viewport space (header height + row offset − scrollTop), updated each refresh.
    const doc = container.ownerDocument;
    if (doc.defaultView?.getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }
    groupOutline = doc.createElement('div');
    groupOutline.className = 'mg-group-outline';
    groupOutline.style.display = 'none';
    container.appendChild(groupOutline);
    onOutlineClick = (e: MouseEvent): void => {
      const btn = (e.target as HTMLElement | null)?.closest?.(
        '[data-mg-group-toggle]',
      ) as HTMLElement | null;
      if (!btn) return;
      const id = btn.getAttribute('data-group-id');
      if (!id) return;
      const node = groupModel.get(id);
      if (node) setCollapsedImpl(id, !node.collapsed);
    };
    groupOutline.addEventListener('click', onOutlineClick);
  }

  function renderGroupOutline(): void {
    if (!groupEnabled || !groupOutline) return;
    const nodes = groupModel.list();
    const doc = container.ownerDocument;
    if (nodes.length === 0) {
      groupOutline.style.display = 'none';
      if (groupToggleNodes.size) {
        groupOutline.textContent = '';
        groupToggleNodes.clear();
      }
      return;
    }
    groupOutline.style.display = '';
    const colOffsets = viewport.getColOffsets();
    const headerH = renderer.headerElement?.offsetHeight ?? 0;
    const bodyH = viewportHeight();
    // P5: reuse a persistent button per group id (created once); a scroll-only
    // refresh only repositions/updates it. Stale ids are removed after the pass.
    const seen = new Set<string>();
    for (const n of nodes) {
      seen.add(n.id);
      let btn = groupToggleNodes.get(n.id);
      if (!btn) {
        btn = doc.createElement('button');
        btn.type = 'button';
        btn.className = 'mg-group-toggle';
        btn.setAttribute('data-mg-group-toggle', '');
        btn.setAttribute('data-group-id', n.id);
        btn.setAttribute('data-group-axis', n.axis);
        groupToggleNodes.set(n.id, btn);
      }
      btn.setAttribute('aria-expanded', String(!n.collapsed));
      btn.setAttribute(
        'aria-label',
        t(n.collapsed ? 'group.expand' : 'group.collapse', { axis: n.axis }),
      );
      btn.textContent = n.collapsed ? '+' : '−';
      if (n.axis === 'row') {
        // Viewport-space top = header + (row offset − scrollTop); when scrolled out
        // of the body band the button is detached (kept in the map for reuse) — same
        // observable DOM as the pre-P5 "skip append".
        const y = heightIndex.offsetOf(n.start) - scrollTop;
        if (y < -18 || y > bodyH) {
          if (btn.parentNode) btn.remove();
          continue;
        }
        btn.style.top = `${headerH + y + 2}px`;
        // Logical inline offset so the outline mirrors under `dir=rtl`.
        btn.style.insetInlineStart = `${2 + n.level * 14}px`;
      } else {
        btn.style.top = `${headerH + 2 + n.level * 14}px`;
        btn.style.insetInlineStart = `${(colOffsets[n.start] ?? 0) - inlineScroll() + 2}px`;
      }
      if (!btn.parentNode) groupOutline.appendChild(btn);
    }
    // Remove buttons for groups that no longer exist.
    for (const [id, btn] of groupToggleNodes) {
      if (!seen.has(id)) {
        btn.remove();
        groupToggleNodes.delete(id);
      }
    }
  }

  // `LAYER-CONTEXT-MENU` — the actions its items invoke. `delete row(s)` resolves
  // the selected/target ordered-row range to keys (works off-window) then removes.
  async function deleteRowRange(top: number, bottom: number): Promise<void> {
    const res = await client.getRows(top, bottom + 1);
    const keys = res.rows.map((r) => r.key);
    if (keys.length > 0) await removeRowsImpl(keys);
  }
  async function deleteColRange(left: number, right: number): Promise<void> {
    const ids = columns.slice(left, right + 1).map((c) => c.id);
    for (const id of ids) await removeColumnImpl(id);
  }

  // ==========================================================================
  // `CAP-MENU` (v1.4, `LIB-MENU`) — the builder-driven, target-branched context
  // menus. `resolveMenu` invokes the resolved `MenuBuilder` for a target, filters
  // it against feature flags (flag-off built-ins auto-hide), routes `command` ids
  // to the owning controllers, fires `EVT-MENU-OPEN`, and hands render-ready
  // `RenderMenuItem[]` to the `ContextMenuController`. Serves BOTH the cell menu
  // (`LAYER-CONTEXT-MENU`) and the header/row/corner menu (`LAYER-HEADER-MENU`).
  // ==========================================================================

  /** Late-bound facade reference so menu `group-by`/`ungroup` route through it. */
  let gridFacade: Grid | undefined;

  /** Per-open routing metadata derived from the origin node (not on `MenuContext`). */
  interface MenuMeta {
    rowIndex?: number | undefined;
    colIndex?: number | undefined;
    origin?: HTMLElement | undefined;
  }

  /** Is the menu surface for `target` gated off (no menu should open)? */
  function menuGatedOff(target: MenuTarget): boolean {
    if (menuDisabled) return true;
    if (target.kind === 'cell') return !features.isEnabled('contextMenu');
    // header / row-header / corner surfaces
    if (!headerMenuEnabled) return true;
    if (target.kind === 'row-header' && !headerPlan.rows) return true;
    if (target.kind === 'corner' && !headerPlan.corner) return true;
    return false;
  }

  /** Map a DOM node → the addressed `MenuTarget` + its origin node (or `null`). */
  function menuTargetFromNode(node: HTMLElement | null): MenuTargetResolution | null {
    if (!node) return null;
    const root = renderer.element as HTMLElement;
    const corner = node.closest?.('[data-mg-corner]') as HTMLElement | null;
    if (corner && root.contains(corner)) return { target: { kind: 'corner' }, origin: corner };
    const rh = node.closest?.('[role="rowheader"]') as HTMLElement | null;
    if (rh && root.contains(rh)) {
      const idx = Number(rh.getAttribute('data-row-index'));
      const rowKey = (Number.isFinite(idx) ? rowKeyByIndex.get(idx) : undefined) ?? rh.getAttribute('data-row-key') ?? '';
      return { target: { kind: 'row-header', rowKey }, origin: rh };
    }
    const ch = node.closest?.('[role="columnheader"]') as HTMLElement | null;
    if (ch && root.contains(ch)) {
      const columnId = ch.getAttribute('data-col-id');
      if (columnId) return { target: { kind: 'column-header', columnId }, origin: ch };
      return null;
    }
    const cell = node.closest?.('[role="gridcell"]') as HTMLElement | null;
    if (cell && root.contains(cell)) {
      const columnId = cell.getAttribute('data-col-id') ?? '';
      const ri = Number(cell.getAttribute('aria-rowindex')) - 1;
      const rowKey = (Number.isFinite(ri) ? rowKeyByIndex.get(ri) : undefined) ?? cell.getAttribute('data-row-key') ?? '';
      return { target: { kind: 'cell', cellRef: { rowKey, columnId } }, origin: cell };
    }
    return null;
  }

  /** The origin node for a programmatic `openMenu(target)` (anchor + focus restore). */
  function originForMenuTarget(target: MenuTarget): HTMLElement | undefined {
    const root = renderer.element as HTMLElement;
    const find = (selector: string, match: (el: HTMLElement) => boolean): HTMLElement | undefined => {
      for (const el of root.querySelectorAll<HTMLElement>(selector)) {
        if (match(el)) return el;
      }
      return undefined;
    };
    if (target.kind === 'corner') return root.querySelector('[data-mg-corner]') as HTMLElement | undefined;
    if (target.kind === 'column-header') {
      return find('[role="columnheader"]', (el) => el.getAttribute('data-col-id') === target.columnId);
    }
    if (target.kind === 'row-header') {
      return find('[role="rowheader"]', (el) => el.getAttribute('data-row-key') === String(target.rowKey));
    }
    // cell
    return find(
      '[role="gridcell"]',
      (el) =>
        el.getAttribute('data-row-key') === String(target.cellRef.rowKey) &&
        el.getAttribute('data-col-id') === target.cellRef.columnId,
    );
  }

  /** The row/col span the menu acts on (selection when the target is inside it). */
  function menuSpan(meta: MenuMeta): { rowTop: number; rowBottom: number; colLeft: number; colRight: number } {
    const active = controller.getActiveRange();
    const r = meta.rowIndex;
    const c = meta.colIndex;
    const inSel =
      !!active && r != null && c != null && r >= active.top && r <= active.bottom && c >= active.left && c <= active.right;
    return {
      rowTop: inSel ? active!.top : r ?? active?.top ?? 0,
      rowBottom: inSel ? active!.bottom : r ?? active?.bottom ?? 0,
      colLeft: inSel ? active!.left : c ?? active?.left ?? 0,
      colRight: inSel ? active!.right : c ?? active?.right ?? 0,
    };
  }

  /** Build the developer-facing `MenuContext` + internal routing `meta`. */
  function buildMenuContext(
    target: MenuTarget,
    position: { x: number; y: number },
    event: Event,
    origin: HTMLElement | undefined,
  ): { ctx: MenuContext; meta: MenuMeta } {
    const meta: MenuMeta = { origin };
    const ctxTarget: MenuContext['target'] = { kind: target.kind as MenuTargetKind };
    let value: unknown;
    if (target.kind === 'cell') {
      ctxTarget.cellRef = target.cellRef;
      ctxTarget.columnId = target.cellRef.columnId;
      ctxTarget.rowKey = target.cellRef.rowKey;
      meta.colIndex = columns.findIndex((col) => col.id === target.cellRef.columnId);
      const ri = origin ? Number(origin.getAttribute('aria-rowindex')) - 1 : NaN;
      meta.rowIndex = Number.isFinite(ri) && ri >= 0 ? ri : undefined;
      const col = columns[meta.colIndex];
      if (col) value = rowDataByKey.get(target.cellRef.rowKey)?.[col.field];
    } else if (target.kind === 'column-header') {
      ctxTarget.columnId = target.columnId;
      meta.colIndex = columns.findIndex((col) => col.id === target.columnId);
    } else if (target.kind === 'row-header') {
      ctxTarget.rowKey = target.rowKey;
      const idx = origin ? Number(origin.getAttribute('data-row-index')) : NaN;
      meta.rowIndex = Number.isFinite(idx) ? idx : undefined;
    }
    const ctx: MenuContext = {
      target: ctxTarget,
      selection: controller.getSelection().ranges.map((r) => ({ ...r })),
      value,
      event,
      position,
    };
    return { ctx, meta };
  }

  /** The `command` carried by an item (action/toggle/radio), or `undefined`. */
  function itemCommand(item: MenuItem): string | undefined {
    if (item.kind === 'action' || item.kind === 'checkbox' || item.kind === 'toggle' || item.kind === 'radio') {
      return item.command;
    }
    return undefined;
  }

  /**
   * Filter a builder's items: drop `hidden` items, **auto-hide** any built-in
   * whose capability flag is off, throw `INVALID_OPTIONS` on an unknown `command`,
   * and recurse into submenus.
   */
  function filterMenuItems(items: MenuItem[]): MenuItem[] {
    const out: MenuItem[] = [];
    for (const item of items) {
      if (item.kind !== 'separator' && item.hidden) continue;
      const command = itemCommand(item);
      if (command != null) {
        if (!isBuiltinCommand(command)) {
          throw new GridError('INVALID_OPTIONS', `Unknown menu command: ${command}`, { source: 'config' });
        }
        const flag = COMMAND_FLAG[command];
        if (flag && !features.isEnabled(flag)) continue; // auto-hide the flag-off built-in
      }
      if (item.kind === 'submenu') {
        out.push({ ...item, children: filterMenuItems(item.children) });
      } else {
        out.push(item);
      }
    }
    return out;
  }

  /** Drop leading/trailing/consecutive separators left after auto-hiding. */
  function collapseSeparators(items: MenuItem[]): MenuItem[] {
    const out: MenuItem[] = [];
    for (const item of items) {
      if (item.kind === 'separator') {
        if (out.length === 0 || out[out.length - 1]!.kind === 'separator') continue;
      }
      out.push(item);
    }
    while (out.length && out[out.length - 1]!.kind === 'separator') out.pop();
    return out;
  }

  /** Resolve an item's display label (literal `label` > `labelKey` > command key). */
  function menuLabel(item: MenuItem, meta: MenuMeta): string {
    if (item.kind === 'separator') return '';
    if (item.label != null) return item.label;
    const command = itemCommand(item);
    const params: Record<string, number> = {};
    if (command === 'delete-rows') params.count = menuSpan(meta).rowBottom - menuSpan(meta).rowTop + 1;
    if (command === 'delete-cols') params.count = menuSpan(meta).colRight - menuSpan(meta).colLeft + 1;
    if (item.labelKey) return t(item.labelKey, params);
    if (command && isBuiltinCommand(command)) return t(COMMAND_LABEL_KEY[command], params);
    return item.id ?? '';
  }

  /** Extra disabled predicate for built-ins whose flag is on but preconditions fail. */
  function commandExtraDisabled(command: BuiltinCommandId): boolean {
    // `cut`/`paste` mutate → additionally need `editing` (already-hidden when
    // `clipboard` is off). Everything else relies on its flag (hide) alone.
    if (command === 'cut' || command === 'paste') return !editingEnabled;
    return false;
  }

  /** Make a cell active when a clipboard action targets a cell outside the selection. */
  function focusMenuTargetCell(meta: MenuMeta): void {
    const r = meta.rowIndex;
    const c = meta.colIndex;
    if (r == null || c == null || c < 0) return;
    const active = controller.getActiveRange();
    const inSel = !!active && r >= active.top && r <= active.bottom && c >= active.left && c <= active.right;
    if (inSel) return;
    controller.setSelection({
      ranges: [{ top: r, bottom: r, left: c, right: c }],
      anchor: { row: r, col: c },
      activeCell: null,
    });
  }

  /** Route a `BuiltinCommandId` to its owning controller (`LIB-*`). */
  function runMenuCommand(command: BuiltinCommandId, ctx: MenuContext, meta: MenuMeta): void {
    const { rowTop, rowBottom, colLeft, colRight } = menuSpan(meta);
    const colId =
      ctx.target.columnId ??
      ctx.target.cellRef?.columnId ??
      (meta.colIndex != null ? columns[meta.colIndex]?.id : undefined);
    switch (command) {
      case 'copy':
        focusMenuTargetCell(meta);
        void clipboard.copy();
        break;
      case 'cut':
        focusMenuTargetCell(meta);
        void clipboard.cut();
        break;
      case 'paste':
        focusMenuTargetCell(meta);
        void clipboard.paste();
        break;
      case 'insert-row-above':
        void insertRowsImpl(rowTop, [blankRow()]);
        break;
      case 'insert-row-below':
        void insertRowsImpl(rowBottom + 1, [blankRow()]);
        break;
      case 'delete-rows':
        void deleteRowRange(rowTop, rowBottom);
        break;
      case 'insert-col-left':
        void insertColumnImpl(colLeft);
        break;
      case 'insert-col-right':
        void insertColumnImpl(colRight + 1);
        break;
      case 'delete-cols':
        void deleteColRange(colLeft, colRight);
        break;
      case 'sort-asc':
        if (colId) void sortImpl({ entries: [{ columnId: colId, direction: 'asc' }] });
        break;
      case 'sort-desc':
        if (colId) void sortImpl({ entries: [{ columnId: colId, direction: 'desc' }] });
        break;
      case 'clear-sort':
        void sortImpl({ entries: [] });
        break;
      case 'filter':
        if (colId) filterMenu.open(colId, meta.origin ?? (renderer.element as HTMLElement));
        break;
      case 'hide-column':
        if (colId) columnManage.hideColumn(colId);
        break;
      case 'show-column':
        if (colId) columnManage.showColumn(colId);
        break;
      case 'pin-column':
        if (colId) columnManage.pinColumn(colId, 'leading');
        break;
      case 'unpin-column':
        if (colId) columnManage.pinColumn(colId, null);
        break;
      case 'autofit':
        if (colId) columnManage.autofitColumn(colId);
        break;
      case 'autofit-all':
        columnManage.autofitAllColumns();
        break;
      case 'group-by':
        if (meta.colIndex != null && meta.colIndex >= 0) {
          gridFacade?.group({ axis: 'column', start: meta.colIndex, span: 1 });
        }
        break;
      case 'ungroup': {
        const node = groupModel.list().find((n) => n.axis === 'column' && meta.colIndex != null && meta.colIndex >= n.start && meta.colIndex < n.start + n.span);
        if (node) gridFacade?.ungroup(node.id);
        break;
      }
      case 'select-all':
        controller.selectAll();
        break;
    }
  }

  /** Map a filtered `MenuItem` → a render-ready `RenderMenuItem` (recursive). */
  function toRenderItem(item: MenuItem, ctx: MenuContext, meta: MenuMeta): RenderMenuItem {
    if (item.kind === 'separator') {
      return { id: item.id ?? 'sep', kind: 'separator', label: '', disabled: false };
    }
    const command = itemCommand(item) as BuiltinCommandId | undefined;
    const base: RenderMenuItem = {
      id: item.id,
      kind: item.kind,
      label: menuLabel(item, meta),
      disabled: item.disabled === true || (command != null && commandExtraDisabled(command)),
    };
    if (item.icon !== undefined) base.icon = item.icon;
    if (item.shortcut !== undefined) base.shortcut = item.shortcut;
    if (item.kind === 'custom') {
      // `SEC-MENU-CUSTOM-RENDER` — developer node mounted as-is (not auto-escaped).
      base.node = item.render(ctx);
      return base;
    }
    if (item.kind === 'submenu') {
      base.children = item.children.map((child) => toRenderItem(child, ctx, meta));
      return base;
    }
    if (item.kind === 'checkbox' || item.kind === 'toggle') {
      base.checked = item.checked === true;
    }
    if (item.kind === 'radio') {
      base.checked = item.checked === true;
      base.radioGroup = item.group;
    }
    // Bind activation: developer `handler` wins, else route the built-in `command`.
    if (!base.disabled) {
      const handler = item.handler;
      if (handler) base.onSelect = () => handler(ctx);
      else if (command) base.onSelect = () => runMenuCommand(command, ctx, meta);
    }
    return base;
  }

  /**
   * Resolve a target into render-ready items, or `null` to NOT open (menu
   * disabled / feature off / no items). Fires `EVT-MENU-OPEN` when opening.
   */
  function resolveMenu(
    target: MenuTarget,
    position: { x: number; y: number },
    event: Event,
    origin: HTMLElement | undefined,
  ): RenderMenuItem[] | null {
    if (menuGatedOff(target)) return null;
    const { ctx, meta } = buildMenuContext(target, position, event, origin);
    const built = resolvedMenuBuilder(ctx);
    const items = collapseSeparators(filterMenuItems(built));
    if (items.length === 0) return null;
    bus.emit('menuOpen', { target, items, position });
    return items.map((item) => toRenderItem(item, ctx, meta));
  }

  const contextMenu = new ContextMenuController({
    document: container.ownerDocument,
    root: renderer.element as HTMLElement,
    t,
    targetFromNode: (node) => menuTargetFromNode(node),
    resolve: (target, position, event, origin) => resolveMenu(target, position, event, origin),
    cellAt: (row, col) => renderer.cellAt(row, col),
    getActiveCell: () => controller.getActiveIndex(),
    originForTarget: (target) => originForMenuTarget(target),
  });

  // `LAYER-FILTER-MENU` + `COMPONENT-WORKSHEET` header interactions (sort click /
  // shift-click multi-sort, filter icon, resize + reorder drag). Gated per flag.
  const filterMenu = new FilterMenuController({
    document: container.ownerDocument,
    root: renderer.element as HTMLElement,
    t,
    columns,
    getState: (columnId) => filterDescriptors.get(columnId),
    apply: (columnId, predicate, descriptor) =>
      applyColumnFilter(columnId, predicate, descriptor),
  });

  const headerController = new HeaderController({
    document: container.ownerDocument,
    headerEl: renderer.headerElement as HTMLElement,
    isSortingEnabled: () => sortingEnabled,
    isFilteringEnabled: () => filteringEnabled,
    isResizeEnabled: () => resizeEnabled,
    isReorderEnabled: () => reorderEnabled,
    columnById: (id) => columns.find((c) => c.id === id),
    columnIndex: (id) => columns.findIndex((c) => c.id === id),
    currentWidth: (id) => columns.find((c) => c.id === id)?.width ?? DEFAULT_COL_WIDTH,
    minColumnWidth,
    cycleSort: (columnId, additive) => cycleSort(columnId, additive),
    // `CAP-SELECT` — a plain column-header click line-selects the whole column
    // (`DOM-HEADER`, `INV-SELECTION-LINE`); Ctrl/Cmd adds a disjoint column.
    isLineSelectEnabled: () => multiRangeEnabled,
    lineSelectColumn: (columnId, additive, span) => {
      const index = columns.findIndex((c) => c.id === columnId);
      if (index < 0) return;
      // `AC-HEADER-SPAN-SELECT` — a spanning group header cell line-selects the whole
      // contiguous range it covers (`[index, index+span)`); Ctrl/Cmd adds it disjoint.
      const s = Math.max(1, span ?? 1);
      if (s > 1) {
        const end = Math.min(columns.length, index + s);
        const indices: number[] = [];
        for (let k = index; k < end; k++) indices.push(k);
        controller.selectColumns(indices, { additive });
      } else {
        controller.selectColumn(index, { additive });
      }
    },
    // `CAP-HEADER` (`DOM-CORNER`) — corner click selects the whole sheet.
    isCornerSelectAllEnabled: () => headerEnabled && (headerPlan.corner?.selectAll ?? false),
    selectAllSheet: () => controller.selectAll(),
    // `headerResize` — column-header band height + row-header gutter width drag.
    isHeaderResizeEnabled: () => headerResizeEnabled,
    currentBandHeight: (band) => headerPlan.columns.heights[band] ?? rowHeight,
    previewBandHeight: (band, height) => setBandHeight(band, height),
    commitBandHeight: (band, _from, to) => setBandHeight(band, to),
    currentRowHeaderWidth: () => headerPlan.rows?.totalWidth ?? 0,
    previewRowHeaderWidth: (width) => setRowHeaderWidth(width),
    commitRowHeaderWidth: (_from, to) => setRowHeaderWidth(to),
    openFilter: (columnId, trigger) => filterMenu.open(columnId, trigger),
    previewWidth: (columnId, width) => {
      void applyWidth(columnId, width);
    },
    commitWidth: (columnId, from, to) => commitWidth(columnId, from, to),
    moveColumn: (columnId, toIndex) => moveColumnImpl(columnId, toIndex),
    // `CAP-COLUMN-MANAGE` — double-click a resize handle → autofit the column.
    isAutofitEnabled: () => autofitEnabled,
    autofitColumn: (columnId) => columnManage.autofitColumn(columnId),
  });

  // `DOM-ROWHEADER` — a frozen gutter cell click line-selects the whole row
  // (`CAP-HEADER`/`-SELECT`, `header.rows.select`). Delegated off the grid root;
  // gutter cells live in the scrolling body.
  const onGutterClick = (e: MouseEvent): void => {
    const rh = (e.target as HTMLElement | null)?.closest?.('[role="rowheader"]') as HTMLElement | null;
    if (!rh || !renderer.bodyElement?.contains(rh)) return;
    if (!(headerPlan.rows?.select ?? false)) return;
    const idx = Number(rh.getAttribute('data-row-index'));
    if (Number.isFinite(idx)) controller.selectRow(idx, { additive: e.ctrlKey || e.metaKey });
  };
  (renderer.element as HTMLElement).addEventListener('click', onGutterClick);

  // ==========================================================================
  // Slice 8 — export (`COMPONENT-EXPORT`, `CAP-EXPORT`) + state persistence
  // (`COMPONENT-STATE-SERDE`, `CAP-PERSIST-STATE`). Each gated by its flag.
  // ==========================================================================
  const exportEnabled = features.isEnabled('export');
  const persistEnabled = features.isEnabled('persistState');

  // `DEP-XLSX` — the lazy exceljs loader. A runtime-variable specifier keeps the
  // literal out of the bundle (esbuild leaves it as an external runtime import),
  // so core carries NO static exceljs dependency. `options.loadExcel` overrides
  // it (fidelity substitution: unit tests inject a fake exceljs / a failing load).
  const XLSX_MODULE = 'exceljs';
  const loadExcel =
    options.loadExcel ?? ((): Promise<unknown> => import(/* @vite-ignore */ XLSX_MODULE));

  const toExportColumns = (cols: readonly ColumnDef[]): ExportColumn[] =>
    cols.map((c) => ({
      id: c.id,
      field: c.field,
      ...(c.header !== undefined ? { header: c.header } : {}),
      ...(c.width !== undefined ? { width: c.width } : {}),
      ...(c.type !== undefined ? { type: c.type } : {}),
      ...(c.formatMask !== undefined ? { formatMask: c.formatMask } : {}),
    }));

  const exportController = new ExportController({
    columns: () => toExportColumns(columns),
    getRows: async (allData) => {
      const counts = store.getCounts();
      const count = allData ? counts.totalRowCount : counts.rowCount;
      if (count === 0) return [];
      const res = await client.getRows(0, count, allData);
      return res.rows.map((r) => ({ key: r.key, data: r.data }));
    },
    ...(cascade ? { resolveStyle: (ctx): CellStyle => cascade!.resolve(ctx).style } : {}),
    getFrozen: () => ({ ...frozen }),
    getMerges: () => (mergeEnabled ? mergeModel.list() : []),
    loadExcel,
    emitError: (err) => bus.emit('error', { error: err }),
  });

  const disabledExport = (): Promise<Blob> =>
    Promise.reject(
      new GridError('INVALID_OPTIONS', 'export feature is disabled', { source: 'config' }),
    );

  // --- COMPONENT-STATE-SERDE (LIB-STATE) ------------------------------------
  function serializeStateImpl(): GridState {
    return {
      version: GRID_STATE_VERSION,
      columns: columns.map((c) => ({
        id: c.id,
        ...(c.width !== undefined ? { width: c.width } : {}),
      })),
      sort: { entries: sortSpec.entries.map((e) => ({ ...e })) },
      filter: currentFilterSpec(),
      frozen: { ...frozen },
      merges: mergeModel.list().map((m) => ({ range: { ...m.range }, anchor: { ...m.anchor } })),
      groups: groupModel.list().map((n) => ({ ...n })),
      cellStyles: cascade ? cascade.overlayEntries() : [],
      conditionalRules: condEngine ? condEngine.getRules().map((r) => ({ ...r })) : [],
    };
  }

  /** Reorder + re-width the live column model to match `order` (kept columns win). */
  function restoreColumns(order: readonly GridState['columns'][number][]): void {
    const byId = new Map(columns.map((c) => [c.id, c] as const));
    const next: ColumnDef[] = [];
    for (const s of order) {
      const c = byId.get(s.id);
      if (!c) continue;
      if (s.width !== undefined) c.width = s.width;
      next.push(c);
      byId.delete(s.id);
    }
    // Keep any columns not named in the saved order (in their current position).
    for (const c of columns) if (byId.has(c.id)) next.push(c);
    columns.splice(0, columns.length, ...next);
    onColumnsChanged();
  }

  function restoreStateImpl(state: GridState): void {
    const check = checkStateVersion(state?.version);
    if (check.warning) bus.emit('error', { error: check.warning });
    if (!check.ok) return;

    // Layout (synchronous): columns, freeze, merges, groups, styles, cond rules.
    if (Array.isArray(state.columns)) restoreColumns(state.columns);
    if (state.frozen) {
      frozen.rows = clampIdx(state.frozen.rows ?? 0, 0, store.getCounts().rowCount);
      frozen.cols = clampIdx(state.frozen.cols ?? 0, 0, columns.length);
      refreshHeader();
    }
    if (mergeEnabled && Array.isArray(state.merges)) restoreMerges(state.merges);
    if (groupEnabled && Array.isArray(state.groups)) restoreGroups(state.groups);
    if (cascade && Array.isArray(state.cellStyles)) {
      for (const e of state.cellStyles) cascade.setOverlay(e.rowKey, e.columnId, { ...e.style });
    }
    if (condEngine && Array.isArray(state.conditionalRules)) {
      condEngine.clear();
      for (const r of state.conditionalRules) condEngine.add(r);
      cascade?.invalidate();
    }

    // View ops (asynchronous through the worker): filter then sort, then repaint.
    void (async () => {
      if (filteringEnabled && state.filter) {
        const res = await client.filter(state.filter);
        store.setCounts(res.rowCount, res.totalRowCount);
        filterPredicates.clear();
        filterDescriptors.clear();
        for (const [cid, pred] of Object.entries(state.filter.perColumn)) {
          filterPredicates.set(cid, pred);
        }
      }
      if (sortingEnabled && state.sort) {
        const res = await client.sort(state.sort);
        sortSpec = { entries: state.sort.entries.map((e) => ({ ...e })) };
        store.setCounts(res.rowCount, res.totalRowCount);
      }
      if (condEngine && condEngine.hasRules()) {
        await condEngine.prime().catch(() => undefined);
        lastAggVersion = client.version;
        cascade?.invalidate();
      }
      refreshHeader();
      await refresh();
      bus.emit('stateChange', {});
    })();
  }

  // ==========================================================================
  // `A11Y-GRID` accessible-announcement contract — the live-region announcer +
  // its emitter wiring. Two visually-hidden `aria-live` regions on the container
  // (outside `role="grid"`). Ambient after-events map to POLITE announcements
  // (sort/filter settle, row/column insert/delete); a validation error is
  // ASSERTIVE; edit-commit is OFF unless `announceEdits`. Scroll / viewport
  // (window arrival) / selection-move are NOT subscribed → the named silent
  // exclusions. Bursts coalesce to the final state (see `Announcer`).
  // ==========================================================================
  const announcer = new Announcer(container);
  const columnHeaderOf = (columnId: ColumnId): string =>
    columns.find((c) => c.id === columnId)?.header ?? String(columnId);
  const rowsText = (n: number): string => t('a11y.rowCount', { count: n });

  // `LIB-COLUMN-MANAGE` (`CAP-COLUMN-MANAGE`) — the hide/show + leading-pin +
  // autofit controller. Wired here (after the announcer/`columnHeaderOf`) so its
  // polite announcements + `columnHeaderOf` labels are available; the
  // `HeaderController` calls it via the `columnManage` closure (assigned above the
  // grid facade, before any user interaction).
  columnManage = new ColumnManageController({
    columnManageEnabled: () => columnManageEnabled,
    autofitEnabled: () => autofitEnabled,
    getColumn: (id) => columns.find((c) => c.id === id),
    visibleColumnIds: () => columns.filter((c) => c.hidden !== true).map((c) => c.id),
    setHidden: (id, hidden) => setColumnHidden(id, hidden),
    setPinned: (id, pinned) => setColumnPinned(id, pinned),
    measureColumnWidth: (id) => measureColumnWidth(id),
    applyWidth: (id, width) => {
      void applyWidth(id, width);
    },
    currentWidth: (id) => columns.find((c) => c.id === id)?.width ?? DEFAULT_COL_WIDTH,
    minColumnWidth,
    bus,
    pushCommand: (kind, apply, revert) =>
      editController.history.push({ kind, targetThread: 'main', apply, revert }),
    announce: (message) => announcer.announce(message),
    t,
    columnHeaderOf,
  });

  bus.on('afterSort', ({ spec, rowCount }) => {
    // A cleared sort has no column/direction to name — stay silent.
    const primary = spec.entries[0];
    if (!primary) return;
    announcer.announce(
      t('a11y.sorted', {
        column: columnHeaderOf(primary.columnId),
        direction: t(primary.direction === 'asc' ? 'a11y.ascending' : 'a11y.descending'),
        rows: rowsText(rowCount),
      }),
    );
  });
  bus.on('afterFilter', ({ rowCount, totalRowCount }) => {
    announcer.announce(t('a11y.filtered', { rows: rowsText(rowCount), total: totalRowCount }));
  });
  bus.on('afterInsert', ({ count }) => {
    announcer.announce(t('a11y.rowsInserted', { count }));
  });
  bus.on('afterDelete', ({ rowKeys }) => {
    announcer.announce(t('a11y.rowsRemoved', { count: rowKeys.length }));
  });
  bus.on('afterInsertCol', () => {
    announcer.announce(t('a11y.colsInserted', { count: 1 }));
  });
  bus.on('afterDeleteCol', () => {
    announcer.announce(t('a11y.colsRemoved', { count: 1 }));
  });
  bus.on('validationError', ({ error }) => {
    announcer.announce(t('a11y.invalid', { message: error.message }), { assertive: true });
  });
  if (options.announceEdits) {
    bus.on('afterEdit', ({ cell, newValue }) => {
      announcer.announce(
        t('a11y.editCommitted', {
          column: columnHeaderOf(cell.columnId),
          value: newValue == null ? '' : String(newValue),
        }),
      );
    });
  }

  const grid: Grid = {
    options,

    async setData(rows: readonly RowData[], opts?: SetDataOptions) {
      const keyField = opts?.keyField ?? options.keyField ?? null;
      const onDuplicateKey =
        opts?.onDuplicateKey ?? options.onDuplicateKey ?? 'reject';
      // `CAP-FORMULA` — seed the main-thread formula mirror from the ORIGINAL rows
      // BEFORE load (the in-process engine overwrites `data[field]` with computed
      // values, so the raw `=…` source must be captured first).
      if (formulaEnabled) {
        formulaMirror.clear();
        for (let i = 0; i < rows.length; i++) {
          const data = rows[i] as RowData;
          const key = keyField != null ? (getByPath(data, keyField) as RowKey) : i;
          for (const col of columns) {
            const raw = col.field.includes('.') ? getByPath(data, col.field) : data[col.field];
            if (isFormulaSource(raw)) formulaMirror.set(fKey(key, col.field), raw);
          }
        }
      }
      const res = await busy(
        client.load(rows, keyField, toWireColumns(columns), onDuplicateKey, formulaEnabled, i18n.getLocale()),
      );
      // Rebind reset (`AC-REBIND`): default clears undo/redo history + change
      // tracking; `preserveOnRebind` keeps them (best-effort).
      const preserve = opts?.preserveOnRebind ?? options.preserveOnRebind ?? false;
      if (!preserve) editController.reset();
      // The engine's `load` clears its sort/filter; mirror that on the main
      // thread, then apply any configured initial freeze (`ENTITY-FREEZE-PANE`,
      // counts clamped to extents — `INV-FREEZE-PREFIX`).
      sortSpec = { entries: [] };
      filterPredicates.clear();
      filterDescriptors.clear();
      frozen.rows = 0;
      frozen.cols = 0;
      // Merge/group state is per-dataset — reset on (re)bind.
      mergeModel.clear();
      groupModel.clear();
      for (const r of appliedHiddenRows) heightIndex.setMeasured(r, rowHeight);
      appliedHiddenRows = new Set();
      hiddenRowsCache = new Set();
      // `hidden`/`pinned` are column config (not per-dataset), so preserve them
      // across rebind — recompute the hidden-col set rather than clearing it.
      hiddenColsCache = computeHiddenCols();
      rowVizDirty = false;
      syncColWidths();
      if (options.frozen && freezeEnabled) {
        frozen.rows = clampIdx(options.frozen.rows ?? 0, 0, res.rowCount);
        frozen.cols = clampIdx(options.frozen.cols ?? 0, 0, columns.length);
      }
      store.setCounts(res.rowCount, res.totalRowCount);
      scrollTop = 0;
      renderer.setScroll(0, scrollLeft);
      refreshHeader();
      await refresh();
      return { rowCount: res.rowCount };
    },

    getCellFormula(rowKey, columnId) {
      if (!formulaEnabled) return undefined;
      const col = columns.find((c) => c.id === columnId);
      if (!col) return undefined;
      return formulaMirror.get(fKey(rowKey, col.field));
    },

    async recalculate() {
      if (!formulaEnabled) return { changed: 0, cycles: 0, elapsedMs: 0 };
      const t0 = performance.now();
      const res = await busy(client.recalc(i18n.getLocale()));
      const elapsedMs = performance.now() - t0;
      await refresh();
      bus.emit('afterRecalc', { changed: res.changed, cycles: res.cycles, elapsedMs, trigger: 'manual' });
      return { changed: res.changed, cycles: res.cycles, elapsedMs };
    },

    async getRows(range) {
      const res = await client.getRows(range.startIndex, range.endIndex);
      return {
        startIndex: res.startIndex,
        rows: res.rows.map((r) => ({ key: r.key, data: r.data })),
      };
    },

    async getRowCount() {
      return client.getCounts();
    },

    scrollTo(target) {
      if (target.rowIndex !== undefined) {
        scrollTop = heightIndex.offsetOf(target.rowIndex);
      }
      if (target.colIndex !== undefined) {
        const inline = viewport.getColOffsets()[target.colIndex] ?? 0;
        scrollLeft = i18n.getDirection() === 'rtl' ? -inline : inline;
      }
      renderer.setScroll(scrollTop, scrollLeft);
      void refresh();
    },

    sort(spec: SortSpec) {
      return sortImpl(spec);
    },

    filter(spec: FilterSpec) {
      return filterImpl(spec);
    },

    getSortSpec(): SortSpec {
      return { entries: sortSpec.entries.map((e) => ({ ...e })) };
    },

    getFilterSpec(): FilterSpec {
      return currentFilterSpec();
    },

    setColumnWidth(columnId: ColumnId, width: number): void {
      setColumnWidthImpl(columnId, width);
    },

    moveColumn(columnId: ColumnId, toIndex: number): void {
      moveColumnImpl(columnId, toIndex);
    },

    setFrozen(o: { rows?: number; cols?: number }): void {
      setFrozenImpl(o);
    },

    getFrozen(): FreezePane {
      return { ...frozen };
    },

    merge(range: Range): void {
      mergeImpl(range);
    },

    unmerge(range: Range): void {
      unmergeImpl(range);
    },

    getMerges(): MergeRegion[] {
      return mergeModel.list().map((m) => ({ range: { ...m.range }, anchor: { ...m.anchor } }));
    },

    group(o: { axis: GroupAxis; start: number; span: number }): { id: string } {
      return groupImpl(o);
    },

    ungroup(id: string): void {
      ungroupImpl(id);
    },

    setCollapsed(id: string, collapsed: boolean): void {
      setCollapsedImpl(id, collapsed);
    },

    getGroups(): GroupNode[] {
      return groupModel.list().map((n) => ({ ...n }));
    },

    getSelection(): Selection {
      return controller.getSelection();
    },

    setSelection(sel: Selection): void {
      controller.setSelection(sel);
    },

    addRange(range: Range): void {
      controller.addRange(range);
    },

    selectRow(index: number, opts?: { additive?: boolean }): void {
      controller.selectRow(index, opts);
    },

    selectRows(indices: readonly number[]): void {
      controller.selectRows(indices);
    },

    selectColumn(index: number, opts?: { additive?: boolean }): void {
      controller.selectColumn(index, opts);
    },

    selectColumns(indices: readonly number[]): void {
      controller.selectColumns(indices);
    },

    selectAll(): void {
      controller.selectAll();
    },

    clearSelection(): void {
      controller.clearSelection();
    },

    hideColumn(id: ColumnId): void {
      columnManage.hideColumn(id);
    },

    showColumn(id: ColumnId): void {
      columnManage.showColumn(id);
    },

    pinColumn(id: ColumnId, edge: 'leading' | null): void {
      columnManage.pinColumn(id, edge);
    },

    autofitColumn(id: ColumnId): void {
      columnManage.autofitColumn(id);
    },

    autofitAllColumns(): void {
      columnManage.autofitAllColumns();
    },

    on: bus.on.bind(bus) as Grid['on'],
    off: bus.off.bind(bus) as Grid['off'],

    updateCell(rowKey: RowKey, columnId: ColumnId, value: unknown) {
      return editController.updateCell(rowKey, columnId, value);
    },

    insertRows(atIndex: number, rows: readonly RowData[]) {
      return insertRowsImpl(atIndex, rows);
    },

    removeRows(rowKeys: readonly RowKey[]) {
      return removeRowsImpl(rowKeys);
    },

    insertColumn(atIndex: number) {
      return insertColumnImpl(atIndex);
    },

    removeColumn(columnId: ColumnId) {
      return removeColumnImpl(columnId);
    },

    getChanges() {
      return getChangesImpl();
    },

    copy() {
      return clipboard.copy();
    },

    cut() {
      return clipboard.cut();
    },

    paste() {
      return clipboard.paste();
    },

    fill(range: Range) {
      return clipboard.fill(range);
    },

    beginEdit(cell: CellRef): void {
      editController.beginEdit(cell);
    },

    commitEdit() {
      return editController.commitEdit();
    },

    cancelEdit(): void {
      editController.cancelEdit();
    },

    setStyle(range: Range, style: CellStyle): void {
      if (!formattingEnabled || !cascade) return;
      void setStyleImpl(range, style);
    },

    clearStyle(range: Range): void {
      if (!formattingEnabled || !cascade) return;
      void clearStyleImpl(range);
    },

    addConditionalRule(rule: ConditionalRuleInput): { id: string } {
      if (!condEnabled || !condEngine || !cascade) return { id: '' };
      return addConditionalRuleImpl(rule);
    },

    removeConditionalRule(id: string): void {
      if (!condEnabled || !condEngine || !cascade) return;
      removeConditionalRuleImpl(id);
    },

    setTheme(theme: 'light' | 'dark'): void {
      if (!themeEnabled) return;
      renderer.setTheme(theme);
    },

    setLocale(locale: string, bundle?: MessageBundle): void {
      if (!i18nEnabled) return;
      const prevDir = i18n.getDirection();
      i18n.setLocale(locale, bundle);
      // Direction may auto-flip with the locale (e.g. an RTL language).
      if (i18n.getDirection() !== prevDir) renderer.setDirection(i18n.getDirection());
      refreshHeader();
      // `COMPONENT-I18N` — locale-aware formula cells (FIXED/DOLLAR/TEXT) must
      // re-format under the new locale; recalc pushes it to the engine, then refresh.
      if (formulaEnabled) {
        void (async () => {
          await client.recalc(i18n.getLocale());
          await refresh();
        })();
      } else {
        void refresh();
      }
    },

    setDirection(direction: 'ltr' | 'rtl'): void {
      if (!i18nEnabled) return;
      i18n.setDirection(direction);
      renderer.setDirection(direction);
      refreshHeader();
      void refresh();
    },

    undo() {
      return editController.undo();
    },

    redo() {
      return editController.redo();
    },

    isFeatureEnabled(flag: FeatureFlag) {
      return features.isEnabled(flag);
    },

    getPerfMarks() {
      return perf.getMarks();
    },

    exportCsv(opts?: ExportOptions) {
      if (!exportEnabled) return disabledExport();
      return exportController.exportCsv(opts);
    },

    exportXlsx(opts?: ExportOptions) {
      if (!exportEnabled) return disabledExport();
      return exportController.exportXlsx(opts);
    },

    serializeState(): GridState {
      if (!persistEnabled) {
        return {
          version: GRID_STATE_VERSION,
          columns: [],
          sort: { entries: [] },
          filter: { perColumn: {} },
          frozen: { rows: 0, cols: 0 },
          merges: [],
          groups: [],
          cellStyles: [],
          conditionalRules: [],
        };
      }
      return serializeStateImpl();
    },

    restoreState(state: GridState): void {
      if (!persistEnabled) return;
      restoreStateImpl(state);
    },

    announce(message: string, opts?: { assertive?: boolean }): void {
      announcer.announce(message, opts ?? {});
    },

    openMenu(target: MenuTarget, position?: { x: number; y: number }): void {
      if (menuDisabled) return; // `menu:false` ⇒ no-op
      contextMenu.openForTarget(target, position);
    },

    closeMenu(): void {
      contextMenu.close(false);
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      editController.cancelEdit();
      announcer.destroy();
      if (groupOutline) {
        if (onOutlineClick) groupOutline.removeEventListener('click', onOutlineClick);
        groupOutline.remove();
      }
      clipboard.destroy();
      contextMenu.destroy();
      filterMenu.destroy();
      headerController.destroy();
      (renderer.element as HTMLElement | undefined)?.removeEventListener('click', onGutterClick);
      controller.destroy();
      bus.clear();
      renderer.destroy();
      transport.terminate();
    },
  };

  // Late-bind the facade so menu `group-by`/`ungroup` route through the public API.
  gridFacade = grid;

  if (options.data) {
    void grid.setData(options.data);
  }

  return grid;
}

type DataClientRows = Awaited<ReturnType<DataClient['getRows']>>['rows'];
