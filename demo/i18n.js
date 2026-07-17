// mini-grid i18n + RTL demo — a small grid with a currency-masked column and a
// frozen leading column, driven from Playwright to exercise COMPONENT-I18N /
// LIB-LOCALE (setLocale re-locales the mask) and RTL mirroring (setDirection).
// Runs against the built ESM (served from the repo root, no bundler).
import { createGrid } from '../packages/core/dist/index.js';

// Enough columns (wide) that the content overflows the viewport horizontally, so
// the RTL horizontal-scroll test can advance the rendered column window.
const COLS = 16;

function makeColumns() {
  const cols = [
    { id: 'id', field: 'id', header: 'ID', width: 90, type: 'number' },
    // The amount column carries a value-format mask; its thousands/decimal
    // separators change with the active locale (en-US → de-DE).
    { id: 'amount', field: 'amount', header: 'Amount', width: 160, type: 'number', formatMask: 'number:2' },
  ];
  for (let c = 2; c < COLS; c++) {
    cols.push({ id: `c${c}`, field: `c${c}`, header: `Col ${c}`, width: 150, type: 'text' });
  }
  return cols;
}

function makeRows(n) {
  const rows = new Array(n);
  for (let i = 0; i < n; i++) {
    const row = { id: i, amount: 1234567.89 };
    for (let c = 2; c < COLS; c++) row[`c${c}`] = `r${i}-c${c}`;
    rows[i] = row;
  }
  return rows;
}

const app = document.getElementById('app');
const status = document.getElementById('status');

const grid = createGrid(app, {
  columns: makeColumns(),
  keyField: 'id',
  rowHeight: 28,
  overscan: 4,
  // A leading frozen column so the RTL test can assert it pins to the right edge.
  frozen: { cols: 1 },
});

// Expose for Playwright driving.
window.__grid = grid;
window.__scroller = () => app.querySelector('[data-mini-grid] .mg-scroll');
window.__setDirection = (dir) => grid.setDirection(dir);
window.__setLocale = (locale, bundle) => grid.setLocale(locale, bundle);

grid.setData(makeRows(200)).then((res) => {
  status.textContent = `mounted ${res.rowCount} rows`;
  window.__ready = true;
});
