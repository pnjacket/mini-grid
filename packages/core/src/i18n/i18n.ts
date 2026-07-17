/**
 * `COMPONENT-I18N` / `CAP-I18N` — string externalization, locale-aware formatting,
 * pluralization, and text direction for the grid.
 *
 * Every user-facing string the grid renders (filter operators + Apply/Clear,
 * context-menu labels, aria-labels, validation default messages, group toggles,
 * the minted-column header) is keyed in the English `DEFAULT_BUNDLE` and resolved
 * through `t(key, params?)`. There is **no hard-coded user-facing text** in the
 * component surface — the host swaps locales by supplying its own bundle via
 * `LIB-LOCALE.setLocale(locale, bundle?)`.
 *
 * Pluralization uses `Intl.PluralRules` under the active locale: a message value
 * may be a plural map (`{ one, other, … }`) selected by the `count` param.
 *
 * Locale-aware number/date formatting is delegated to `Intl` in the format-mask
 * module (`CAP-FMT-VALUE`); this controller owns the *active locale* those masks
 * read (via `getLocale()`), so `setLocale` re-locales the value formatters too.
 */
import { DEFAULT_LOCALE } from '../format/format-mask.js';

/** Plural-form map keyed by CLDR plural categories (`Intl.PluralRules`). */
export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>>;

/** A catalog message: a plain string, or a plural-form map selected by `count`. */
export type MessageValue = string | PluralForms;

/** A keyed message catalog (`ENTITY`-free — pure UI strings). */
export type MessageBundle = Record<string, MessageValue>;

/** Interpolation params; `count` additionally drives plural selection. */
export type TranslateParams = Record<string, string | number>;

/** The internal `t(key, params?)` helper signature threaded to every UI surface. */
export type Translate = (key: string, params?: TranslateParams) => string;

export type Direction = 'ltr' | 'rtl';

/** ISO-639 language subtags that are written right-to-left. */
const RTL_LANGUAGES = new Set([
  'ar', // Arabic
  'he', // Hebrew
  'fa', // Persian
  'ur', // Urdu
  'ps', // Pashto
  'sd', // Sindhi
  'ug', // Uyghur
  'yi', // Yiddish
  'dv', // Divehi
  'ckb', // Central Kurdish
]);

/** Infer the writing direction for a BCP-47 locale (its primary language subtag). */
export function directionForLocale(locale: string): Direction {
  const primary = locale.toLowerCase().split(/[-_]/)[0] ?? '';
  return RTL_LANGUAGES.has(primary) ? 'rtl' : 'ltr';
}

/**
 * The English default bundle. Keys are stable; values are the exact strings the
 * grid shipped before externalization (so the default LTR/en-US behavior — and
 * every existing test that reads a label — is unchanged). A plural value carries
 * `{ one, other }` (extend with `zero`/`two`/`few`/`many` per host locale).
 */
export const DEFAULT_BUNDLE: MessageBundle = {
  // Filter operators (LAYER-FILTER-MENU) — type-aware operator select labels.
  'filter.op.equals': 'Equals',
  'filter.op.notEquals': 'Not equals',
  'filter.op.contains': 'Contains',
  'filter.op.startsWith': 'Starts with',
  'filter.op.endsWith': 'Ends with',
  'filter.op.eq': '=',
  'filter.op.neq': '≠',
  'filter.op.gt': '>',
  'filter.op.lt': '<',
  'filter.op.between': 'Between',
  'filter.op.in': 'In list',
  'filter.op.blank': 'Blank',
  'filter.op.notBlank': 'Not blank',
  // Filter menu chrome (labels + actions + trigger aria-label).
  'filter.operator': 'Operator',
  'filter.value': 'Value',
  'filter.and': 'And',
  'filter.clear': 'Clear',
  'filter.apply': 'Apply',
  'filter.ariaLabel': 'Filter {column}',

  // CAP-HEADER (DOM-CORNER) — the corner select-all accessible name.
  'header.selectAll': 'Select all',

  // Context menu (LAYER-CONTEXT-MENU) — menu accessible name + item labels.
  'contextMenu.ariaLabel': 'Grid actions',
  'contextMenu.copy': 'Copy',
  'contextMenu.cut': 'Cut',
  'contextMenu.paste': 'Paste',
  'contextMenu.insertRowAbove': 'Insert row above',
  'contextMenu.insertRowBelow': 'Insert row below',
  'contextMenu.deleteRows': { one: 'Delete row', other: 'Delete rows' },
  'contextMenu.insertColLeft': 'Insert column left',
  'contextMenu.insertColRight': 'Insert column right',
  'contextMenu.deleteCols': { one: 'Delete column', other: 'Delete columns' },

  // CAP-MENU (v1.4) — the slice 17–19 built-in command labels (sort/filter/
  // hide/show/pin/autofit/group/select-all) resolved for the header menu.
  'menu.sortAsc': 'Sort ascending',
  'menu.sortDesc': 'Sort descending',
  'menu.clearSort': 'Clear sort',
  'menu.filter': 'Filter…',
  'menu.hideColumn': 'Hide column',
  'menu.showColumn': 'Show column',
  'menu.pinColumn': 'Pin column',
  'menu.unpinColumn': 'Unpin column',
  'menu.autofit': 'Autofit column',
  'menu.autofitAll': 'Autofit all columns',
  'menu.groupBy': 'Group by this column',
  'menu.ungroup': 'Ungroup',
  'menu.selectAll': 'Select all',

  // CAP-GROUP outline toggles (aria-label on the collapse/expand button).
  'group.expand': 'Expand {axis} group',
  'group.collapse': 'Collapse {axis} group',

  // Structural CRUD — the header for a grid-minted (blank) column.
  'column.defaultHeader': 'Column',

  // Validation default messages (LIB-VALIDATOR-API) — used when a rule supplies
  // no explicit `message`. Params carry the offending bound/type/pattern/values.
  'validation.required': 'This field is required',
  'validation.type': 'Value must be a valid {type}',
  'validation.min': 'Value must be ≥ {value}',
  'validation.max': 'Value must be ≤ {value}',
  'validation.range': 'Value must be between {min} and {max}',
  'validation.regex': 'Value does not match {pattern}',
  'validation.oneOf': 'Value must be one of: {values}',

  // Count-bearing announcement templates (pluralized via Intl.PluralRules).
  'a11y.rowCount': { one: '{count} row', other: '{count} rows' },
  'a11y.rowsSelected': { one: '{count} row selected', other: '{count} rows selected' },

  // Live-region announcement templates (`A11Y-GRID` accessible-announcement
  // contract). The count-bearing fragments interpolate a pre-pluralized `{rows}`
  // built from `a11y.rowCount`; sort/insert/delete are `polite`, `a11y.invalid`
  // is `assertive`. `a11y.editCommitted` is only emitted when `announceEdits`.
  'a11y.ascending': 'ascending',
  'a11y.descending': 'descending',
  'a11y.sorted': 'Sorted by {column} {direction}, {rows}',
  'a11y.filtered': 'Filtered, {rows} of {total}',
  'a11y.rowsInserted': { one: '{count} row inserted', other: '{count} rows inserted' },
  'a11y.rowsRemoved': { one: '{count} row removed', other: '{count} rows removed' },
  'a11y.colsInserted': { one: '{count} column inserted', other: '{count} columns inserted' },
  'a11y.colsRemoved': { one: '{count} column removed', other: '{count} columns removed' },
  'a11y.invalid': 'Invalid: {message}',
  'a11y.editCommitted': '{column} set to {value}',
  // CAP-COLUMN-MANAGE (LIB-COLUMN-MANAGE) — polite hide/show/pin/autofit announcements.
  'a11y.columnHidden': 'Column {column} hidden',
  'a11y.columnShown': 'Column {column} shown',
  'a11y.columnPinned': 'Column {column} pinned',
  'a11y.columnUnpinned': 'Column {column} unpinned',
  'a11y.columnAutofit': 'Column {column} resized to fit',
  'a11y.columnsAutofit': { one: '{count} column resized to fit', other: '{count} columns resized to fit' },
};

/** Interpolate `{name}` tokens in `template` from `params`. */
function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** Resolve one catalog entry (selecting a plural form when `count` is present). */
function resolveMessage(
  value: MessageValue,
  locale: string,
  params?: TranslateParams,
): string {
  if (typeof value === 'string') return interpolate(value, params);
  // Plural map — select the CLDR category for `count` under the active locale.
  const count = typeof params?.count === 'number' ? params.count : Number(params?.count ?? 0);
  const category = new Intl.PluralRules(locale).select(count);
  const form = value[category] ?? value.other ?? value.one ?? '';
  return interpolate(form, params);
}

/**
 * `COMPONENT-I18N` controller — holds the active locale + direction + merged
 * message catalog, and exposes the bound `t` used across the UI surfaces. One per
 * grid instance (`createGrid`).
 */
export class I18nController {
  private locale: string;
  private direction: Direction;
  private bundle: MessageBundle;
  /** Bound so it can be passed by reference into renderer/controllers as `t`. */
  readonly t: Translate;

  constructor(opts: {
    locale?: string;
    direction?: Direction;
    bundle?: MessageBundle;
  } = {}) {
    this.locale = opts.locale ?? DEFAULT_LOCALE;
    // Explicit direction wins; otherwise infer from the locale (auto-RTL).
    this.direction = opts.direction ?? directionForLocale(this.locale);
    this.bundle = { ...DEFAULT_BUNDLE, ...(opts.bundle ?? {}) };
    this.t = (key, params) => this.translate(key, params);
  }

  /** Resolve a message key (missing key → the key itself, for dev visibility). */
  translate(key: string, params?: TranslateParams): string {
    const value = this.bundle[key];
    if (value === undefined) return key;
    return resolveMessage(value, this.locale, params);
  }

  getLocale(): string {
    return this.locale;
  }

  getDirection(): Direction {
    return this.direction;
  }

  /**
   * `LIB-LOCALE.setLocale` — swap the active locale (re-locales `Intl` number/date
   * masks + plural selection) and merge an optional host bundle over the English
   * default. Direction auto-follows the locale (a host may pin it via
   * `setDirection`). Without a bundle the catalog resets to the English default.
   */
  setLocale(locale: string, bundle?: MessageBundle): void {
    this.locale = locale;
    this.bundle = { ...DEFAULT_BUNDLE, ...(bundle ?? {}) };
    this.direction = directionForLocale(locale);
  }

  /** `LIB-LOCALE.setDirection` — pin the text direction (`dir` on `DOM-ROOT`). */
  setDirection(direction: Direction): void {
    this.direction = direction;
  }
}

/**
 * A process-wide English fallback translator — used where no grid-scoped `t` is
 * threaded (e.g. `compileValidation` called directly in a unit test). Grid code
 * always passes its own `I18nController.t` so it re-locales with `setLocale`.
 */
export const defaultTranslate: Translate = new I18nController().t;
