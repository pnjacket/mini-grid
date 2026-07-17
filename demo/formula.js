// mini-grid formula showcase (CAP-FORMULA). A small, fully-interactive sheet that
// demonstrates the derived-value pipeline: formula columns (D/E/F) compute from
// editable inputs (B/C), a totals row aggregates ranges, and the cell editor
// shows the FORMULA while the grid shows the RESULT. Runs against the built ESM.
import { createGrid } from '../packages/core/dist/index.js';

// A1 columns: A=category B=units C=price D=revenue E=net F=rating.
const columns = [
  { id: 'category', field: 'category', header: 'Category', width: 150, type: 'text', editable: true },
  { id: 'units', field: 'units', header: 'Units', width: 90, type: 'number', editable: true },
  { id: 'price', field: 'price', header: 'Price', width: 90, type: 'number', editable: true, formatMask: 'currency:USD' },
  { id: 'revenue', field: 'revenue', header: 'Revenue (=B*C)', width: 150, type: 'number', editable: true, formatMask: 'currency:USD' },
  { id: 'net', field: 'net', header: 'Net (after disc.)', width: 150, type: 'number', editable: true, formatMask: 'currency:USD' },
  { id: 'rating', field: 'rating', header: 'Rating', width: 110, type: 'text', editable: true },
];

const products = [
  ['Widgets', 40, 12],
  ['Gadgets', 12, 65],
  ['Sprockets', 120, 3],
  ['Cogs', 8, 130],
  ['Gizmos', 60, 22],
  ['Doohickeys', 5, 240],
  ['Thingamajigs', 200, 2],
  ['Whatsits', 25, 44],
];

// Rows 1..8 are products; each formula references its own row (A1 is 1-based).
const rows = products.map(([category, units, price], i) => {
  const r = i + 1;
  return {
    id: i,
    category,
    units,
    price,
    revenue: `=B${r}*C${r}`,
    net: `=D${r}-IF(D${r}>500, D${r}*0.1, 0)`,
    rating: `=IF(E${r}>800,"★★★",IF(E${r}>400,"★★","★"))`,
  };
});

// Row 9 (index 8): a totals row aggregating the ranges above.
rows.push({
  id: 8,
  category: 'TOTALS',
  units: '=SUM(B1:B8)',
  price: '',
  revenue: '=SUM(D1:D8)',
  net: '=SUM(E1:E8)',
  rating: '=TEXT(AVERAGE(E1:E8),"0.00")',
});

const app = document.getElementById('app');
const status = document.getElementById('status');

const grid = createGrid(app, {
  columns,
  keyField: 'id',
  features: { formula: true },
  rowHeight: 30,
});

window.__grid = grid;

grid.on('afterRecalc', ({ changed, cycles, elapsedMs }) => {
  status.textContent = `recalc: ${changed} cell(s), ${cycles} cycle(s), ${elapsedMs.toFixed(2)} ms`;
});

grid.setData(rows).then(() => {
  status.textContent = 'ready — edit Units/Price or type a =formula';
  window.__ready = true;
});
