/**
 * @mini-grid/core — framework-agnostic data-grid engine.
 *
 * Slice 1 (headless foundation): the read-only data engine, worker message
 * protocol, variable-height virtualization, reactive store, DOM renderer, and
 * the `createGrid` public API. Editing/selection/formatting/public sort-filter
 * and the framework adapters land in later slices.
 */

/** Current package version. Kept in sync with package.json `version`. */
export const VERSION = '0.0.0';

// Public API
export { createGrid } from './api/grid.js';
export type {
  Grid,
  GridOptions,
  ColumnDef,
  ColumnFlags,
  SetDataOptions,
} from './api/options.js';

// Event surface (EVT-*) — the typed bus + vetoable/notify model
export { EventBus } from './api/event-bus.js';
export type {
  GridEvent,
  BeforeEvent,
  Vetoable,
  GridAfterEvents,
  GridBeforeEvents,
  GridEventType,
  GridEventBus,
  ViewportRange,
} from './api/event-bus.js';

// Selection model (ENTITY-SELECTION) + INV-SELECTION-ACTIVE
export {
  SelectionModel,
  EMPTY_SELECTION,
  normalizeRange,
  rangeContains,
  selectionInvariantHolds,
} from './selection/selection.js';
export type { Selection, SelectionCell, CellIndex } from './selection/selection.js';

// Interaction (COMPONENT-INTERACTION) — keyboard/pointer/ARIA + BIND-KEYS
export { InteractionController } from './interaction/interaction.js';
export type { InteractionHost } from './interaction/interaction.js';
// LAYER-CONTEXT-MENU / LAYER-HEADER-MENU / A11Y-CONTEXT-MENU / A11Y-HEADER-MENU
export { ContextMenuController } from './interaction/context-menu.js';
export type { ContextMenuHost, MenuTargetResolution } from './interaction/context-menu.js';
// CAP-MENU (LIB-MENU) — builtinItems registry + BuiltinCommandId catalog + default builder
export {
  builtinItems,
  defaultMenuBuilder,
  BUILTIN_COMMAND_IDS,
  isBuiltinCommand,
  COMMAND_FLAG,
  COMMAND_LABEL_KEY,
} from './interaction/menu.js';
export type { RenderMenuItem } from './interaction/menu.js';
export {
  DEFAULT_KEY_MAP,
  resolveKeyMap,
  resolveKey,
  computeMove,
} from './interaction/keymap.js';
export type {
  NavAction,
  KeyMap,
  ResolvedKey,
  Extents,
  CellPos,
} from './interaction/keymap.js';

// Feature-flag registry (PATTERN-FEATURE-FLAGS / CAP-FEATURE-FLAGS)
export {
  FeatureRegistry,
  DEFAULT_FEATURE_FLAGS,
  FEATURE_FLAG_KEYS,
  resolveFeatureFlags,
} from './api/features.js';
export type { FeatureFlags, FeatureFlag, FeatureModule } from './api/features.js';

// Errors
export {
  GridError,
  isGridError,
  sourceForCode,
  toGridError,
  shouldEmitErrorEvent,
  routeError,
} from './errors.js';
export type {
  ErrCode,
  ErrSeverity,
  ErrSource,
  ErrContext,
  GridErrorOptions,
} from './errors.js';

// Editing / validation / history (COMPONENT-EDIT / -HISTORY)
export { EditController, ChangeTracker } from './editing/edit-session.js';
export type {
  EditResult,
  EditHost,
  EditSessionState,
  RowChanges,
} from './editing/edit-session.js';
export {
  resolveEditorFactory,
  BUILT_IN_EDITORS,
} from './editing/editors.js';
export type {
  CellEditor,
  EditorContext,
  EditorFactory,
  EditorSpec,
  SelectOption,
} from './editing/editors.js';
export { compileValidation } from './editing/validation.js';
export type {
  Validator,
  ValidationError,
  ValidationContext,
  ValidationRule,
} from './editing/validation.js';
export { History } from './editing/history.js';
export type { Command, CommandKind } from './editing/history.js';

// Clipboard (COMPONENT-CLIPBOARD) — LIB-CLIPBOARD copy/cut/paste/fill + fill handle
export {
  ClipboardController,
  parseTsv,
  serializeTsv,
} from './clipboard/clipboard.js';
export type {
  ClipboardHost,
  ClipboardRow,
  ClipboardIndex,
} from './clipboard/clipboard.js';

// Shared types
export type {
  RowKey,
  ColumnId,
  RowData,
  ChangeState,
  CellRef,
  Range,
  CellStyle,
  CellBorder,
  CellContext,
  CellRenderer,
  FormatterFn,
  CondFmtPredicate,
  ColumnType,
  Comparator,
  FilterPredicate,
  FilterContext,
  BuiltinFilter,
  ColumnFilter,
  SortSpec,
  SortDirection,
  FilterSpec,
  FreezePane,
  MergeRegion,
  GroupNode,
  GroupAxis,
  OnDuplicateKey,
  HeaderConfig,
  HeaderRenderer,
  HeaderRenderContext,
  HeaderRenderResult,
  MenuTargetKind,
  BuiltinCommandId,
  MenuContext,
  MenuItem,
  MenuActionItem,
  MenuSeparatorItem,
  MenuSubmenuItem,
  MenuToggleItem,
  MenuRadioItem,
  MenuCustomItem,
  MenuItemHandler,
  MenuItemRender,
  MenuBuilder,
  MenuTarget,
} from './types.js';

// Worksheet (COMPONENT-WORKSHEET) — public sort/filter + resize/reorder/freeze
// header UI (CAP-SORT/-FILTER/-RESIZE/-REORDER), LAYER-FILTER-MENU + operators.
export { HeaderController } from './worksheet/header-controller.js';
export type { HeaderControllerHost } from './worksheet/header-controller.js';
export {
  FilterMenuController,
  buildFilterPredicate,
  buildColumnFilter,
  operatorsForType,
  operatorArity,
} from './worksheet/filter-menu.js';
// Serializable filter descriptor path (ADR-SORT-FILTER-SEAM)
export {
  buildBuiltinFilter,
  compileBuiltinFilter,
  isBuiltinFilter,
} from './engine/builtin-filter.js';
export type {
  FilterMenuHost,
  FilterOperator,
  ColumnFilterState,
} from './worksheet/filter-menu.js';

// Merge + group models (COMPONENT-STORE) — CAP-MERGE / CAP-GROUP
export { MergeModel, mergeInvariantHolds, normalizeMergeRange } from './worksheet/merge.js';
export { GroupModel, groupInvariantHolds } from './worksheet/group.js';

// Formatting (COMPONENT-FORMAT / -CONDFMT) — style cascade, masks, conditional
export {
  StyleCascade,
  mergeStyle,
  applyResolvedStyle,
  appendDataBar,
  prependIcon,
} from './format/style-cascade.js';
export type { ResolvedCell, StyleCascadeDeps } from './format/style-cascade.js';
export { formatValue, DEFAULT_LOCALE } from './format/format-mask.js';

// i18n (COMPONENT-I18N / CAP-I18N) — LIB-LOCALE (setLocale/setDirection),
// the English default message catalog, and the `t` helper surface.
export {
  I18nController,
  DEFAULT_BUNDLE,
  directionForLocale,
  defaultTranslate,
} from './i18n/i18n.js';
export type {
  MessageBundle,
  MessageValue,
  PluralForms,
  Translate,
  TranslateParams,
  Direction,
} from './i18n/i18n.js';
export {
  ConditionalFormatEngine,
  inScope,
  interpolate,
  interpolate3,
} from './format/conditional.js';
export type {
  ConditionalRule,
  ConditionalRuleInput,
  ConditionalRuleKind,
  ConditionalRuleConfig,
  ValueRuleConfig,
  ColorScaleConfig,
  DataBarConfig,
  IconSetConfig,
  IconThreshold,
  CustomConfig,
  CompareOp,
  ConditionalResult,
  DataBarDecoration,
  AggregateKind,
  AggregateFetcher,
} from './format/conditional.js';

// Formula subsystem (COMPONENT-DATA-WORKER / CAP-FORMULA) — parser, evaluator,
// ~70-function library, and the dependency-graph recalc engine.
export {
  FormulaEngine,
  encodeCellId,
  parseFormula,
  tokenize,
  FormulaSyntaxError,
  evaluate as evaluateFormulaAst,
  FUNCTIONS,
  FUNCTION_NAMES,
  FormulaError,
  ERR as FORMULA_ERRORS,
  isError as isFormulaError,
  fromRaw as formulaFromRaw,
  toDisplay as formulaToDisplay,
  colLettersToIndex,
  indexToColLetters,
  parseA1,
  refToA1,
  translateRef,
  isFormulaSource,
} from './formula/index.js';
export type {
  FormulaValue,
  FormulaErrorCode,
  FormulaNode,
  CellRefA1,
  RangeRefA1,
  GridAccess,
  CellId,
  RecalcSummary,
  CellResolver,
  RangeValue,
} from './formula/index.js';

// Data engine (pure) — the core, also used by the perf benchmark.
export { IndexEngine, defaultCompare } from './engine/index-engine.js';
export type {
  EngineColumn,
  EngineRow,
  EngineCounts,
  EngineWindow,
  EngineLoadOptions,
  EngineEditResult,
} from './engine/index-engine.js';

// Worker protocol + transports
export { EngineHost } from './protocol/engine-host.js';
export { DataClient } from './protocol/data-client.js';
export type { EditApplyResult, StructResult, ViewContext } from './protocol/data-client.js';
export {
  needsMainThread,
  hasCustomSort,
  hasCustomFilter,
  toDeclarativeSort,
  toBuiltinFilter,
} from './protocol/view-plan.js';
export {
  InProcessTransport,
  WorkerTransport,
} from './protocol/transport.js';
export type { DataTransport, WorkerLike, CrashInfo } from './protocol/transport.js';
export { connectDataWorker } from './worker/worker-entry.js';
export type { WorkerScope } from './worker/worker-entry.js';
export type {
  MainToWorker,
  WorkerToMain,
  MsgLoad,
  MsgQueryWindow,
  MsgQueryCount,
  MsgApplyEdit,
  MsgEditResult,
  MsgSort,
  MsgFilter,
  MsgInsertRows,
  MsgRemoveRows,
  MsgInsertCol,
  MsgRemoveCol,
  MsgExportRows,
  MsgExportRowsResult,
  MsgSetIndex,
  MsgStructResult,
  MsgWindow,
  MsgIndexSummary,
  MsgAggregate,
  MsgAggregateResult,
  MsgError,
  WireColumn,
  WireRow,
} from './protocol/messages.js';

// Store
export { ReactiveStore } from './store/store.js';
export type { Unsubscribe, StoreCounts } from './store/store.js';

// Virtualization
export { HeightIndex } from './viewport/height-index.js';
export { Viewport } from './viewport/viewport.js';
export type { RowWindow, ColWindow } from './viewport/viewport.js';

// Render
export { GridRenderer } from './render/renderer.js';
export type {
  CellDecorator,
  CellDecorInfo,
  RendererMountOptions,
} from './render/renderer.js';

// Perf
export { PerfRecorder } from './perf/perf.js';
export type { PerfMark } from './perf/perf.js';

// A11y (A11Y-GRID) — the live-region announcer (accessible-announcement contract)
export { Announcer } from './a11y/announcer.js';
export type { AnnouncerOptions, AnnounceOptions } from './a11y/announcer.js';

// Export (COMPONENT-EXPORT) — CSV/xlsx (LIB-EXPORT) + SEC-EXPORT-FORMULA-GUARD
export {
  ExportController,
  maskToNumFmt,
  cssToArgb,
  CSV_MIME,
  XLSX_MIME,
} from './export/export.js';
export type {
  ExportColumn,
  ExportRow,
  ExportOptions,
  ExportHost,
} from './export/export.js';
export { guardFormula, needsFormulaGuard } from './export/formula-guard.js';

// State persistence (COMPONENT-STATE-SERDE) — LIB-STATE serialize/restore
export { GRID_STATE_VERSION, checkStateVersion } from './state/state-serde.js';
export type {
  GridState,
  GridStateColumn,
  GridStateCellStyle,
  StateVersionCheck,
} from './state/state-serde.js';
