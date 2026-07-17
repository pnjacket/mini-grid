/**
 * `LAYER-FILTER-MENU` + `A11Y-FILTER-MENU` — the per-column filter surface, plus
 * the type-aware built-in operator set and the `FilterPredicate` builder that
 * backs `CAP-FILTER`.
 *
 * Built-in operators (`ENTITY-FILTER`, UX `LAYER-FILTER-MENU`):
 *  - text → equals / notEquals / contains / startsWith / endsWith / blank / notBlank
 *  - number & date → = / != / > / < / between / blank / notBlank
 *  - a set/list filter (`in`, comma-separated) available on every type
 *  - plus a custom `FilterPredicate` (`LIB-COMPARATOR-API`) via the public API.
 *
 * **Empty value = no filter** (all rows): `buildFilterPredicate` returns `null`
 * when the operator needs a value and none is supplied — the caller removes that
 * column's predicate (an empty overall `FilterSpec` = all rows).
 *
 * A11y (`A11Y-FILTER-MENU`): the trigger carries `aria-expanded`; on open focus
 * moves to the first control; Tab/arrow navigate the labeled controls; **Esc
 * closes and restores focus to the filter icon**; light-dismiss on outside
 * pointer-down / scroll.
 */
import type { ColumnDef } from '../api/options.js';
import type {
  BuiltinFilter,
  ColumnFilter,
  ColumnId,
  ColumnType,
  FilterContext,
  FilterPredicate,
} from '../types.js';
import type { Translate } from '../i18n/i18n.js';
import { defaultTranslate } from '../i18n/i18n.js';
import {
  buildBuiltinFilter,
  compileBuiltinFilter,
} from '../engine/builtin-filter.js';
import type { FilterOperator } from '../engine/builtin-filter.js';

/** The built-in filter operators (type-aware; `in` = set/list membership). */
export type { FilterOperator };

interface OperatorMeta {
  op: FilterOperator;
  /** Number of value inputs the operator consumes (0 = none, 2 = `between`). */
  arity: 0 | 1 | 2;
}

// Operator display labels are externalized (`COMPONENT-I18N`): the select option
// text resolves via `t('filter.op.<operator>')` — no hard-coded label lives here.
const OPS: Record<FilterOperator, OperatorMeta> = {
  equals: { op: 'equals', arity: 1 },
  notEquals: { op: 'notEquals', arity: 1 },
  contains: { op: 'contains', arity: 1 },
  startsWith: { op: 'startsWith', arity: 1 },
  endsWith: { op: 'endsWith', arity: 1 },
  eq: { op: 'eq', arity: 1 },
  neq: { op: 'neq', arity: 1 },
  gt: { op: 'gt', arity: 1 },
  lt: { op: 'lt', arity: 1 },
  between: { op: 'between', arity: 2 },
  in: { op: 'in', arity: 1 },
  blank: { op: 'blank', arity: 0 },
  notBlank: { op: 'notBlank', arity: 0 },
};

const TEXT_OPS: FilterOperator[] = [
  'equals',
  'notEquals',
  'contains',
  'startsWith',
  'endsWith',
  'in',
  'blank',
  'notBlank',
];
const NUM_OPS: FilterOperator[] = ['eq', 'neq', 'gt', 'lt', 'between', 'in', 'blank', 'notBlank'];
const DATE_OPS: FilterOperator[] = ['eq', 'neq', 'gt', 'lt', 'between', 'blank', 'notBlank'];
const BASIC_OPS: FilterOperator[] = ['equals', 'notEquals', 'in', 'blank', 'notBlank'];

/** The operator list offered for a column type (`LAYER-FILTER-MENU`). */
export function operatorsForType(type: ColumnType | undefined): OperatorMeta[] {
  const list =
    type === 'number'
      ? NUM_OPS
      : type === 'date'
        ? DATE_OPS
        : type === 'text' || type === undefined
          ? TEXT_OPS
          : BASIC_OPS;
  return list.map((op) => OPS[op]);
}

/** `arity` of an operator (0 = no value inputs). */
export function operatorArity(op: FilterOperator): 0 | 1 | 2 {
  return OPS[op]?.arity ?? 1;
}

/**
 * Build a **serializable** `BuiltinFilter` descriptor for a `(type, operator,
 * value[, value2])` — the value the filter menu now emits so it crosses the
 * worker seam and runs OFF-THREAD (`ADR-SORT-FILTER-SEAM`). Returns `null` when
 * the operator needs a value and none was given (**empty value = no filter**).
 */
export function buildColumnFilter(
  type: ColumnType | undefined,
  op: FilterOperator,
  value: string,
  value2 = '',
): BuiltinFilter | null {
  return buildBuiltinFilter(type, op, value, value2);
}

/**
 * Compile a `(type, operator, value[, value2])` straight to a `FilterPredicate`
 * (kept for programmatic use / back-compat). Internally builds a `BuiltinFilter`
 * descriptor and compiles it, so it matches the worker's off-thread behaviour
 * exactly. Returns `null` when the operator needs a value and none was given.
 */
export function buildFilterPredicate(
  type: ColumnType | undefined,
  op: FilterOperator,
  value: string,
  value2 = '',
): FilterPredicate | null {
  const descriptor = buildBuiltinFilter(type, op, value, value2);
  return descriptor ? compileBuiltinFilter(descriptor) : null;
}

/** The current per-column filter descriptor (drives menu pre-fill + the icon "active" state). */
export interface ColumnFilterState {
  operator: FilterOperator;
  value: string;
  value2: string;
}

export interface FilterMenuHost {
  document: Document;
  /** `DOM-ROOT` — theme class source + scroll-container for light-dismiss. */
  root: HTMLElement;
  /** `COMPONENT-I18N` translator for operator labels + menu chrome (optional). */
  t?: Translate;
  columns: readonly ColumnDef[];
  /** Prior descriptor for a column (pre-fills the menu on re-open), if any. */
  getState(columnId: ColumnId): ColumnFilterState | undefined;
  /**
   * Apply the built **serializable** `BuiltinFilter` descriptor for a column (or
   * `null` to clear it). The grid rebuilds the `FilterSpec` and issues
   * `CAP-FILTER`; a fully-built-in spec runs off-thread (`ADR-SORT-FILTER-SEAM`).
   */
  apply(
    columnId: ColumnId,
    filter: ColumnFilter | null,
    descriptor: ColumnFilterState | null,
  ): void;
}

/**
 * `LAYER-FILTER-MENU` controller. One menu at a time; portaled to `document.body`
 * (never inside `role="grid"`), light-dismiss, Esc restores focus to the trigger.
 */
export class FilterMenuController {
  private menu: HTMLElement | undefined;
  private trigger: HTMLElement | undefined;
  private columnId: ColumnId | undefined;
  private opSelect: HTMLSelectElement | undefined;
  private input1: HTMLInputElement | undefined;
  private input2: HTMLInputElement | undefined;
  private readonly onDocPointerDown: (e: Event) => void;
  private readonly onDismiss: () => void;

  constructor(private readonly host: FilterMenuHost) {
    this.onDocPointerDown = (e) => this.handleDocPointerDown(e);
    this.onDismiss = () => this.close(false);
  }

  isOpen(): boolean {
    return this.menu !== undefined;
  }

  /** The column id of the currently open menu (test hook). */
  get openColumnId(): ColumnId | undefined {
    return this.columnId;
  }

  open(columnId: ColumnId, trigger: HTMLElement): void {
    this.close(false);
    const column = this.host.columns.find((c) => c.id === columnId);
    if (!column) return;
    const doc = this.host.document;
    const t = this.host.t ?? defaultTranslate;
    this.columnId = columnId;
    this.trigger = trigger;
    trigger.setAttribute('aria-expanded', 'true');

    const menu = doc.createElement('div');
    menu.className = this.host.root.classList.contains('mg-theme-dark')
      ? 'mg-filter-menu mg-filter-menu--dark'
      : 'mg-filter-menu';
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', t('filter.ariaLabel', { column: column.header ?? column.id }));

    const prior = this.host.getState(columnId);
    const metas = operatorsForType(column.type);

    // Operator select (labeled).
    const opLabel = doc.createElement('label');
    opLabel.append(doc.createTextNode(t('filter.operator')));
    const opSelect = doc.createElement('select');
    opSelect.setAttribute('data-mg-filter-op', '');
    for (const m of metas) {
      const opt = doc.createElement('option');
      opt.value = m.op;
      opt.textContent = t(`filter.op.${m.op}`);
      opSelect.appendChild(opt);
    }
    if (prior && metas.some((m) => m.op === prior.operator)) opSelect.value = prior.operator;
    opLabel.appendChild(opSelect);
    menu.appendChild(opLabel);

    // Value inputs (one or two; hidden for the 0-arity blank/notBlank ops).
    const in1Label = doc.createElement('label');
    in1Label.append(doc.createTextNode(t('filter.value')));
    const input1 = doc.createElement('input');
    input1.type = column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text';
    input1.setAttribute('data-mg-filter-value', '');
    input1.value = prior?.value ?? '';
    in1Label.appendChild(input1);
    menu.appendChild(in1Label);

    const in2Label = doc.createElement('label');
    in2Label.append(doc.createTextNode(t('filter.and')));
    const input2 = doc.createElement('input');
    input2.type = input1.type;
    input2.setAttribute('data-mg-filter-value2', '');
    input2.value = prior?.value2 ?? '';
    in2Label.appendChild(input2);
    menu.appendChild(in2Label);

    const actions = doc.createElement('div');
    actions.className = 'mg-filter-actions';
    const clearBtn = doc.createElement('button');
    clearBtn.type = 'button';
    clearBtn.textContent = t('filter.clear');
    clearBtn.setAttribute('data-mg-filter-clear', '');
    clearBtn.addEventListener('click', () => this.clear());
    const applyBtn = doc.createElement('button');
    applyBtn.type = 'button';
    applyBtn.textContent = t('filter.apply');
    applyBtn.setAttribute('data-mg-filter-apply', '');
    applyBtn.addEventListener('click', () => this.apply());
    actions.appendChild(clearBtn);
    actions.appendChild(applyBtn);
    menu.appendChild(actions);

    const syncArity = (): void => {
      const arity = operatorArity(opSelect.value as FilterOperator);
      in1Label.style.display = arity >= 1 ? '' : 'none';
      in2Label.style.display = arity >= 2 ? '' : 'none';
    };
    opSelect.addEventListener('change', syncArity);
    syncArity();

    menu.addEventListener('keydown', (e) => this.handleMenuKeyDown(e));

    // Position under the trigger (fixed; viewport coords).
    const rect = trigger.getBoundingClientRect();
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.bottom + 2}px`;

    doc.body.appendChild(menu);
    this.menu = menu;
    this.opSelect = opSelect;
    this.input1 = input1;
    this.input2 = input2;

    doc.addEventListener('mousedown', this.onDocPointerDown, true);
    doc.addEventListener('touchstart', this.onDocPointerDown, true);
    this.host.root.querySelector('.mg-scroll')?.addEventListener('scroll', this.onDismiss);

    // A11Y-FILTER-MENU — focus moves to the first control on open.
    opSelect.focus();
  }

  private apply(): void {
    if (!this.columnId || !this.opSelect || !this.input1 || !this.input2) return;
    const column = this.host.columns.find((c) => c.id === this.columnId);
    const op = this.opSelect.value as FilterOperator;
    const value = this.input1.value;
    const value2 = this.input2.value;
    // Emit a SERIALIZABLE `BuiltinFilter` descriptor (never a function) so the
    // filter crosses the worker seam and runs off-thread (`ADR-SORT-FILTER-SEAM`).
    const filter = buildColumnFilter(column?.type, op, value, value2);
    const descriptor: ColumnFilterState | null = filter ? { operator: op, value, value2 } : null;
    const columnId = this.columnId;
    this.close(true);
    this.host.apply(columnId, filter, descriptor);
  }

  private clear(): void {
    if (!this.columnId) return;
    const columnId = this.columnId;
    this.close(true);
    this.host.apply(columnId, null, null);
  }

  private handleMenuKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.close(true);
    } else if (e.key === 'Enter') {
      // Enter on a value input applies (unless the focus is the select, where it
      // just changes options).
      const target = e.target as HTMLElement | null;
      if (target && target.tagName === 'INPUT') {
        e.preventDefault();
        e.stopPropagation();
        this.apply();
      }
    }
  }

  private handleDocPointerDown(e: Event): void {
    if (!this.menu) return;
    const t = e.target;
    if (t instanceof Node && (this.menu.contains(t) || this.trigger?.contains(t))) return;
    this.close(false);
  }

  close(restoreFocus: boolean): void {
    if (!this.menu) return;
    const doc = this.host.document;
    doc.removeEventListener('mousedown', this.onDocPointerDown, true);
    doc.removeEventListener('touchstart', this.onDocPointerDown, true);
    this.host.root.querySelector('.mg-scroll')?.removeEventListener('scroll', this.onDismiss);
    this.menu.remove();
    this.menu = undefined;
    this.opSelect = undefined;
    this.input1 = undefined;
    this.input2 = undefined;
    this.columnId = undefined;
    const trigger = this.trigger;
    this.trigger = undefined;
    if (trigger) {
      trigger.setAttribute('aria-expanded', 'false');
      // A11Y-FILTER-MENU — Esc/apply/clear restore focus to the filter icon.
      if (restoreFocus) trigger.focus();
    }
  }

  destroy(): void {
    this.close(false);
  }
}

export type { FilterContext };
