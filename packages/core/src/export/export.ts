/**
 * `COMPONENT-EXPORT` (`CAP-EXPORT`, `LIB-EXPORT`) — CSV + styled-xlsx export.
 *
 * - `exportCsv(opts?)` — dependency-free. Serializes the current sorted/filtered
 *   view (or the full dataset with `opts.allData`) to RFC-4180 CSV, applying
 *   `SEC-EXPORT-FORMULA-GUARD` (default on). Returns a `text/csv` `Blob`.
 * - `exportXlsx(opts?)` — **lazy-loads exceljs** via a dynamic `import()`
 *   (`DEP-XLSX`, injected as `loadExcel` so it is fail-soft + test-fakeable). If
 *   the import is absent/fails → rejects `XLSX_UNAVAILABLE` (+ `EVT-ERROR`); CSV
 *   is unaffected. Maps the resolved grid state to a workbook per the Integrations
 *   data-mapping table (value/type, `formatMask`→`numFmt`, `CellStyle`→
 *   font/fill/border/alignment, `MERGE-REGION`→`mergeCells`, `FREEZE-PANE`→
 *   frozen `views`, column width). Serialization failures → `EXPORT_FAILED`.
 */
import { GridError } from '../errors.js';
import { getByPath } from '../util/path.js';
import type {
  CellContext,
  CellStyle,
  ColumnId,
  ColumnType,
  FormatterFn,
  FreezePane,
  MergeRegion,
  RowData,
  RowKey,
} from '../types.js';
import { guardFormula } from './formula-guard.js';

export const CSV_MIME = 'text/csv';
export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Columns as the exporter needs them (a projection of the live `ColumnDef`). */
export interface ExportColumn {
  id: ColumnId;
  field: string;
  header?: string;
  width?: number;
  type?: ColumnType;
  formatMask?: string | FormatterFn;
}

export interface ExportRow {
  key: RowKey;
  data: RowData;
}

/** Options accepted by `exportCsv` / `exportXlsx`. */
export interface ExportOptions {
  /** Export the full dataset instead of the current sorted/filtered view. */
  allData?: boolean;
  /** `SEC-EXPORT-FORMULA-GUARD` — neutralize formula-leading values. Default `true`. */
  sanitizeFormulas?: boolean;
}

/** The grid-side seam the exporter reads through (`COMPONENT-EXPORT` host). */
export interface ExportHost {
  /** Live column model, in display order. */
  columns(): readonly ExportColumn[];
  /** Rows of the current view (or the full dataset when `allData`). */
  getRows(allData: boolean): Promise<readonly ExportRow[]>;
  /** Resolved per-cell style (`PATTERN-STYLE-CASCADE`), when formatting is on. */
  resolveStyle?(ctx: CellContext): CellStyle | undefined;
  /** Freeze pane (`ENTITY-FREEZE-PANE`) → xlsx frozen views. */
  getFrozen(): FreezePane;
  /** Merge regions (`ENTITY-MERGE-REGION`) → `worksheet.mergeCells`. */
  getMerges(): readonly MergeRegion[];
  /** `DEP-XLSX` lazy loader — a dynamic `import('exceljs')` (fail-soft/fakeable). */
  loadExcel(): Promise<unknown>;
  /** `EVT-ERROR` sink for export-source errors (`PATTERN-ERROR`). */
  emitError(err: GridError): void;
}

const headerOf = (c: ExportColumn): string => c.header ?? c.id;

export class ExportController {
  constructor(private readonly host: ExportHost) {}

  /** `LIB-EXPORT.exportCsv` — RFC-4180 CSV of the view (or full dataset). */
  async exportCsv(opts?: ExportOptions): Promise<Blob> {
    const sanitize = opts?.sanitizeFormulas !== false;
    const allData = opts?.allData === true;
    const cols = this.host.columns();
    let text: string;
    try {
      const rows = await this.host.getRows(allData);
      text = buildCsv(cols, rows, sanitize);
    } catch (err) {
      throw this.fail(err);
    }
    return new Blob([text], { type: CSV_MIME });
  }

  /** `LIB-EXPORT.exportXlsx` — styled `.xlsx` via lazy exceljs (`DEP-XLSX`). */
  async exportXlsx(opts?: ExportOptions): Promise<Blob> {
    const sanitize = opts?.sanitizeFormulas !== false;
    const allData = opts?.allData === true;

    // Fail-soft dynamic import (`DEP-XLSX`): absent/import-fail → XLSX_UNAVAILABLE.
    let mod: unknown;
    try {
      mod = await this.host.loadExcel();
    } catch {
      throw this.unavailable();
    }
    const ExcelJS = resolveExcelNamespace(mod);
    if (!ExcelJS || typeof ExcelJS.Workbook !== 'function') {
      throw this.unavailable();
    }

    try {
      const cols = this.host.columns();
      const rows = await this.host.getRows(allData);
      return await this.buildXlsx(ExcelJS, cols, rows, sanitize);
    } catch (err) {
      if (err instanceof GridError) {
        this.host.emitError(err);
        throw err;
      }
      throw this.fail(err);
    }
  }

  private unavailable(): GridError {
    const err = new GridError(
      'XLSX_UNAVAILABLE',
      'xlsx export requires the optional "exceljs" dependency, which failed to load',
      { source: 'export' },
    );
    this.host.emitError(err);
    return err;
  }

  private fail(cause: unknown): GridError {
    const message = cause instanceof Error ? cause.message : String(cause);
    const err = new GridError('EXPORT_FAILED', `export serialization failed: ${message}`, {
      source: 'export',
    });
    this.host.emitError(err);
    return err;
  }

  /** Map the resolved grid state to an exceljs workbook (data-mapping table). */
  private async buildXlsx(
    ExcelJS: ExcelNamespace,
    cols: readonly ExportColumn[],
    rows: readonly ExportRow[],
    sanitize: boolean,
  ): Promise<Blob> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');

    // Header row (1) + column widths (`column.width`).
    cols.forEach((c, ci) => {
      const n = ci + 1;
      if (c.width !== undefined) ws.getColumn(n).width = c.width;
      const hcell = ws.getCell(1, n);
      hcell.value = headerOf(c);
      hcell.font = { bold: true };
    });

    // Data rows start at row 2.
    rows.forEach((row, ri) => {
      const rn = ri + 2;
      cols.forEach((c, ci) => {
        const cn = ci + 1;
        const raw = getByPath(row.data, c.field);
        const cell = ws.getCell(rn, cn);
        // Value + type (guarded strings; typed numbers/dates/booleans pass through).
        cell.value = guardFormula(raw, sanitize) as XlsxValue;
        // formatMask → numFmt (string masks only; a FormatterFn has no numFmt).
        const numFmt = maskToNumFmt(c.formatMask);
        if (numFmt) cell.numFmt = numFmt;
        // Resolved CellStyle → font / fill / border / alignment.
        if (this.host.resolveStyle) {
          const ctx: CellContext = {
            rowKey: row.key,
            columnId: c.id,
            field: c.field,
            value: raw,
            data: row.data,
            rowIndex: ri,
            colIndex: ci,
          };
          applyXlsxStyle(cell, this.host.resolveStyle(ctx));
        }
      });
    });

    // MERGE-REGION → mergeCells (offset by the header row).
    for (const m of this.host.getMerges()) {
      ws.mergeCells(m.range.top + 2, m.range.left + 1, m.range.bottom + 2, m.range.right + 1);
    }

    // FREEZE-PANE → frozen views (freeze the header row + any frozen rows/cols).
    const frozen = this.host.getFrozen();
    ws.views = [
      { state: 'frozen', xSplit: frozen.cols, ySplit: frozen.rows + 1 },
    ];

    const buffer = await wb.xlsx.writeBuffer();
    return new Blob([buffer as BlobPart], { type: XLSX_MIME });
  }
}

// ===========================================================================
// CSV (RFC-4180)
// ===========================================================================

function buildCsv(
  cols: readonly ExportColumn[],
  rows: readonly ExportRow[],
  sanitize: boolean,
): string {
  const lines: string[] = [];
  // Header row (developer-supplied — escaped but not formula-guarded).
  lines.push(cols.map((c) => csvEscape(headerOf(c))).join(','));
  for (const row of rows) {
    const fields = cols.map((c) => {
      const guarded = guardFormula(getByPath(row.data, c.field), sanitize);
      return csvEscape(stringifyCsv(guarded));
    });
    lines.push(fields.join(','));
  }
  // RFC-4180 record separator.
  return lines.join('\r\n');
}

/** Stringify a (possibly already formula-guarded) cell value for CSV. */
function stringifyCsv(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/** RFC-4180 escaping: quote fields containing `"`, `,`, CR, or LF; double `"`. */
function csvEscape(field: string): string {
  if (/[",\r\n]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

// ===========================================================================
// xlsx style / value mapping
// ===========================================================================

/** Known value-format masks → Excel number-format codes; unknown masks pass through. */
export function maskToNumFmt(mask: string | FormatterFn | undefined): string | undefined {
  if (typeof mask !== 'string' || mask.length === 0) return undefined;
  if (mask === 'number') return '#,##0.###';
  if (mask === 'percent') return '0.00%';
  if (mask === 'date') return 'yyyy-mm-dd';
  if (mask.startsWith('currency')) return '"$"#,##0.00';
  // Treat any other non-empty mask string as a literal Excel number format.
  return mask;
}

const H_ALIGN: Record<string, 'left' | 'center' | 'right'> = {
  start: 'left',
  center: 'center',
  end: 'right',
};
const V_ALIGN: Record<string, 'top' | 'middle' | 'bottom'> = {
  top: 'top',
  middle: 'middle',
  bottom: 'bottom',
};
const BORDER_STYLE: Record<string, string> = {
  thin: 'thin',
  medium: 'medium',
  thick: 'thick',
  dashed: 'dashed',
  dotted: 'dotted',
};

/** Apply a resolved `CellStyle` onto an exceljs cell (font/fill/border/alignment). */
function applyXlsxStyle(cell: XlsxCell, style: CellStyle | undefined): void {
  if (!style) return;

  const font: Record<string, unknown> = {};
  if (style.textColor) font.color = { argb: cssToArgb(style.textColor) };
  if (style.fontFamily) font.name = style.fontFamily;
  if (style.fontSize !== undefined) font.size = style.fontSize;
  if (style.fontWeight === 'bold' || (typeof style.fontWeight === 'number' && style.fontWeight >= 700)) {
    font.bold = true;
  }
  if (style.italic) font.italic = true;
  if (style.underline) font.underline = true;
  if (Object.keys(font).length > 0) {
    cell.font = { ...(cell.font as object | undefined), ...font };
  }

  if (style.fillColor) {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: cssToArgb(style.fillColor) },
    };
  }

  if (style.borders) {
    const border: Record<string, unknown> = {};
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const b = style.borders[side];
      if (b) {
        border[side] = { style: BORDER_STYLE[b.style] ?? 'thin', color: { argb: cssToArgb(b.color) } };
      }
    }
    if (Object.keys(border).length > 0) cell.border = border;
  }

  const alignment: Record<string, unknown> = {};
  if (style.align?.h) alignment.horizontal = H_ALIGN[style.align.h] ?? style.align.h;
  if (style.align?.v) alignment.vertical = V_ALIGN[style.align.v] ?? style.align.v;
  if (style.wrap) alignment.wrapText = true;
  if (style.indent !== undefined) alignment.indent = style.indent;
  if (Object.keys(alignment).length > 0) cell.alignment = alignment;
}

/** Convert a CSS color (`#rgb`, `#rrggbb`, `rgb(r,g,b)`) to exceljs `AARRGGBB`. */
export function cssToArgb(color: string): string {
  const c = color.trim();
  let hex: string | undefined;
  if (/^#[0-9a-fA-F]{6}$/.test(c)) {
    hex = c.slice(1);
  } else if (/^#[0-9a-fA-F]{3}$/.test(c)) {
    hex = c
      .slice(1)
      .split('')
      .map((ch) => ch + ch)
      .join('');
  } else {
    const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(c);
    if (m) {
      hex = [m[1], m[2], m[3]]
        .map((n) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0'))
        .join('');
    }
  }
  return `FF${(hex ?? '000000').toUpperCase()}`;
}

// ===========================================================================
// Minimal structural typings for the exceljs surface we touch (kept local so
// core carries no static dependency on exceljs — DEP-XLSX is lazy/optional).
// ===========================================================================

type XlsxValue = string | number | boolean | Date | null;

interface XlsxCell {
  value: XlsxValue;
  numFmt?: string;
  font?: unknown;
  fill?: unknown;
  border?: unknown;
  alignment?: unknown;
}

interface XlsxColumn {
  width?: number;
}

interface XlsxWorksheet {
  getCell(row: number, col: number): XlsxCell;
  getColumn(col: number): XlsxColumn;
  mergeCells(top: number, left: number, bottom: number, right: number): void;
  views: unknown;
}

interface XlsxWorkbook {
  addWorksheet(name: string): XlsxWorksheet;
  xlsx: { writeBuffer(): Promise<ArrayBuffer | Uint8Array> };
}

interface ExcelNamespace {
  Workbook: new () => XlsxWorkbook;
}

/** Unwrap `import('exceljs')` (ESM default / namespace / CJS) to the exceljs namespace. */
function resolveExcelNamespace(mod: unknown): ExcelNamespace | undefined {
  if (!mod || (typeof mod !== 'object' && typeof mod !== 'function')) return undefined;
  const m = mod as Record<string, unknown>;
  if (typeof m.Workbook === 'function') return m as unknown as ExcelNamespace;
  const def = m.default as Record<string, unknown> | undefined;
  if (def && typeof def.Workbook === 'function') return def as unknown as ExcelNamespace;
  return undefined;
}
