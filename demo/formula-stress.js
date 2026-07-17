// mini-grid formula STRESS demo (PERF-RECALC-FULL / PERF-RECALC-INCR). Builds a
// grid whose formula cells CHAIN — both within a row (B→C→D→E) and DOWN the
// sheet (a running-sum column G forms one ROWS-deep dependency chain). With the
// defaults below that is ROWS × 6 = 300,000 interacting formula cells.
//
// It measures: (1) full recalc on load, (2) a clean full recalc, (3) a HEAD edit
// that cascades the whole deep chain (incremental worst case), and (4) a LEAF
// edit that touches a tiny subgraph (the incremental win). All timings land on
// window.__formulaPerf for the Playwright harness / E2E.
import { createGrid } from '../packages/core/dist/index.js';

const params = new URLSearchParams(location.search);
const ROWS = Number(params.get('rows') || 50_000); // 50k × 6 formula cols = 300k cells

// A=base (literal) ; B..G formulas (6 formula columns → 6 × ROWS formula cells).
const columns = [
  { id: 'base', field: 'base', header: 'A · Base', width: 90, type: 'number', editable: true },
  { id: 'b', field: 'b', header: 'B =A*2', width: 100, type: 'number', editable: true },
  { id: 'c', field: 'c', header: 'C =B+A', width: 110, type: 'number', editable: true },
  { id: 'd', field: 'd', header: 'D =C*1.5', width: 110, type: 'number', editable: true },
  { id: 'e', field: 'e', header: 'E =D-1', width: 110, type: 'number', editable: true },
  { id: 'f', field: 'f', header: 'F =IF(E>1e6,"HI","LO")', width: 170, type: 'text', editable: true },
  { id: 'g', field: 'g', header: 'G =running Σ (deep chain)', width: 200, type: 'number', editable: true },
];

const status = document.getElementById('status');
const perfEl = document.getElementById('perf');

status.textContent = `generating ${ROWS.toLocaleString()} rows (${(ROWS * 6).toLocaleString()} formula cells)…`;

function makeRows(n) {
  const rows = new Array(n);
  for (let i = 0; i < n; i++) {
    const r = i + 1; // 1-based A1 row
    rows[i] = {
      id: i,
      base: (i % 50) + 1,
      b: `=A${r}*2`,
      c: `=B${r}+A${r}`,
      d: `=C${r}*1.5`,
      e: `=D${r}-1`,
      f: `=IF(E${r}>1000000,"HI","LO")`,
      // Running sum: G1=E1, Gr = G(r-1) + Er → a single ROWS-deep dependency chain.
      g: i === 0 ? '=E1' : `=G${i}+E${r}`,
    };
  }
  return rows;
}

const app = document.getElementById('app');
const grid = createGrid(app, {
  columns,
  keyField: 'id',
  features: { formula: true },
  rowHeight: 26,
  overscan: 6,
});
window.__grid = grid;

const perf = { rows: ROWS, formulaCells: ROWS * 6 };
window.__formulaPerf = perf;

function renderPerf() {
  const fmt = (n) => (n == null ? '—' : `${n.toFixed(1)} ms`);
  perfEl.innerHTML = `<table>
    <tr><td>Formula cells</td><td>${perf.formulaCells.toLocaleString()}</td></tr>
    <tr><td>Row generation</td><td>${fmt(perf.genMs)}</td></tr>
    <tr><td>setData (load scan + first full recalc)</td><td>${fmt(perf.loadMs)}</td></tr>
    <tr><td><strong>PERF-RECALC-FULL</strong> — clean full recalc</td><td>${fmt(perf.fullRecalcMs)}</td></tr>
    <tr><td><strong>PERF-RECALC-INCR</strong> — head edit (cascade ${ROWS.toLocaleString()}-deep chain)</td><td>${fmt(perf.headEditMs)}</td></tr>
    <tr><td><strong>PERF-RECALC-INCR</strong> — leaf edit (tiny subgraph)</td><td>${fmt(perf.leafEditMs)}</td></tr>
  </table>`;
}
renderPerf();

const tGen0 = performance.now();
const rows = makeRows(ROWS);
perf.genMs = performance.now() - tGen0;

const tLoad0 = performance.now();
grid.setData(rows).then(async () => {
  perf.loadMs = performance.now() - tLoad0;
  // A clean full recalc for the PERF-RECALC-FULL number (graph already built).
  const full = await grid.recalculate();
  perf.fullRecalcMs = full.elapsedMs;
  status.textContent = `ready — ${perf.formulaCells.toLocaleString()} formula cells; scroll to see the running Σ chain (column G).`;
  renderPerf();
  window.__ready = true;
});

// Head edit: change A1 → cascades through the entire G running-sum chain.
document.getElementById('editHead').addEventListener('click', async () => {
  const t = performance.now();
  const cur = (await grid.getRows({ startIndex: 0, endIndex: 1 })).rows[0].data.base;
  await grid.updateCell(0, 'base', Number(cur) + 1);
  perf.headEditMs = performance.now() - t;
  renderPerf();
});

// Leaf edit: change the LAST row's base → only that row's B..G + the G tail.
document.getElementById('editLeaf').addEventListener('click', async () => {
  const t = performance.now();
  const lastKey = ROWS - 1;
  const cur = (await grid.getRows({ startIndex: ROWS - 1, endIndex: ROWS })).rows[0].data.base;
  await grid.updateCell(lastKey, 'base', Number(cur) + 1);
  perf.leafEditMs = performance.now() - t;
  renderPerf();
});

document.getElementById('recalc').addEventListener('click', async () => {
  const res = await grid.recalculate();
  perf.fullRecalcMs = res.elapsedMs;
  renderPerf();
});
