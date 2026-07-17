// mini-grid demo — mounts a 1,000,000-row grid (12 columns) with perf:true so a
// later Playwright scroll benchmark (SEQ-SCROLL) can drive it. Runs directly
// against the built ESM (no bundler): served from the repo root, this imports
// packages/core/dist/index.js.
import { createGrid } from '../packages/core/dist/index.js';

// v1.1 CE-WORKER-SEAM — count real Worker instantiations so the E2E can PROVE the
// grid ran the data engine off the main thread (`ADR-WORKER-OPS` default). Wrap
// the global constructor BEFORE createGrid so core's default worker is counted.
window.__workerCount = 0;
if (typeof Worker !== 'undefined') {
  const NativeWorker = Worker;
  // eslint-disable-next-line no-global-assign
  window.Worker = class extends NativeWorker {
    constructor(url, opts) {
      super(url, opts);
      window.__workerCount++;
    }
  };
}

const ROWS = 1_000_000;
const COLS = 12;

/** @returns {import('../packages/core/dist/index.js').ColumnDef[]} */
function makeColumns() {
  const cols = [{ id: 'id', field: 'id', header: 'ID', width: 90, type: 'number' }];
  for (let c = 1; c < COLS; c++) {
    const col = {
      id: `c${c}`,
      field: `c${c}`,
      header: `Col ${c}`,
      width: 120,
      type: c % 3 === 0 ? 'number' : 'text',
    };
    // Slice 4a: make the text columns editable so JOURNEY-EDIT has a target.
    // c2 carries a validation rule (values must start with "r") so the E2E can
    // force the VALIDATION_FAILED path.
    if (col.type === 'text') col.editable = true;
    if (c === 2) col.validation = [{ kind: 'regex', pattern: '^r', message: 'Must start with r' }];
    // Slice 5: c3 (number) shows a value-format mask; c4 (text) uses a custom
    // renderer returning a STRING — applied via textContent (SEC-RENDERER-DOM-ONLY),
    // so a script-bearing value never becomes live DOM.
    if (c === 3) col.formatMask = 'number';
    if (c === 4) col.renderer = (ctx) => (ctx.value == null ? '' : String(ctx.value));
    cols.push(col);
  }
  // v1.1 slices 13/14 — an editable checkbox (boolean, immediate-commit) and an
  // editable dropdown (select, overlay-popover listbox) for JOURNEY-EDIT editors.
  cols.push({ id: 'active', field: 'active', header: 'Active', width: 90, type: 'boolean', editable: true });
  cols.push({
    id: 'grade',
    field: 'grade',
    header: 'Grade',
    width: 110,
    type: 'select',
    editable: true,
    editor: {
      kind: 'select',
      options: [
        { value: 'A', label: 'A — Excellent' },
        { value: 'B', label: 'B — Good' },
        { value: 'C', label: 'C — Fair' },
        { value: 'D', label: 'D — Poor' },
      ],
    },
  });
  return cols;
}

function makeRows(n) {
  const rows = new Array(n);
  for (let i = 0; i < n; i++) {
    const row = { id: i };
    for (let c = 1; c < COLS; c++) {
      row[`c${c}`] = c % 3 === 0 ? (i * c) % 100000 : `r${i}-c${c}`;
    }
    row.active = i % 2 === 0;
    row.grade = ['A', 'B', 'C', 'D'][i % 4];
    rows[i] = row;
  }
  return rows;
}

const app = document.getElementById('app');
const status = document.getElementById('status');
const sel = document.getElementById('selection');

const grid = createGrid(app, {
  columns: makeColumns(),
  keyField: 'id',
  perf: true,
  rowHeight: 28,
  overscan: 6,
});

// Expose for Playwright driving.
window.__grid = grid;

// Stable scroll handle for the perf harness (SEQ-SCROLL). The renderer's scroll
// container is `.mg-scroll`; expose it so drivers don't depend on internals.
window.__scroller = () => app.querySelector('[data-mini-grid] .mg-scroll');

// Slice-3 interaction: reflect the live selection (EVT-SELECTION-CHANGE) and
// the visible window (EVT-VIEWPORT-CHANGE) so the real-flow E2E can observe them.
window.__selection = () => grid.getSelection();
grid.on('selectionChange', ({ selection }) => {
  window.__lastSelection = selection;
  const a = selection.activeCell;
  const r = selection.ranges[0];
  const span = r ? (r.bottom - r.top + 1) * (r.right - r.left + 1) : 0;
  sel.textContent = a
    ? `active ${String(a.rowKey)}/${a.columnId} — ${span} cell(s)`
    : 'none';
});
grid.on('viewportChange', (vp) => {
  window.__viewport = vp;
});

status.textContent = `Generating ${ROWS.toLocaleString()} rows…`;
const tNav = performance.now(); // approx time since module start
const tGen0 = performance.now();
const rows = makeRows(ROWS);
const genMs = performance.now() - tGen0;
const tLoad0 = performance.now();
grid.setData(rows).then((res) => {
  const loadMs = performance.now() - tLoad0;
  const dt = (performance.now() - tNav).toFixed(0);
  // Perf hooks for the Playwright harness (SEQ-MOUNT).
  window.__perf = {
    genMs,
    loadMs,
    mountMs: performance.now() - tNav,
    marks: grid.getPerfMarks(),
  };
  status.textContent = `Mounted ${res.rowCount.toLocaleString()} rows in ${dt} ms — scroll to benchmark.`;
  window.__ready = true;
});
