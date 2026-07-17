/**
 * `CAP-HEADER` (v1.3) — resolves the public `HeaderConfig` (`LIB-OPTIONS.header`)
 * into a concrete internal plan the renderer paints (`DOM-HEADER` bands,
 * `DOM-ROWHEADER` gutter, `DOM-CORNER`). A **developer-populated** region with NO
 * imposed hierarchy: per-cell content + spans come from a `HeaderRenderer`.
 *
 * Config-time validation runs the column-header renderers once to compute spans
 * and build an occupancy grid; an **overlapping** or **out-of-bounds** span throws
 * `INVALID_OPTIONS` (`AC-HEADER-CONFIG`). Row-header content is row-dependent, so
 * it is resolved lazily per visible row at render time.
 */
import type { ColumnDef } from '../api/options.js';
import type {
  HeaderConfig,
  HeaderRenderContext,
  HeaderRenderResult,
  RowData,
  RowKey,
} from '../types.js';
import { GridError } from '../errors.js';

/** Default column-header band height (px) when `header.columns.height` is unset. */
const DEFAULT_BAND_HEIGHT = 28;
/** Default row-header band width (px) when `header.rows.width` is unset. */
const DEFAULT_ROWHEADER_WIDTH = 48;

/** A resolved, paint-ready column-header cell (span-aware). */
export interface ColumnHeaderCell {
  band: number;
  colIndex: number;
  colSpan: number;
  rowSpan: number;
  content: string | Node;
}

/** The resolved column-header band plan (`DOM-HEADER`). */
export interface ColumnHeaderPlan {
  bands: number;
  /** Per-band height px (length = `bands`). */
  heights: number[];
  /** 0-based band carrying the sort/filter/resize affordances (`bands - 1` default). */
  affordanceBand: number;
  /** Multi-line / wrapping labels. */
  wrap: boolean;
  /** The visible (non-covered) header cells with their spans + content. */
  cells: ColumnHeaderCell[];
}

/** The resolved row-header gutter plan (`DOM-ROWHEADER`). Absent = no gutter. */
export interface RowHeaderPlan {
  bands: number;
  /** Per-band width px (length = `bands`). */
  widths: number[];
  /** Total gutter width px (sum of `widths`). */
  totalWidth: number;
  /** Drag-resizable width. */
  resizable: boolean;
  /** Click a gutter cell → line-select the whole row. */
  select: boolean;
  /** Per-cell content resolver (row-dependent). */
  content(band: number, rowIndex: number, rowKey: RowKey, data?: RowData): string | Node;
}

/** The resolved corner plan (`DOM-CORNER`). Absent unless both axes exist. */
export interface CornerPlan {
  /** Click → select-all. */
  selectAll: boolean;
  /** Developer content (or `undefined` = empty). */
  render?: () => string | Node;
}

/** The full resolved header region. */
export interface HeaderPlan {
  columns: ColumnHeaderPlan;
  rows?: RowHeaderPlan;
  corner?: CornerPlan;
  /** Whether `ColumnDef.headerTooltip` tooltips are enabled. */
  tooltips: boolean;
}

/** Options that influence resolution (feature gates + default band height). */
export interface HeaderResolveOpts {
  /** `rowHeader` feature flag — off suppresses the gutter even when configured. */
  rowHeaderEnabled: boolean;
  /** `headerResize` feature flag — off suppresses band/width drag-resize. */
  headerResizeEnabled: boolean;
  /** Default band height (grid row height). */
  defaultBandHeight?: number;
}

/** Coerce `HeaderRenderResult` to `{ content, colSpan, rowSpan }`. */
function normalizeResult(r: HeaderRenderResult): {
  content: string | Node;
  colSpan: number;
  rowSpan: number;
} {
  if (r != null && typeof r === 'object' && 'content' in (r as object)) {
    const o = r as { content: string | Node; colSpan?: number; rowSpan?: number };
    return {
      content: o.content,
      colSpan: Math.max(1, Math.floor(o.colSpan ?? 1)),
      rowSpan: Math.max(1, Math.floor(o.rowSpan ?? 1)),
    };
  }
  return { content: r as string | Node, colSpan: 1, rowSpan: 1 };
}

/** Expand a `number | number[]` size spec to an array of length `bands`. */
function sizeArray(
  spec: number | number[] | undefined,
  bands: number,
  fallback: number,
): number[] {
  if (Array.isArray(spec)) {
    return Array.from({ length: bands }, (_, i) => spec[i] ?? spec[spec.length - 1] ?? fallback);
  }
  const v = typeof spec === 'number' ? spec : fallback;
  return Array.from({ length: bands }, () => v);
}

/**
 * Resolve + validate a `HeaderConfig` into a paint-ready `HeaderPlan`. Throws
 * `INVALID_OPTIONS` on a malformed config or an overlapping/out-of-bounds
 * column-header span (`AC-HEADER-CONFIG`).
 */
export function resolveHeaderConfig(
  config: HeaderConfig | undefined,
  columns: readonly ColumnDef[],
  opts: HeaderResolveOpts,
): HeaderPlan {
  const cfg = config ?? {};
  const colCfg = cfg.columns ?? {};
  const bands = Math.max(1, Math.floor(colCfg.bands ?? 1));
  const defaultBandHeight = opts.defaultBandHeight ?? DEFAULT_BAND_HEIGHT;
  const heights = sizeArray(colCfg.height, bands, defaultBandHeight);
  const affordanceBand =
    colCfg.affordances === undefined || colCfg.affordances === 'bottom'
      ? bands - 1
      : clampBand(colCfg.affordances, bands);
  const wrap = colCfg.wrap === true;
  const sharedRender = colCfg.render;
  const colCount = columns.length;

  // --- Column-header band plan + span validation --------------------------
  const occupied: boolean[][] = Array.from({ length: bands }, () =>
    Array.from({ length: colCount }, () => false),
  );
  const cells: ColumnHeaderCell[] = [];
  for (let band = 0; band < bands; band++) {
    for (let c = 0; c < colCount; c++) {
      if (occupied[band]![c]) continue; // covered by an earlier span
      const col = columns[c] as ColumnDef;
      const render = col.headerRender ?? sharedRender;
      let content: string | Node;
      let colSpan = 1;
      let rowSpan = 1;
      if (render) {
        const ctx: HeaderRenderContext = {
          axis: 'column',
          band,
          columnId: col.id,
          colIndex: c,
        };
        const norm = normalizeResult(render(ctx));
        content = norm.content;
        colSpan = norm.colSpan;
        rowSpan = norm.rowSpan;
      } else {
        // Built-in helper: the `header ?? id` label on the primary/affordance band
        // only; other bands are empty (no imposed hierarchy).
        content = band === affordanceBand ? col.header ?? col.id : '';
      }
      // Out-of-bounds span → INVALID_OPTIONS.
      if (band + rowSpan > bands || c + colSpan > colCount) {
        throw new GridError(
          'INVALID_OPTIONS',
          `header column span out of bounds at band ${band}, column ${c}`,
          { source: 'config', context: { columnIndex: c } },
        );
      }
      // Claim the covered region; a collision with an earlier span → overlap.
      for (let br = band; br < band + rowSpan; br++) {
        for (let cc = c; cc < c + colSpan; cc++) {
          if (occupied[br]![cc]) {
            throw new GridError(
              'INVALID_OPTIONS',
              `header column span overlaps at band ${br}, column ${cc}`,
              { source: 'config', context: { columnIndex: cc } },
            );
          }
          occupied[br]![cc] = true;
        }
      }
      cells.push({ band, colIndex: c, colSpan, rowSpan, content });
    }
  }

  const columnPlan: ColumnHeaderPlan = { bands, heights, affordanceBand, wrap, cells };

  // --- Row-header gutter plan --------------------------------------------
  let rowPlan: RowHeaderPlan | undefined;
  const rowsCfg = cfg.rows;
  if (rowsCfg && opts.rowHeaderEnabled) {
    const rBands = Math.max(1, Math.floor(rowsCfg.bands ?? 1));
    const widths = sizeArray(rowsCfg.width, rBands, DEFAULT_ROWHEADER_WIDTH);
    const totalWidth = widths.reduce((a, b) => a + b, 0);
    const contentSpec = rowsCfg.content ?? 'number';
    const select = rowsCfg.select ?? true;
    const resizable = (rowsCfg.resizable ?? false) && opts.headerResizeEnabled;
    const contentFn: RowHeaderPlan['content'] = (band, rowIndex, rowKey, data) => {
      if (contentSpec === 'number') return String(rowIndex + 1);
      if (contentSpec === 'key') return String(rowKey);
      const ctx: HeaderRenderContext = {
        axis: 'row',
        band,
        rowKey,
        rowIndex,
        ...(data ? { data } : {}),
      };
      return normalizeResult(contentSpec(ctx)).content;
    };
    rowPlan = { bands: rBands, widths, totalWidth, resizable, select, content: contentFn };
  }

  // --- Corner plan (present only when both axes exist) --------------------
  let cornerPlan: CornerPlan | undefined;
  if (rowPlan) {
    const cornerCfg = cfg.corner ?? {};
    cornerPlan = {
      selectAll: cornerCfg.selectAll ?? true,
      ...(cornerCfg.render
        ? {
            render: (): string | Node =>
              normalizeResult(cornerCfg.render!({ axis: 'column', band: 0 })).content,
          }
        : {}),
    };
  }

  const anyTooltip = columns.some((c) => c.headerTooltip !== undefined);
  const tooltips = cfg.tooltips ?? anyTooltip;

  return {
    columns: columnPlan,
    ...(rowPlan ? { rows: rowPlan } : {}),
    ...(cornerPlan ? { corner: cornerPlan } : {}),
    tooltips,
  };
}

function clampBand(band: number, bands: number): number {
  const b = Math.floor(band);
  if (!Number.isFinite(b) || b < 0) return bands - 1;
  return Math.min(b, bands - 1);
}
