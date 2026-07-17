// @vitest-environment jsdom
/**
 * `CAP-FORMULA` grid integration — formulas through the real `createGrid` +
 * in-process engine seam: derived-value flow (sort/filter/export see results,
 * the editor sees the formula), chain propagation via `updateCell`, cycles,
 * `getCellFormula`, `recalculate`, and `EVT-AFTER-RECALC`.
 */
import { describe, expect, it } from 'vitest';
import { createGrid } from '../api/grid.js';
import type { ColumnDef } from '../api/options.js';

const columns: ColumnDef[] = [
  { id: 'qty', field: 'qty', header: 'Qty', width: 90, type: 'number', editable: true },
  { id: 'price', field: 'price', header: 'Price', width: 90, type: 'number', editable: true },
  { id: 'total', field: 'total', header: 'Total', width: 90, type: 'number', editable: true },
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

// A1 mapping: col A=qty, B=price, C=total; row N = 1-based load order.
function rows(): Array<Record<string, unknown>> {
  return [
    { id: 0, qty: 2, price: 10, total: '=A1*B1' }, // C1 = 20
    { id: 1, qty: 3, price: 5, total: '=A2*B2' }, // C2 = 15
    { id: 2, qty: 4, price: 7, total: '=A3*B3' }, // C3 = 28
    { id: 3, qty: 0, price: 0, total: '=SUM(C1:C3)' }, // C4 = 63
  ];
}

describe('CAP-FORMULA — grid integration', () => {
  it('AC-FORMULA-DERIVED — computed values flow into getRows; the editor sees the formula', async () => {
    const grid = createGrid(container(), { columns, keyField: 'id', features: { formula: true } });
    await grid.setData(rows());
    await flush();

    const res = await grid.getRows({ startIndex: 0, endIndex: 4 });
    // getRows returns COMPUTED values (INV-FORMULA-DERIVED).
    expect(res.rows[0]!.data.total).toBe(20);
    expect(res.rows[1]!.data.total).toBe(15);
    expect(res.rows[2]!.data.total).toBe(28);
    expect(res.rows[3]!.data.total).toBe(63); // SUM(C1:C3)

    // But the editor seed / getCellFormula sees the raw formula string.
    expect(grid.getCellFormula(0, 'total')).toBe('=A1*B1');
    expect(grid.getCellFormula(3, 'total')).toBe('=SUM(C1:C3)');
    expect(grid.getCellFormula(0, 'qty')).toBeUndefined(); // literal cell
    grid.destroy();
  });

  it('AC-FORMULA-CHAIN — editing a precedent updates dependents (incremental, through updateCell)', async () => {
    const grid = createGrid(container(), { columns, keyField: 'id', features: { formula: true } });
    await grid.setData(rows());
    await flush();

    // Edit qty of row 1 (A1): C1 (=A1*B1) and C4 (=SUM(C1:C3)) both update.
    await grid.updateCell(0, 'qty', 5);
    await flush();
    const res = await grid.getRows({ startIndex: 0, endIndex: 4 });
    expect(res.rows[0]!.data.total).toBe(50); // 5*10
    expect(res.rows[3]!.data.total).toBe(93); // 50+15+28
    grid.destroy();
  });

  it('AC-FORMULA-EVAL — entering a formula via updateCell computes it; a division by zero shows #DIV/0!', async () => {
    const grid = createGrid(container(), { columns, keyField: 'id', features: { formula: true } });
    await grid.setData(rows());
    await flush();

    await grid.updateCell(1, 'total', '=A2/0');
    await flush();
    const res = await grid.getRows({ startIndex: 0, endIndex: 4 });
    expect(res.rows[1]!.data.total).toBe('#DIV/0!');
    expect(grid.getCellFormula(1, 'total')).toBe('=A2/0');
    grid.destroy();
  });

  it('AC-FORMULA-CYCLE — a self-referential edit yields #CIRC! without hanging', async () => {
    const grid = createGrid(container(), { columns, keyField: 'id', features: { formula: true } });
    await grid.setData(rows());
    await flush();

    // C1 = C2, C2 = C1 → cycle.
    await grid.updateCell(0, 'total', '=C2');
    await grid.updateCell(1, 'total', '=C1');
    await flush();
    const res = await grid.getRows({ startIndex: 0, endIndex: 4 });
    expect(res.rows[0]!.data.total).toBe('#CIRC!');
    expect(res.rows[1]!.data.total).toBe('#CIRC!');
    grid.destroy();
  });

  it('AC-FORMULA-DERIVED — sorting orders by computed values; CSV export emits results', async () => {
    const grid = createGrid(container(), {
      columns,
      keyField: 'id',
      features: { formula: true },
    });
    await grid.setData(rows());
    await flush();

    // Sort by the formula column (total) ascending → order by computed value.
    await grid.sort({ entries: [{ columnId: 'total', direction: 'asc' }] });
    await flush();
    const sorted = await grid.getRows({ startIndex: 0, endIndex: 4 });
    const totals = sorted.rows.map((r) => r.data.total);
    expect(totals).toEqual([15, 20, 28, 63]); // ascending computed values

    // CSV export emits the computed value (SEC-EXPORT-FORMULA-GUARD reconciliation).
    const csv = await blobText(await grid.exportCsv());
    expect(csv).toContain('15');
    expect(csv).not.toContain('=A2*B2'); // formula string never crosses the export seam
    grid.destroy();
  });

  it('LIB-FORMULA-RECALC — recalculate() reports a summary and fires EVT-AFTER-RECALC', async () => {
    const grid = createGrid(container(), { columns, keyField: 'id', features: { formula: true } });
    await grid.setData(rows());
    await flush();

    let fired: { changed: number; cycles: number; trigger: string } | null = null;
    grid.on('afterRecalc', (e) => {
      fired = { changed: e.changed, cycles: e.cycles, trigger: e.trigger };
    });
    const summary = await grid.recalculate();
    await flush();
    expect(summary.cycles).toBe(0);
    expect(typeof summary.elapsedMs).toBe('number');
    expect(fired).not.toBeNull();
    expect(fired!.trigger).toBe('manual');
    grid.destroy();
  });

  it('undo restores the prior formula/value after a formula edit', async () => {
    const grid = createGrid(container(), { columns, keyField: 'id', features: { formula: true } });
    await grid.setData(rows());
    await flush();

    await grid.updateCell(0, 'total', '=A1*B1*10'); // C1 = 200
    await flush();
    let res = await grid.getRows({ startIndex: 0, endIndex: 1 });
    expect(res.rows[0]!.data.total).toBe(200);

    await grid.undo();
    await flush();
    res = await grid.getRows({ startIndex: 0, endIndex: 1 });
    expect(res.rows[0]!.data.total).toBe(20); // back to =A1*B1
    expect(grid.getCellFormula(0, 'total')).toBe('=A1*B1');
    grid.destroy();
  });

  it('formula OFF (default) — a `=` value is stored as literal text, not evaluated', async () => {
    const grid = createGrid(container(), { columns, keyField: 'id' }); // no formula flag
    await grid.setData(rows());
    await flush();
    const res = await grid.getRows({ startIndex: 0, endIndex: 1 });
    expect(res.rows[0]!.data.total).toBe('=A1*B1'); // literal, unevaluated
    expect(grid.getCellFormula(0, 'total')).toBeUndefined();
    grid.destroy();
  });
});
