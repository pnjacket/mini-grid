/**
 * `PATTERN-FEATURE-FLAGS` / `CAP-FEATURE-FLAGS` mechanism. One flag per
 * capability; **all default `true`**. A feature module registers in the
 * `FeatureRegistry` **only when its flag is on** — disabled ⇒ not registered ⇒
 * no affordance and (structurally, tree-shaken) no cost. Later slices supply the
 * actual `FeatureModule` for each flag; Slice 2 establishes the flag type, the
 * registry, and the gating helper (`isEnabled`) they plug into.
 */

/** One boolean per grid capability (`FeatureFlags`, all default `true`). */
export interface FeatureFlags {
  editing: boolean;
  sorting: boolean;
  filtering: boolean;
  selection: boolean;
  /** v1.3 `CE-MULTI-RANGE-SELECT` — disjoint multi-range + line-select; off ⇒ single range. */
  multiRangeSelect: boolean;
  /** v1.3 `CAP-HEADER` — the unified header subsystem (`header.columns` bands, corner, tooltips). */
  header: boolean;
  /**
   * v1.3 `CAP-HEADER` — the `header.rows` gutter axis. The observable **default is
   * off** (no `header.rows` configured); this flag lets a host force the gutter off
   * even when configured.
   */
  rowHeader: boolean;
  /** v1.3 `CAP-HEADER` — band-height / row-header-width drag-resize. */
  headerResize: boolean;
  /** v1.4 `CAP-MENU` — the dedicated header/row/corner context menu (`LAYER-HEADER-MENU`). */
  headerMenu: boolean;
  /** v1.3 `CAP-COLUMN-MANAGE` — hide/show + leading pin + autofit (`LIB-COLUMN-MANAGE`). */
  columnManage: boolean;
  /** v1.3 `CAP-COLUMN-MANAGE` — the autofit affordance (double-click resize handle + fit-all). */
  autofit: boolean;
  resize: boolean;
  reorder: boolean;
  freeze: boolean;
  merge: boolean;
  group: boolean;
  clipboard: boolean;
  /** v1.5 `CAP-FORMULA` — Excel-like in-cell formulas + recalculation engine. */
  formula: boolean;
  formatting: boolean;
  conditionalFormatting: boolean;
  theme: boolean;
  export: boolean;
  persistState: boolean;
  contextMenu: boolean;
  undo: boolean;
  i18n: boolean;
}

/** A single capability flag key. */
export type FeatureFlag = keyof FeatureFlags;

/** The canonical flag ordering (drives defaults + registry iteration). */
export const FEATURE_FLAG_KEYS: readonly FeatureFlag[] = [
  'editing',
  'sorting',
  'filtering',
  'selection',
  'multiRangeSelect',
  'header',
  'rowHeader',
  'headerResize',
  'headerMenu',
  'columnManage',
  'autofit',
  'resize',
  'reorder',
  'freeze',
  'merge',
  'group',
  'clipboard',
  'formula',
  'formatting',
  'conditionalFormatting',
  'theme',
  'export',
  'persistState',
  'contextMenu',
  'undo',
  'i18n',
];

/**
 * Every flag defaults to `true` (a feature is on unless the host opts out) —
 * EXCEPT `formula`. `CAP-FORMULA` **reinterprets** a cell value that begins with
 * `=` as a formula (rather than literal text), which would silently change the
 * meaning of existing `=`-leading data and the `SEC-EXPORT-FORMULA-GUARD`
 * neutralization. A semantic-changing capability must be **explicitly opted in**,
 * so `formula` defaults **off** (`features: { formula: true }` to enable).
 */
export const DEFAULT_FEATURE_FLAGS: FeatureFlags = FEATURE_FLAG_KEYS.reduce(
  (acc, key) => {
    acc[key] = key !== 'formula';
    return acc;
  },
  {} as FeatureFlags,
);

/** Resolve a `Partial<FeatureFlags>` override against the all-true defaults. */
export function resolveFeatureFlags(
  overrides?: Partial<FeatureFlags>,
): FeatureFlags {
  return { ...DEFAULT_FEATURE_FLAGS, ...overrides };
}

/**
 * A registrable feature module. Later slices implement `setup` to wire the
 * feature's affordances/handlers; the registry only invokes it when the flag is
 * enabled, so a disabled feature's `setup` never runs (no affordance, no cost).
 */
export interface FeatureModule {
  readonly flag: FeatureFlag;
  setup?(): void;
}

/**
 * The feature registry keyed by flag. `register` is a no-op (returns `false`)
 * when the module's flag is disabled — the disabled feature leaves **no entry**
 * and its `setup` is never called.
 */
export class FeatureRegistry {
  private readonly flags: FeatureFlags;
  private readonly registered = new Map<FeatureFlag, FeatureModule>();

  constructor(overrides?: Partial<FeatureFlags>) {
    this.flags = resolveFeatureFlags(overrides);
  }

  /** `grid.isFeatureEnabled(flag)` — is the capability turned on? */
  isEnabled(flag: FeatureFlag): boolean {
    return this.flags[flag] === true;
  }

  /**
   * Register a feature module iff its flag is enabled. Runs the module's `setup`
   * and records the entry; returns `false` (and does nothing) when disabled.
   */
  register(module: FeatureModule): boolean {
    if (!this.isEnabled(module.flag)) return false;
    module.setup?.();
    this.registered.set(module.flag, module);
    return true;
  }

  /** Whether a module has been registered for `flag` (an affordance exists). */
  has(flag: FeatureFlag): boolean {
    return this.registered.has(flag);
  }

  /** The registered module for `flag`, if any. */
  get(flag: FeatureFlag): FeatureModule | undefined {
    return this.registered.get(flag);
  }

  /** The set of flags with a registered module. */
  registeredFlags(): FeatureFlag[] {
    return [...this.registered.keys()];
  }
}
