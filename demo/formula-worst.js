// mini-grid WORST-CASE formula demo (PERF-RECALC-WORST). Every forecast cell is a
// FORECAST.ETS — the slowest built-in after the v1.7 root-finder optimization pass
// (a per-call micro-bench puts FORECAST.ETS at ~80µs over a 24-point window — ~40×
// the COUNTIF path and ~500× cheap arithmetic, because Holt-Winters runs a
// smoothing-parameter grid-search per call). The cells CHAIN so a single edit
// cascades a large sub-graph:
//   - Timeline column A (fixed) + base-signal column B (the editable input).
//   - Each forecast cell FORECAST.ETS's the next point from the W cells ABOVE it in
//     its own column (a deep vertical chain), plus a value-neutral `+ 0*B{row}` term
//     that injects an editable dependency at every row.
//   - Editing B1 (head) cascades the whole graph; editing B{last} (leaf) touches a
//     tiny sub-graph — the incremental-recalc win survives even at ~80µs/cell.
// Was: 300k chained COUNTIF (COUNTIF is now ~40× cheaper than the true worst case).
import { createGrid } from '../packages/core/dist/index.js';

const params = new URLSearchParams(location.search);
const ROWS = Number(params.get('rows') || 3000); // 3000 × 4 ≈ 12k FORECAST.ETS cells
const FCOLS = Number(params.get('cols') || 4);
const WINDOW = Number(params.get('window') || 24); // series length per forecast (≥ 2·season)
const SEASON = Number(params.get('season') || 4); // Holt-Winters period

const status = document.getElementById('status');
const perfEl = document.getElementById('perf');

// A = timeline (t); B = editable base signal; C.. = FORECAST.ETS columns.
const columns = [
  { id: 't', field: 't', header: 'A · t (timeline)', width: 110, type: 'number', editable: true },
  { id: 'base', field: 'base', header: 'B · Base signal', width: 120, type: 'number', editable: true },
];
for (let c = 0; c < FCOLS; c++) {
  const letter = String.fromCharCode(67 + c); // C, D, E, F …
  columns.push({ id: `f${c}`, field: `f${c}`, header: `${letter} · FORECAST.ETS`, width: 170, type: 'number', editable: true });
}

status.textContent = `generating ${ROWS.toLocaleString()} rows (${(ROWS * FCOLS).toLocaleString()} forecast cells, window ${WINDOW})…`;

const season = Array.from({ length: SEASON }, (_, i) => 6 * Math.sin((2 * Math.PI * i) / SEASON));

function makeRows(n) {
  const rows = new Array(n);
  for (let i = 0; i < n; i++) {
    const r = i + 1; // 1-based A1 row
    const row = { id: i, t: r, base: 10 + 0.5 * r + season[i % SEASON] };
    for (let c = 0; c < FCOLS; c++) {
      const L = String.fromCharCode(67 + c); // this column's letter
      if (r <= WINDOW) {
        row[`f${c}`] = `=B${r}`; // seed: passthrough of the base signal
      } else {
        const top = r - WINDOW;
        // Forecast the (bounded) base signal over a sliding window; `+ 0*B{r}` injects
        // an editable dependency at every row, `+ 0*{L}{r-1}` chains to the cell above
        // (both value-neutral). → editing B1 cascades the whole column; B{last} is tiny.
        row[`f${c}`] = `=FORECAST.ETS(A${r},B${top}:B${r - 1},A${top}:A${r - 1},${SEASON})+0*B${r}+0*${L}${r - 1}`;
      }
    }
    rows[i] = row;
  }
  return rows;
}

const grid = createGrid(document.getElementById('app'), {
  columns,
  keyField: 'id',
  features: { formula: true },
  rowHeight: 26,
  overscan: 6,
});
window.__grid = grid;

const perf = { rows: ROWS, formulaCells: ROWS * FCOLS, fn: 'FORECAST.ETS', window: WINDOW, season: SEASON };
window.__formulaPerf = perf;

function renderPerf() {
  const fmt = (n) => (n == null ? '—' : `${n.toFixed(1)} ms`);
  perfEl.innerHTML = `<table>
    <tr><td>Slowest function chained</td><td>FORECAST.ETS (window ${WINDOW}, season ${SEASON})</td></tr>
    <tr><td>Forecast cells</td><td>${perf.formulaCells.toLocaleString()}</td></tr>
    <tr><td>Row generation</td><td>${fmt(perf.genMs)}</td></tr>
    <tr><td>setData (load scan + first full recalc)</td><td>${fmt(perf.loadMs)}</td></tr>
    <tr><td><strong>PERF-RECALC-WORST</strong> — clean full recalc (FORECAST.ETS graph)</td><td>${fmt(perf.fullRecalcMs)}</td></tr>
    <tr><td><strong>Head edit B1</strong> — cascades the whole chained graph</td><td>${fmt(perf.headEditMs)}</td></tr>
    <tr><td><strong>Leaf edit B${ROWS}</strong> — tiny subgraph (the incremental win survives)</td><td>${fmt(perf.leafEditMs)}</td></tr>
  </table>`;
}
renderPerf();

const tGen0 = performance.now();
const rows = makeRows(ROWS);
perf.genMs = performance.now() - tGen0;

const tLoad0 = performance.now();
grid.setData(rows).then(async () => {
  perf.loadMs = performance.now() - tLoad0;
  const full = await grid.recalculate();
  perf.fullRecalcMs = full.elapsedMs;
  status.textContent = `ready — ${perf.formulaCells.toLocaleString()} FORECAST.ETS cells. Edit B1 to cascade the whole graph.`;
  renderPerf();
  window.__ready = true;
});

document.getElementById('editHead').addEventListener('click', async () => {
  status.textContent = 'recomputing the chained graph (worst case)…';
  const t = performance.now();
  const cur = (await grid.getRows({ startIndex: 0, endIndex: 1 })).rows[0].data.base;
  await grid.updateCell(0, 'base', Number(cur) + 1);
  perf.headEditMs = performance.now() - t;
  status.textContent = 'ready';
  renderPerf();
});

document.getElementById('editLeaf').addEventListener('click', async () => {
  const t = performance.now();
  const cur = (await grid.getRows({ startIndex: ROWS - 1, endIndex: ROWS })).rows[0].data.base;
  await grid.updateCell(ROWS - 1, 'base', Number(cur) + 1);
  perf.leafEditMs = performance.now() - t;
  renderPerf();
});

document.getElementById('recalc').addEventListener('click', async () => {
  const res = await grid.recalculate();
  perf.fullRecalcMs = res.elapsedMs;
  renderPerf();
});
