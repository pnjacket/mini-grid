/**
 * `LIB-VALIDATOR-API` — the validation surface for `COMPONENT-EDIT`.
 *
 * A `Validator` is a pure, synchronous `(value, ctx) => true | ValidationError`.
 * `column.validation` carries a list of declarative built-in rules (required,
 * type, min/max/range, regex, oneOf/list) plus an escape-hatch `custom` rule that
 * wraps a developer `Validator`. `compileValidation` folds a column's rules into a
 * single `Validator` that returns the **first** `ValidationError` (or `true`).
 *
 * Validation runs on **commit** (`ENTITY-EDIT-SESSION` `validating` state); a
 * failure drives the `VALIDATION_FAILED` path (`EVT-VALIDATION-ERROR` + inline
 * tip, edit stays `rejected`). Contract: `LIB-VALIDATOR-API` (Interfaces).
 */
import type { ColumnId, ColumnType, RowData, RowKey } from '../types.js';
import type { Translate } from '../i18n/i18n.js';
import { defaultTranslate } from '../i18n/i18n.js';

/** A validation failure — the shape a `Validator` returns instead of `true`. */
export interface ValidationError {
  message: string;
}

/** Context handed to a `Validator` when the grid evaluates it on commit. */
export interface ValidationContext {
  rowKey: RowKey;
  columnId: ColumnId;
  field: string;
  type: ColumnType;
  data: Readonly<RowData>;
}

/** `type Validator = (value, ctx) => true | ValidationError` (pure, sync). */
export type Validator = (value: unknown, ctx: ValidationContext) => true | ValidationError;

/** A declarative built-in validation rule (`ENTITY-COLUMN.validation[]`). */
export type ValidationRule =
  | { kind: 'required'; message?: string | undefined }
  | { kind: 'type'; message?: string | undefined }
  | { kind: 'min'; value: number; message?: string | undefined }
  | { kind: 'max'; value: number; message?: string | undefined }
  | { kind: 'range'; min?: number | undefined; max?: number | undefined; message?: string | undefined }
  | { kind: 'regex'; pattern: string; flags?: string | undefined; message?: string | undefined }
  | { kind: 'oneOf'; values: readonly unknown[]; message?: string | undefined }
  | { kind: 'custom'; validate: Validator };

function isEmpty(value: unknown): boolean {
  return value == null || value === '';
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  return Number(value);
}

/** Does `value` satisfy `type`? Empty values are type-valid (see `required`). */
function typeMatches(value: unknown, type: ColumnType): boolean {
  if (isEmpty(value)) return true;
  switch (type) {
    case 'number':
      return typeof value === 'number' ? Number.isFinite(value) : Number.isFinite(Number(value));
    case 'boolean':
      return typeof value === 'boolean';
    case 'date':
      return value instanceof Date
        ? !Number.isNaN(value.getTime())
        : !Number.isNaN(new Date(value as string).getTime());
    case 'text':
    case 'select':
    case 'custom':
      return true;
  }
}

/**
 * Evaluate one rule; `true` = pass, else the `ValidationError` to surface. Default
 * messages resolve through `t` (`COMPONENT-I18N`) so they follow the active locale;
 * an explicit `rule.message` (host-authored) always wins over the default.
 */
function evalRule(
  rule: ValidationRule,
  value: unknown,
  ctx: ValidationContext,
  t: Translate,
): true | ValidationError {
  switch (rule.kind) {
    case 'required':
      return isEmpty(value)
        ? { message: rule.message ?? t('validation.required') }
        : true;
    case 'type':
      return typeMatches(value, ctx.type)
        ? true
        : { message: rule.message ?? t('validation.type', { type: ctx.type }) };
    case 'min': {
      if (isEmpty(value)) return true;
      return asNumber(value) >= rule.value
        ? true
        : { message: rule.message ?? t('validation.min', { value: rule.value }) };
    }
    case 'max': {
      if (isEmpty(value)) return true;
      return asNumber(value) <= rule.value
        ? true
        : { message: rule.message ?? t('validation.max', { value: rule.value }) };
    }
    case 'range': {
      if (isEmpty(value)) return true;
      const n = asNumber(value);
      if (rule.min !== undefined && n < rule.min) {
        return {
          message:
            rule.message ??
            t('validation.range', { min: rule.min, max: rule.max ?? '∞' }),
        };
      }
      if (rule.max !== undefined && n > rule.max) {
        return {
          message:
            rule.message ??
            t('validation.range', { min: rule.min ?? '-∞', max: rule.max }),
        };
      }
      return true;
    }
    case 'regex': {
      if (isEmpty(value)) return true;
      const re = new RegExp(rule.pattern, rule.flags);
      return re.test(String(value))
        ? true
        : { message: rule.message ?? t('validation.regex', { pattern: rule.pattern }) };
    }
    case 'oneOf':
      return rule.values.includes(value)
        ? true
        : {
            message:
              rule.message ??
              t('validation.oneOf', { values: rule.values.map(String).join(', ') }),
          };
    case 'custom':
      return rule.validate(value, ctx);
  }
}

/**
 * Fold a column's declarative rules into one `Validator` returning the first
 * failure (or `true`). An empty/absent rule list compiles to an always-valid
 * validator. Column `type` is captured so a `type` rule can consult it. `t`
 * (`COMPONENT-I18N`) localizes default messages; it defaults to the English
 * fallback so a direct `compileValidation(rules)` call still works.
 */
export function compileValidation(
  rules: readonly ValidationRule[] | undefined,
  t: Translate = defaultTranslate,
): Validator {
  if (!rules || rules.length === 0) return () => true;
  return (value, ctx) => {
    for (const rule of rules) {
      const res = evalRule(rule, value, ctx, t);
      if (res !== true) return res;
    }
    return true;
  };
}
