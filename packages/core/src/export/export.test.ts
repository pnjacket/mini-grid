// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { createGrid } from '../api/grid.js';
import type { ColumnDef } from '../api/options.js';
import type { GridError } from '../errors.js';

// ---------------------------------------------------------------------------
// Fake exceljs (fidelity substitution — DEP-XLSX faked in unit tests). Records
// the mapping calls so AC-XLSX-MAPPING can assert value/numFmt/font/fill/border/
// alignment/merges/frozen/width without the real dependency.
// ---------------------------------------------------------------------------
class FakeCell {
  value: unknown = null;
  numFmt: string | undefined;
  font: unknown;
  fill: unknown;
  border: unknown;
  alignment: unknown;
}
class FakeColumn {
  width: number | undefined;
}
class FakeWorksheet {
  name: string;
  cells = new Map<string, FakeCell>();
  cols = new Map<number, FakeColumn>();
  merges: Array<[number, number, number, number]> = [];
  views: unknown;
  constructor(name: string) {
    this.name = name;
  }
  getCell(row: number, col: number): FakeCell {
    const k = `${row}:${col}`;
    let cell = this.cells.get(k);
    if (!cell) {
      cell = new FakeCell();
      this.cells.set(k, cell);
    }
    return cell;
  }
  getColumn(col: number): FakeColumn {
    let c = this.cols.get(col);
    if (!c) {
      c = new FakeColumn();
      this.cols.set(col, c);
    }
    return c;
  }
  mergeCells(t: number, l: number, b: number, r: number): void {
    this.merges.push([t, l, b, r]);
  }
}
let lastWorkbook: FakeWorkbook | undefined;
class FakeWorkbook {
  worksheets: FakeWorksheet[] = [];
  xlsx = { writeBuffer: async (): Promise<ArrayBuffer> => new Uint8Array([1, 2, 3, 4]).buffer };
  constructor() {
    lastWorkbook = this;
  }
  addWorksheet(name: string): FakeWorksheet {
    const ws = new FakeWorksheet(name);
    this.worksheets.push(ws);
    return ws;
  }
}
const fakeExcelModule = { default: { Workbook: FakeWorkbook } };

const columns: ColumnDef[] = [
  { id: 'id', field: 'id', header: 'ID', width: 90, type: 'number' },
  { id: 'name', field: 'name', header: 'Name', width: 120, type: 'text' },
  { id: 'amt', field: 'amt', header: 'Amount', width: 80, type: 'number', formatMask: 'number' },
];

interface Row {
  id: number;
  name: string;
  amt: number;
}
const rows: Row[] = [
  { id: 1, name: 'alpha', amt: 30 },
  { id: 2, name: 'bravo', amt: 10 },
  { id: 3, name: 'charlie', amt: 20 },
];

function container(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

async function flush(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
}

/** Read a Blob's text (jsdom's Blob lacks `.text()`, so fall back to FileReader). */
function blobText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') return blob.text();
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsText(blob);
  });
}

/** Read a Blob's bytes (jsdom fallback via FileReader). */
function blobBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as ArrayBuffer);
    fr.onerror = () => reject(fr.error);
    fr.readAsArrayBuffer(blob);
  });
}

describe('LIB-EXPORT.exportCsv (COMPONENT-EXPORT / CAP-EXPORT)', () => {
  it('serializes the current sorted/filtered view to RFC-4180 CSV', async () => {
    const grid = createGrid(container(), { columns, keyField: 'id' });
    await grid.setData(rows);
    // Sort by amount ascending → row order becomes bravo(10), charlie(20), alpha(30).
    await grid.sort({ entries: [{ columnId: 'amt', direction: 'asc' }] });
    await flush();

    const csv = await blobText(await grid.exportCsv());
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('ID,Name,Amount'); // header row
    expect(lines[1]).toBe('2,bravo,10');
    expect(lines[2]).toBe('3,charlie,20');
    expect(lines[3]).toBe('1,alpha,30');
    expect(lines).toHaveLength(4);
  });

  it('default scope respects the filter; opts.allData exports the full dataset', async () => {
    const grid = createGrid(container(), { columns, keyField: 'id' });
    await grid.setData(rows);
    // Filter to amt > 15 → keeps charlie(20) + alpha(30).
    await grid.filter({ perColumn: { amt: (v) => Number(v) > 15 } });
    await flush();

    const viewCsv = await blobText(await grid.exportCsv());
    const viewLines = viewCsv.split('\r\n');
    expect(viewLines).toHaveLength(3); // header + 2 rows
    expect(viewCsv).not.toContain('bravo');

    const allCsv = await blobText(await grid.exportCsv({ allData: true }));
    const allLines = allCsv.split('\r\n');
    expect(allLines).toHaveLength(4); // header + 3 rows (filter ignored)
    expect(allCsv).toContain('bravo');
  });

  it('RFC-4180-quotes fields with commas/quotes/newlines', async () => {
    const grid = createGrid(container(), { columns, keyField: 'id' });
    await grid.setData([{ id: 1, name: 'a,b "c"\nd', amt: 5 }]);
    await flush();
    const csv = await blobText(await grid.exportCsv());
    expect(csv.split('\r\n')[1]).toBe('1,"a,b ""c""\nd",5');
  });
});

describe('SEC-EXPORT-FORMULA-GUARD (AC-EXPORT-GUARD)', () => {
  it('prefixes a formula-leading value by default', async () => {
    const grid = createGrid(container(), { columns, keyField: 'id' });
    await grid.setData([{ id: 1, name: '=HYPERLINK("http://evil")', amt: 0 }]);
    await flush();
    const csv = await blobText(await grid.exportCsv());
    expect(csv).toContain(`'=HYPERLINK`);
  });

  it('sanitizeFormulas:false disables the guard', async () => {
    const grid = createGrid(container(), { columns, keyField: 'id' });
    await grid.setData([{ id: 1, name: '=1+1', amt: 0 }]);
    await flush();
    const csv = await blobText(await grid.exportCsv({ sanitizeFormulas: false }));
    expect(csv.split('\r\n')[1]).toBe('1,=1+1,0'); // verbatim, unprefixed
    expect(csv).not.toContain(`'=`);
  });

  it('leaves negative numbers untouched (typed, not injectable)', async () => {
    const grid = createGrid(container(), { columns, keyField: 'id' });
    await grid.setData([{ id: 1, name: 'x', amt: -5 }]);
    await flush();
    const csv = await blobText(await grid.exportCsv());
    expect(csv.split('\r\n')[1]).toBe('1,x,-5');
  });
});

describe('LIB-EXPORT.exportXlsx — DEP-XLSX mapping (AC-XLSX-MAPPING)', () => {
  it('maps value + numFmt + font/fill/border/alignment + merges + frozen + width', async () => {
    const grid = createGrid(container(), {
      columns,
      keyField: 'id',
      loadExcel: () => Promise.resolve(fakeExcelModule),
    });
    await grid.setData(rows);
    await flush();

    // Style the first data cell (row 0, 'name' column) — resolved style must map.
    grid.setStyle(
      { top: 0, left: 1, bottom: 0, right: 1 },
      {
        textColor: '#112233',
        fillColor: '#ff0000',
        fontFamily: 'Arial',
        fontSize: 14,
        fontWeight: 'bold',
        italic: true,
        underline: true,
        borders: { top: { style: 'thin', color: '#000000' } },
        align: { h: 'center', v: 'middle' },
        wrap: true,
        indent: 2,
      },
    );
    // Merge id..name of the last row, and freeze 1 row + 1 col.
    grid.merge({ top: 2, left: 0, bottom: 2, right: 1 });
    grid.setFrozen({ rows: 1, cols: 1 });
    await flush();

    const blob = await grid.exportXlsx();
    expect(blob.type).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const ws = lastWorkbook!.worksheets[0]!;

    // Column widths.
    expect(ws.getColumn(1).width).toBe(90);
    expect(ws.getColumn(3).width).toBe(80);
    // Header row.
    expect(ws.getCell(1, 1).value).toBe('ID');
    // Value + type (row 0 → excel row 2). amt column carries the numFmt.
    expect(ws.getCell(2, 1).value).toBe(1);
    expect(ws.getCell(2, 2).value).toBe('alpha');
    expect(ws.getCell(2, 3).numFmt).toBe('#,##0.###');
    // Resolved CellStyle → font / fill / border / alignment on the styled cell.
    const styled = ws.getCell(2, 2);
    expect(styled.font).toMatchObject({ name: 'Arial', size: 14, bold: true, italic: true, underline: true, color: { argb: 'FF112233' } });
    expect(styled.fill).toMatchObject({ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } });
    expect(styled.border).toMatchObject({ top: { style: 'thin', color: { argb: 'FF000000' } } });
    expect(styled.alignment).toMatchObject({ horizontal: 'center', vertical: 'middle', wrapText: true, indent: 2 });
    // MERGE-REGION → mergeCells (row 2 data → excel rows 4; header offset +2, +1).
    expect(ws.merges).toContainEqual([4, 1, 4, 2]);
    // FREEZE-PANE → frozen views (header + 1 frozen row, 1 frozen col).
    expect(ws.views).toEqual([{ state: 'frozen', xSplit: 1, ySplit: 2 }]);
  });

  it('AC-XLSX-FAILSOFT: import failure rejects XLSX_UNAVAILABLE + EVT-ERROR; CSV still works', async () => {
    const errors: GridError[] = [];
    const grid = createGrid(container(), {
      columns,
      keyField: 'id',
      loadExcel: () => Promise.reject(new Error('module not found')),
    });
    grid.on('error', ({ error }) => errors.push(error));
    await grid.setData(rows);
    await flush();

    await expect(grid.exportXlsx()).rejects.toMatchObject({ code: 'XLSX_UNAVAILABLE', source: 'export' });
    expect(errors.some((e) => e.code === 'XLSX_UNAVAILABLE')).toBe(true);

    // CSV export is unaffected by the missing xlsx dependency.
    const csv = await blobText(await grid.exportCsv());
    expect(csv).toContain('alpha');
  });

  it('EXPORT_FAILED when serialization throws (+ EVT-ERROR)', async () => {
    const errors: GridError[] = [];
    const throwingModule = {
      default: {
        Workbook: class {
          addWorksheet(): never {
            throw new Error('boom');
          }
        },
      },
    };
    const grid = createGrid(container(), {
      columns,
      keyField: 'id',
      loadExcel: () => Promise.resolve(throwingModule),
    });
    grid.on('error', ({ error }) => errors.push(error));
    await grid.setData(rows);
    await flush();

    await expect(grid.exportXlsx()).rejects.toMatchObject({ code: 'EXPORT_FAILED', source: 'export' });
    expect(errors.some((e) => e.code === 'EXPORT_FAILED')).toBe(true);
  });

  it('a real exceljs round-trip preserves value + number format', async () => {
    // Real DEP-XLSX (exceljs installed as an optional dependency). Round-trips a
    // workbook through writeBuffer → new workbook load, asserting fidelity.
    const ExcelJS = (await import('exceljs')).default;
    const grid = createGrid(container(), { columns, keyField: 'id' });
    await grid.setData(rows);
    await flush();

    const buf = await blobBuffer(await grid.exportXlsx());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0]!;
    expect(ws.getCell(1, 1).value).toBe('ID'); // header
    expect(ws.getCell(2, 2).value).toBe('alpha'); // first data row, name col
    expect(ws.getCell(2, 3).numFmt).toBe('#,##0.###'); // amt numFmt survived
  });
});

describe('feature gating', () => {
  it('rejects export when the export flag is off', async () => {
    const grid = createGrid(container(), {
      columns,
      keyField: 'id',
      features: { export: false },
    });
    await grid.setData(rows);
    await flush();
    await expect(grid.exportCsv()).rejects.toMatchObject({ code: 'INVALID_OPTIONS' });
  });
});
