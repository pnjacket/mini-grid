// @vitest-environment jsdom
/**
 * `COMPONENT-CLIPBOARD` / `LIB-CLIPBOARD` (jsdom) — copy/cut/paste/fill.
 *
 * Covers: copy serializes the selection to TSV; paste parses TSV and applies at
 * the active cell (expanding the range) through the edit/commit path (rows go
 * `dirty`); the paste is ONE undoable `Command` (undo reverts the whole block);
 * cut clears the source + is undoable; `SEC-PASTE-UNTRUSTED` (HTML pasted as plain
 * text, never rendered/executed); `EVT-BEFORE-PASTE` veto aborts (no changes, no
 * after-event); `fill(range)` propagates source values; validation rejects invalid
 * pasted cells.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createGrid } from '../api/grid.js';
import { parseTsv, serializeTsv } from './clipboard.js';
import type { Grid, ColumnDef } from '../api/options.js';
import type { Range } from '../types.js';

const columns: ColumnDef[] = [
  { id: 'id', field: 'id', header: 'ID', width: 80, type: 'number' }, // key, not editable
  { id: 'name', field: 'name', header: 'Name', width: 120, type: 'text', editable: true },
  { id: 'city', field: 'city', header: 'City', width: 120, type: 'text', editable: true },
  {
    id: 'age',
    field: 'age',
    header: 'Age',
    width: 60,
    type: 'number',
    editable: true,
    validation: [{ kind: 'range', min: 0, max: 120 }],
  },
];

function makeRows(n: number): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < n; i++) rows.push({ id: i, name: `Name ${i}`, city: `City ${i}`, age: 20 });
  return rows;
}

let mounted: Grid | undefined;
let clipboardText = '';

function installClipboard(): void {
  clipboardText = '';
  const clip = {
    writeText: (t: string): Promise<void> => {
      clipboardText = t;
      return Promise.resolve();
    },
    readText: (): Promise<string> => Promise.resolve(clipboardText),
  };
  Object.defineProperty(window.navigator, 'clipboard', { value: clip, configurable: true });
}

async function makeGrid(
  rowCount: number,
  features?: Record<string, boolean>,
): Promise<{ grid: Grid; root: HTMLElement }> {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const grid = createGrid(el, {
    columns,
    keyField: 'id',
    rowHeight: 28,
    overscan: 6,
    ...(features ? { features } : {}),
  });
  mounted = grid;
  await grid.setData(makeRows(rowCount));
  const root = el.querySelector('[data-mini-grid]') as HTMLElement;
  return { grid, root };
}

function cellAt(root: HTMLElement, row: number, col: number): HTMLElement {
  return root.querySelector(
    `[role="gridcell"][aria-rowindex="${row + 1}"][aria-colindex="${col + 1}"]`,
  ) as HTMLElement;
}

/** Select a single anchor cell (paste origin). */
function selectCell(grid: Grid, row: number, col: number): void {
  grid.setSelection({
    ranges: [{ top: row, bottom: row, left: col, right: col }],
    anchor: { row, col },
    activeCell: null,
  });
}

/** Select a rectangular range (anchor = top-left). */
function selectRange(grid: Grid, r: Range): void {
  grid.setSelection({
    ranges: [r],
    anchor: { row: r.top, col: r.left },
    activeCell: null,
  });
}

async function rowData(grid: Grid, index: number): Promise<Record<string, unknown>> {
  const res = await grid.getRows({ startIndex: index, endIndex: index + 1 });
  return res.rows[0]!.data as Record<string, unknown>;
}

beforeEach(() => {
  installClipboard();
});

afterEach(() => {
  mounted?.destroy();
  mounted = undefined;
  document.body.innerHTML = '';
});

describe('TSV helpers', () => {
  it('parseTsv splits rows on \\n and cells on \\t; drops a single trailing newline', () => {
    expect(parseTsv('a\tb\nc\td')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(parseTsv('a\tb\n')).toEqual([['a', 'b']]);
    expect(parseTsv('a\r\nb')).toEqual([['a'], ['b']]); // CRLF normalized
    expect(parseTsv('')).toEqual([]);
  });

  it('serializeTsv joins a value matrix (null → empty)', () => {
    expect(
      serializeTsv([
        ['a', 1],
        [null, 'd'],
      ]),
    ).toBe('a\t1\n\td');
  });
});

describe('COMPONENT-CLIPBOARD — copy', () => {
  it('copy serializes the selection range to TSV on the clipboard', async () => {
    const { grid } = await makeGrid(5);
    // Select name+city over rows 0..1 (cols 1..2).
    selectRange(grid, { top: 0, bottom: 1, left: 1, right: 2 });
    await grid.copy();
    expect(clipboardText).toBe('Name 0\tCity 0\nName 1\tCity 1');
  });

  it('copy is a no-op with the clipboard flag off', async () => {
    const { grid } = await makeGrid(5, { clipboard: false });
    selectRange(grid, { top: 0, bottom: 1, left: 1, right: 2 });
    await grid.copy();
    expect(clipboardText).toBe('');
  });
});

describe('COMPONENT-CLIPBOARD — paste', () => {
  it('paste parses TSV and applies at the active cell, expanding the range (commit path → dirty)', async () => {
    const { grid, root } = await makeGrid(6);
    clipboardText = 'Alice\tParis\nBob\tRome';
    selectCell(grid, 2, 1); // anchor at row 2, name column

    const { targetRange } = await grid.paste();
    expect(targetRange).toEqual({ top: 2, bottom: 3, left: 1, right: 2 });

    // Cells committed via the edit path.
    expect((await rowData(grid, 2)).name).toBe('Alice');
    expect((await rowData(grid, 2)).city).toBe('Paris');
    expect((await rowData(grid, 3)).name).toBe('Bob');
    expect((await rowData(grid, 3)).city).toBe('Rome');
    // Rendered cell reflects the pasted value.
    expect(cellAt(root, 2, 1).textContent).toBe('Alice');

    // changeState → dirty for the affected rows (INV-ROWSTATE).
    const changes = await grid.getChanges();
    expect(changes.dirty.sort()).toEqual([2, 3]);
  });

  it('a paste is ONE undoable Command (undo reverts the whole block)', async () => {
    const { grid } = await makeGrid(6);
    clipboardText = 'Alice\tParis\nBob\tRome';
    selectCell(grid, 2, 1);
    await grid.paste();
    expect((await rowData(grid, 2)).name).toBe('Alice');
    expect((await rowData(grid, 3)).city).toBe('Rome');

    await grid.undo();
    // A single undo reverts EVERY cell of the paste.
    expect((await rowData(grid, 2)).name).toBe('Name 2');
    expect((await rowData(grid, 2)).city).toBe('City 2');
    expect((await rowData(grid, 3)).name).toBe('Name 3');
    expect((await rowData(grid, 3)).city).toBe('City 3');
  });

  it('validation rejects invalid pasted cells (valid ones still apply)', async () => {
    const { grid } = await makeGrid(4);
    const errors: unknown[] = [];
    grid.on('validationError', (e) => errors.push(e));
    clipboardText = '50\n999'; // 999 is out of the 0..120 range
    selectCell(grid, 0, 3); // anchor at age column

    await grid.paste();
    expect((await rowData(grid, 0)).age).toBe(50); // valid → applied (coerced to number)
    expect((await rowData(grid, 1)).age).toBe(20); // invalid → rejected, unchanged
    expect(errors.length).toBe(1); // EVT-VALIDATION-ERROR for the rejected cell
  });

  it('CAP-FORMULA: an invalid pasted formula is rejected per-cell; valid ones compute (Excel-like)', async () => {
    const { grid } = await makeGrid(4, { formula: true });
    const errors: unknown[] = [];
    grid.on('validationError', (e) => errors.push(e));
    clipboardText = '=1+1\n=1+'; // row 0 valid formula → 2 ; row 1 invalid formula
    selectCell(grid, 0, 1); // anchor at the name column (col B)

    await grid.paste();
    expect((await rowData(grid, 0)).name).toBe(2); // valid formula computed
    // Invalid formula rejected → cell unchanged; NOT silently stored as the text "=1+".
    expect((await rowData(grid, 1)).name).toBe('Name 1');
    expect(errors.length).toBe(1); // EVT-VALIDATION-ERROR for the rejected formula cell
  });

  it('SEC-PASTE-UNTRUSTED: pasted HTML/script is inserted as PLAIN TEXT, never rendered/executed', async () => {
    const { grid, root } = await makeGrid(4);
    const payload = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    clipboardText = payload;
    selectCell(grid, 0, 1); // name column (text)

    await grid.paste();

    // Stored + displayed as the literal string.
    expect((await rowData(grid, 0)).name).toBe(payload);
    const cell = cellAt(root, 0, 1);
    expect(cell.textContent).toBe(payload);
    // No HTML was materialized from the payload: no <script>/<img> anywhere; the
    // only element descendants are the grid's own fill handle (never pasted HTML).
    expect(cell.querySelectorAll('script, img').length).toBe(0);
    expect(root.querySelector('script')).toBeNull();
    for (const child of Array.from(cell.children)) {
      expect(child.hasAttribute('data-mg-fill-handle')).toBe(true);
    }
  });

  it('EVT-BEFORE-PASTE veto aborts the whole paste (no cells change, no EVT-AFTER-PASTE)', async () => {
    const { grid } = await makeGrid(4);
    let afterFired = false;
    grid.on('beforePaste', (e) => e.preventDefault());
    grid.on('afterPaste', () => {
      afterFired = true;
    });
    clipboardText = 'Alice\tParis';
    selectCell(grid, 0, 1);

    const { targetRange } = await grid.paste();
    expect(targetRange).toEqual({ top: 0, bottom: 0, left: 1, right: 2 });
    // Nothing changed and no after-event fired.
    expect((await rowData(grid, 0)).name).toBe('Name 0');
    expect(afterFired).toBe(false);
    expect((await grid.getChanges()).dirty).toEqual([]);
  });

  it('EVT-AFTER-PASTE carries { targetRange, data } when not vetoed', async () => {
    const { grid } = await makeGrid(4);
    const seen: Array<{ targetRange: Range; data: string[][] }> = [];
    grid.on('afterPaste', (e) => seen.push({ targetRange: e.targetRange, data: e.data }));
    clipboardText = 'Alice\tParis';
    selectCell(grid, 1, 1);

    await grid.paste();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.targetRange).toEqual({ top: 1, bottom: 1, left: 1, right: 2 });
    expect(seen[0]!.data).toEqual([['Alice', 'Paris']]);
  });
});

describe('COMPONENT-CLIPBOARD — cut', () => {
  it('cut copies to the clipboard then clears the source (undoable)', async () => {
    const { grid } = await makeGrid(5);
    selectRange(grid, { top: 0, bottom: 1, left: 1, right: 1 }); // name, rows 0..1
    await grid.cut();

    // Copied to clipboard.
    expect(clipboardText).toBe('Name 0\nName 1');
    // Source cleared.
    expect((await rowData(grid, 0)).name).toBe('');
    expect((await rowData(grid, 1)).name).toBe('');
    expect((await grid.getChanges()).dirty.sort()).toEqual([0, 1]);

    // One undoable Command restores the cleared source.
    await grid.undo();
    expect((await rowData(grid, 0)).name).toBe('Name 0');
    expect((await rowData(grid, 1)).name).toBe('Name 1');
  });
});

describe('COMPONENT-CLIPBOARD — fill', () => {
  it('fill(range) pattern-fills the source values across the target (undoable)', async () => {
    const { grid } = await makeGrid(6);
    selectCell(grid, 0, 1); // source = name of row 0 ('Name 0')
    await grid.fill({ top: 0, bottom: 2, left: 1, right: 1 });

    expect((await rowData(grid, 0)).name).toBe('Name 0'); // source untouched
    expect((await rowData(grid, 1)).name).toBe('Name 0'); // filled
    expect((await rowData(grid, 2)).name).toBe('Name 0'); // filled

    await grid.undo();
    expect((await rowData(grid, 1)).name).toBe('Name 1');
    expect((await rowData(grid, 2)).name).toBe('Name 2');
  });

  it('fill repeats a multi-cell source pattern', async () => {
    const { grid } = await makeGrid(6);
    // Source = name over rows 0..1 ('Name 0','Name 1'); fill down to row 3.
    selectRange(grid, { top: 0, bottom: 1, left: 1, right: 1 });
    await grid.fill({ top: 0, bottom: 3, left: 1, right: 1 });
    expect((await rowData(grid, 2)).name).toBe('Name 0'); // pattern repeats
    expect((await rowData(grid, 3)).name).toBe('Name 1');
  });
});
