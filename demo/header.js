// mini-grid header-region demo (slice 18, `CAP-HEADER` / `JOURNEY-HEADER`).
// Exercises a multi-band column header with spans, a frozen row-header gutter, a
// corner select-all, per-column tooltips, band-height/width resize, and wrapping
// labels — the target surface for the `e2e/header.spec.ts` journey + axe checks.
import { createGrid } from '../packages/core/dist/index.js';

const COLS = [
  { id: 'id', field: 'id', header: 'ID', width: 90, type: 'number', headerTooltip: 'The row identifier' },
  { id: 'name', field: 'name', header: 'Name', width: 160, type: 'text', editable: true },
  { id: 'score', field: 'score', header: 'Score', width: 120, type: 'number', formatMask: 'number' },
  { id: 'grade', field: 'grade', header: 'Grade', width: 120, type: 'text' },
  { id: 'active', field: 'active', header: 'Active', width: 110, type: 'boolean' },
  { id: 'city', field: 'city', header: 'City With A Long Wrapping Label', width: 140, type: 'text' },
];

// Band-0 group headers (developer-populated spans; no imposed hierarchy).
const GROUPS = { id: 'Identity', score: 'Results', active: 'Meta' };
const LABELS = Object.fromEntries(COLS.map((c) => [c.id, c.header]));

const ROWS = 200;
const CITIES = ['Oslo', 'Bergen', 'Trondheim', 'Stavanger'];
function makeRows(n) {
  const rows = new Array(n);
  for (let i = 0; i < n; i++) {
    rows[i] = {
      id: i,
      name: `Person ${i}`,
      score: (i * 37) % 1000,
      grade: ['A', 'B', 'C', 'D'][i % 4],
      active: i % 2 === 0,
      city: CITIES[i % CITIES.length],
    };
  }
  return rows;
}

const app = document.getElementById('app');
const sel = document.getElementById('selection');

const grid = createGrid(app, {
  columns: COLS,
  keyField: 'id',
  rowHeight: 28,
  overscan: 6,
  header: {
    columns: {
      bands: 2,
      height: [24, 28],
      resizable: true,
      wrap: true,
      // Band 0 = group headers (spanning); band 1 = per-column labels.
      render: (ctx) => {
        if (ctx.band === 0) {
          const group = GROUPS[ctx.columnId];
          // An ungrouped column that a pin/reorder pulls out of its group's span
          // gets its own (non-empty) band-0 label — avoids an empty-header cell.
          if (!group) return LABELS[ctx.columnId] ?? ctx.columnId;
          // Clamp the 2-wide group span to the remaining columns so a pin/reorder
          // (CAP-COLUMN-MANAGE) never pushes a developer span out of bounds.
          const colSpan = Math.min(2, COLS.length - ctx.colIndex);
          return { content: group, colSpan };
        }
        return LABELS[ctx.columnId] ?? ctx.columnId;
      },
    },
    rows: {
      content: 'number',
      width: 44,
      resizable: true,
      select: true,
    },
    corner: {
      selectAll: true,
      render: () => '✔', // ✔ — developer-customized corner content
    },
    tooltips: true,
    // CAP-COLUMN-MANAGE — enable the autofit affordance (double-click a resize
    // handle to fit + the autofitAllColumns() action).
    autofit: true,
  },
});

// CAP-COLUMN-MANAGE (LIB-COLUMN-MANAGE) controls — buttons/API calls, NOT a menu
// (configurable menus are slice 20). The E2E `JOURNEY-HEADER` journey drives these.
const on = (id, fn) => document.getElementById(id).addEventListener('click', fn);
on('hide-grade', () => grid.hideColumn('grade'));
on('show-grade', () => grid.showColumn('grade'));
on('pin-city', () => grid.pinColumn('city', 'leading'));
on('unpin-city', () => grid.pinColumn('city', null));
on('autofit-name', () => grid.autofitColumn('name'));
on('autofit-all', () => grid.autofitAllColumns());

window.__grid = grid;
window.__scroller = () => app.querySelector('[data-mini-grid] .mg-scroll');
window.__selection = () => grid.getSelection();
grid.on('selectionChange', ({ selection }) => {
  window.__lastSelection = selection;
  const r = selection.ranges[0];
  sel.textContent = r ? `${(r.bottom - r.top + 1)}×${(r.right - r.left + 1)}` : 'none';
});

grid.setData(makeRows(ROWS)).then((res) => {
  document.getElementById('status').textContent = `Mounted ${res.rowCount} rows.`;
  window.__ready = true;
});
