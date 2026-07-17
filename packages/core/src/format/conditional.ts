/**
 * `COMPONENT-CONDFMT` (`CAP-COND-FMT`) — conditional-rule evaluation.
 *
 * Realizes `ENTITY-CONDITIONAL-RULE` (`id` · `scope: Range[]` · `kind` · `config`
 * · `style?` · `priority`) and the five rule kinds:
 *  1. `value`/`text` — comparison ops (`>` `<` `between` `=` `!=` `contains`
 *     `startsWith` `blank` `topN` `bottomN`) → a `CellStyle`.
 *  2. `colorScale` — 2/3-color gradient over the **full-dataset** min/max → fill.
 *  3. `dataBar` — in-cell proportional bar over the full-dataset range.
 *  4. `iconSet` — thresholds → an icon glyph.
 *  5. `custom` — a `CondFmtPredicate` (`LIB-CONDFMT-PREDICATE`) → `CellStyle|null`.
 *
 * Kinds that need dataset statistics (color scale / data bar / top-N) request
 * aggregates from the worker over the FULL dataset via `MSG-AGGREGATE`
 * (`ADR-CONDFMT-AGG`) and cache them; the cache is dropped + refetched on data
 * change. Rendering of bars/icons is DOM-only (`SEC-RENDERER-DOM-ONLY`) — the
 * renderer draws nodes, never `innerHTML` of untrusted content.
 */
import type {
  CellContext,
  CellStyle,
  ColumnId,
  CondFmtPredicate,
  Range,
} from '../types.js';
import { mergeStyle } from './style-cascade.js';

/** Comparison operators for `value`/`text` rules. */
export type CompareOp =
  | '>'
  | '>='
  | '<'
  | '<='
  | '='
  | '!='
  | 'between'
  | 'contains'
  | 'startsWith'
  | 'blank'
  | 'topN'
  | 'bottomN';

export interface ValueRuleConfig {
  op: CompareOp;
  value?: unknown;
  value2?: unknown;
  /** `topN`/`bottomN` count (default 10). */
  n?: number;
  /** Column whose full-dataset values feed `topN`/`bottomN` (default: the cell's). */
  columnId?: ColumnId;
}

export interface ColorScaleConfig {
  columnId: ColumnId;
  /** Colors for the dataset min and max (2-color scale). */
  min: string;
  max: string;
  /** Optional midpoint color (3-color scale, at fraction 0.5). */
  mid?: string;
}

export interface DataBarConfig {
  columnId: ColumnId;
  color: string;
  negativeColor?: string;
}

export interface IconThreshold {
  /** Lower bound (inclusive): the icon applies when `value >= min`. */
  min: number;
  icon: string;
}

export interface IconSetConfig {
  columnId: ColumnId;
  /** Thresholds; the highest `min` that is `<= value` wins. */
  icons: readonly IconThreshold[];
}

export interface CustomConfig {
  predicate: CondFmtPredicate;
}

export type ConditionalRuleKind =
  | 'value'
  | 'text'
  | 'colorScale'
  | 'dataBar'
  | 'iconSet'
  | 'custom';

export type ConditionalRuleConfig =
  | ValueRuleConfig
  | ColorScaleConfig
  | DataBarConfig
  | IconSetConfig
  | CustomConfig;

/** `ENTITY-CONDITIONAL-RULE`. */
export interface ConditionalRule {
  id: string;
  scope: readonly Range[];
  kind: ConditionalRuleKind;
  config: ConditionalRuleConfig;
  style?: CellStyle;
  priority: number;
}

/** `addConditionalRule(rule)` input — `id`/`scope`/`priority` optional. */
export interface ConditionalRuleInput {
  id?: string;
  scope?: readonly Range[];
  kind: ConditionalRuleKind;
  config: ConditionalRuleConfig;
  style?: CellStyle;
  priority?: number;
}

/** In-cell proportional bar decoration (drawn as a DOM node). */
export interface DataBarDecoration {
  /** `[0,1]` proportion of the cell width. */
  fraction: number;
  color: string;
  negative: boolean;
}

/** The conditional contribution for one cell. */
export interface ConditionalResult {
  style: CellStyle | null;
  dataBar?: DataBarDecoration;
  icon?: string;
}

/** `MSG-AGGREGATE` operation kinds. */
export type AggregateKind = 'min' | 'max' | 'topN';

/**
 * Fetches a full-dataset aggregate from the worker (`MSG-AGGREGATE`). `topN`
 * with a NEGATIVE `n` requests the bottom `|n|` (ascending) for `bottomN` rules.
 */
export type AggregateFetcher = (
  columnId: ColumnId,
  kind: AggregateKind,
  n?: number,
) => Promise<number | number[]>;

const DEFAULT_TOP_N = 10;

interface AggregateNeed {
  key: string;
  columnId: ColumnId;
  kind: AggregateKind;
  n?: number;
}

export class ConditionalFormatEngine {
  private readonly rules: ConditionalRule[] = [];
  // P2 (PERF-CELL-PATH): `rules` in priority order, rebuilt only when the rule set
  // changes — so per-cell `evaluate` neither `.filter`-allocates nor re-`.sort`s.
  // `getRules()` still returns `rules` in insertion order (unchanged behavior).
  private sortedRules: ConditionalRule[] = [];
  private sortedDirty = true;
  private readonly aggCache = new Map<string, number | number[]>();
  private seq = 0;

  constructor(
    private readonly fetchAggregate: AggregateFetcher,
    /** Called when cached aggregates change so the cascade memo is invalidated. */
    private readonly onInvalidate: () => void = () => {},
  ) {}

  /** `LIB-COND-FMT.addConditionalRule` — register a rule; returns its `{ id }`. */
  add(input: ConditionalRuleInput): { id: string } {
    const id = input.id ?? `cond${++this.seq}`;
    const rule: ConditionalRule = {
      id,
      kind: input.kind,
      config: input.config,
      scope: input.scope ?? [],
      priority: input.priority ?? this.rules.length,
      ...(input.style !== undefined ? { style: input.style } : {}),
    };
    this.rules.push(rule);
    this.sortedDirty = true;
    return { id };
  }

  /** `LIB-COND-FMT.removeConditionalRule`. */
  remove(id: string): void {
    const i = this.rules.findIndex((r) => r.id === id);
    if (i >= 0) {
      this.rules.splice(i, 1);
      this.sortedDirty = true;
    }
  }

  clear(): void {
    this.rules.length = 0;
    this.sortedDirty = true;
    this.aggCache.clear();
  }

  getRules(): readonly ConditionalRule[] {
    return this.rules;
  }

  hasRules(): boolean {
    return this.rules.length > 0;
  }

  /**
   * Fetch + cache every aggregate the current rules need (await for
   * determinism). Invalidates the cascade if any value was newly cached.
   */
  async prime(): Promise<void> {
    let changed = false;
    for (const need of this.neededAggregates()) {
      if (!this.aggCache.has(need.key)) {
        const res = await this.fetchAggregate(need.columnId, need.kind, need.n);
        this.aggCache.set(need.key, res);
        changed = true;
      }
    }
    if (changed) this.onInvalidate();
  }

  /** Data changed: drop cached aggregates and re-prime (`ADR-CONDFMT-AGG`). */
  async onDataChanged(): Promise<void> {
    this.aggCache.clear();
    await this.prime();
    this.onInvalidate();
  }

  /** Synchronous per-cell evaluation using the cached aggregates. */
  evaluate(ctx: CellContext): ConditionalResult {
    // P2: iterate the priority-sorted rules in place (ascending priority → higher
    // priority applied LAST → wins per property), rebuilt only when rules change.
    // No per-cell `.filter` allocation and no per-cell `.sort`.
    if (this.sortedDirty) {
      this.sortedRules = [...this.rules].sort((a, b) => a.priority - b.priority);
      this.sortedDirty = false;
    }
    const rules = this.sortedRules;

    let style: CellStyle | null = null;
    let dataBar: DataBarDecoration | undefined;
    let icon: string | undefined;
    let matched = false;
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i] as ConditionalRule;
      if (!inScope(rule.scope, ctx.rowIndex, ctx.colIndex)) continue;
      matched = true;
      const r = this.applyRule(rule, ctx);
      if (r.style) style = style ? mergeStyle(style, r.style) : { ...r.style };
      if (r.dataBar) dataBar = r.dataBar;
      if (r.icon !== undefined) icon = r.icon;
    }
    if (!matched) return { style: null };
    return {
      style,
      ...(dataBar ? { dataBar } : {}),
      ...(icon !== undefined ? { icon } : {}),
    };
  }

  // --- per-kind evaluation --------------------------------------------------

  private applyRule(rule: ConditionalRule, ctx: CellContext): ConditionalResult {
    switch (rule.kind) {
      case 'value':
      case 'text':
        return this.applyValueRule(rule, ctx);
      case 'colorScale':
        return this.applyColorScale(rule.config as ColorScaleConfig, ctx);
      case 'dataBar':
        return this.applyDataBar(rule.config as DataBarConfig, ctx);
      case 'iconSet':
        return this.applyIconSet(rule.config as IconSetConfig, ctx);
      case 'custom':
        return { style: (rule.config as CustomConfig).predicate(ctx) };
    }
  }

  private applyValueRule(rule: ConditionalRule, ctx: CellContext): ConditionalResult {
    const cfg = rule.config as ValueRuleConfig;
    const match = this.matchesOp(cfg, ctx);
    return { style: match ? rule.style ?? null : null };
  }

  private matchesOp(cfg: ValueRuleConfig, ctx: CellContext): boolean {
    const v = ctx.value;
    switch (cfg.op) {
      case 'blank':
        return v == null || v === '';
      case 'contains':
        return typeof v === 'string' && v.includes(String(cfg.value));
      case 'startsWith':
        return typeof v === 'string' && v.startsWith(String(cfg.value));
      case '=':
        return looseEq(v, cfg.value);
      case '!=':
        return !looseEq(v, cfg.value);
      case 'topN':
      case 'bottomN': {
        const n = cfg.n ?? DEFAULT_TOP_N;
        const columnId = cfg.columnId ?? ctx.columnId;
        const arr = this.agg(columnId, 'topN', cfg.op === 'bottomN' ? -n : n);
        const num = num0(v);
        if (num === undefined || !Array.isArray(arr) || arr.length === 0) return false;
        // `arr` is the N extreme values; the threshold is its least-extreme end.
        const threshold = arr[arr.length - 1] as number;
        return cfg.op === 'topN' ? num >= threshold : num <= threshold;
      }
      default: {
        const num = num0(v);
        const a = num0(cfg.value);
        if (num === undefined || a === undefined) return false;
        switch (cfg.op) {
          case '>':
            return num > a;
          case '>=':
            return num >= a;
          case '<':
            return num < a;
          case '<=':
            return num <= a;
          case 'between': {
            const b = num0(cfg.value2);
            if (b === undefined) return false;
            const lo = Math.min(a, b);
            const hi = Math.max(a, b);
            return num >= lo && num <= hi;
          }
        }
      }
    }
    return false;
  }

  private applyColorScale(cfg: ColorScaleConfig, ctx: CellContext): ConditionalResult {
    const num = num0(ctx.value);
    const min = this.agg(cfg.columnId, 'min');
    const max = this.agg(cfg.columnId, 'max');
    if (num === undefined || typeof min !== 'number' || typeof max !== 'number') {
      return { style: null };
    }
    const fraction = max === min ? 0 : clamp01((num - min) / (max - min));
    const color = cfg.mid
      ? interpolate3(cfg.min, cfg.mid, cfg.max, fraction)
      : interpolate(cfg.min, cfg.max, fraction);
    return { style: { fillColor: color } };
  }

  private applyDataBar(cfg: DataBarConfig, ctx: CellContext): ConditionalResult {
    const num = num0(ctx.value);
    const min = this.agg(cfg.columnId, 'min');
    const max = this.agg(cfg.columnId, 'max');
    if (num === undefined || typeof min !== 'number' || typeof max !== 'number') {
      return { style: null };
    }
    // Baseline at 0 when the range spans negatives, else at the dataset min.
    const base = min < 0 ? 0 : min;
    const span = Math.max(Math.abs(max), Math.abs(base), 1) - Math.min(min, 0);
    const fraction = span <= 0 ? 0 : clamp01(Math.abs(num - base) / span);
    const negative = num < base;
    return {
      style: null,
      dataBar: {
        fraction,
        color: negative ? cfg.negativeColor ?? cfg.color : cfg.color,
        negative,
      },
    };
  }

  private applyIconSet(cfg: IconSetConfig, ctx: CellContext): ConditionalResult {
    const num = num0(ctx.value);
    if (num === undefined) return { style: null };
    let icon: string | undefined;
    let best = -Infinity;
    for (const t of cfg.icons) {
      if (num >= t.min && t.min >= best) {
        best = t.min;
        icon = t.icon;
      }
    }
    return { style: null, ...(icon !== undefined ? { icon } : {}) };
  }

  // --- aggregate cache ------------------------------------------------------

  private agg(columnId: ColumnId, kind: AggregateKind, n?: number): number | number[] | undefined {
    return this.aggCache.get(aggKey(columnId, kind, n));
  }

  /** The distinct aggregates the current rule set requires. */
  private neededAggregates(): AggregateNeed[] {
    const out = new Map<string, AggregateNeed>();
    const want = (columnId: ColumnId, kind: AggregateKind, n?: number): void => {
      const key = aggKey(columnId, kind, n);
      if (!out.has(key)) out.set(key, { key, columnId, kind, ...(n !== undefined ? { n } : {}) });
    };
    for (const rule of this.rules) {
      if (rule.kind === 'colorScale' || rule.kind === 'dataBar') {
        const columnId = (rule.config as ColorScaleConfig | DataBarConfig).columnId;
        want(columnId, 'min');
        want(columnId, 'max');
      } else if (rule.kind === 'value' || rule.kind === 'text') {
        const cfg = rule.config as ValueRuleConfig;
        if (cfg.op === 'topN' || cfg.op === 'bottomN') {
          const n = cfg.n ?? DEFAULT_TOP_N;
          if (cfg.columnId) want(cfg.columnId, 'topN', cfg.op === 'bottomN' ? -n : n);
        }
      }
    }
    return [...out.values()];
  }
}

function aggKey(columnId: ColumnId, kind: AggregateKind, n?: number): string {
  return `${columnId} ${kind} ${n ?? ''}`;
}

/** A cell is in scope when the scope is empty (whole grid) or a range covers it. */
export function inScope(scope: readonly Range[], row: number, col: number): boolean {
  if (scope.length === 0) return true;
  for (const r of scope) {
    if (row >= r.top && row <= r.bottom && col >= r.left && col <= r.right) return true;
  }
  return false;
}

function num0(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function looseEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const na = num0(a);
  const nb = num0(b);
  if (na !== undefined && nb !== undefined) return na === nb;
  return String(a) === String(b);
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// --- color interpolation (hex → rgb → hex) ----------------------------------

interface Rgb {
  r: number;
  g: number;
  b: number;
}

// P4 (PERF-CELL-PATH): color-scale `interpolate` runs per visible cell and re-parses
// the SAME static config colors each time. Memoize the parse — the returned `Rgb` is
// only ever read (never mutated) by `interpolate`, so sharing it is safe. Key space =
// the config's distinct hex colors (tiny).
const hexCache = new Map<string, Rgb>();

function parseHex(hex: string): Rgb {
  let rgb = hexCache.get(hex);
  if (rgb === undefined) {
    rgb = parseHexUncached(hex);
    hexCache.set(hex, rgb);
  }
  return rgb;
}

function parseHexUncached(hex: string): Rgb {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (!Number.isFinite(n) || h.length !== 6) return { r: 0, g: 0, b: 0 };
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

function toHex(c: Rgb): string {
  const h = (x: number): string => Math.round(clampByte(x)).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

function clampByte(x: number): number {
  return x < 0 ? 0 : x > 255 ? 255 : x;
}

/** Linear interpolation between two hex colors at fraction `t ∈ [0,1]`. */
export function interpolate(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  return toHex({
    r: ca.r + (cb.r - ca.r) * t,
    g: ca.g + (cb.g - ca.g) * t,
    b: ca.b + (cb.b - ca.b) * t,
  });
}

/** 3-color scale: `min → mid` over `[0,0.5]`, `mid → max` over `[0.5,1]`. */
export function interpolate3(min: string, mid: string, max: string, t: number): string {
  return t <= 0.5 ? interpolate(min, mid, t / 0.5) : interpolate(mid, max, (t - 0.5) / 0.5);
}
