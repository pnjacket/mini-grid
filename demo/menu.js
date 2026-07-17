// mini-grid configurable-menus demo (slice 20, `CAP-MENU` / `JOURNEY-HEADER` +
// `JOURNEY-RANGE-OPS`). One target-branched `MenuBuilder` drives BOTH the body-
// cell menu (`LAYER-CONTEXT-MENU`) and the dedicated header menu
// (`LAYER-HEADER-MENU`). Exercises the rich item kinds — a developer `custom`
// render (`SEC-MENU-CUSTOM-RENDER`), a `submenu`, a `checkbox` toggle, a `radio`
// group, a built-in-by-`command`-id, and a flag-hidden built-in — the target
// surface for `e2e/menu.spec.ts` (+ axe).
import { createGrid, builtinItems } from '../packages/core/dist/index.js';

const COLS = [
  { id: 'id', field: 'id', header: 'ID', width: 90, type: 'number' },
  { id: 'name', field: 'name', header: 'Name', width: 160, type: 'text', editable: true },
  { id: 'score', field: 'score', header: 'Score', width: 120, type: 'number', formatMask: 'number' },
  { id: 'city', field: 'city', header: 'City', width: 160, type: 'text' },
];

const CITIES = ['Oslo', 'Bergen', 'Trondheim', 'Stavanger'];
function makeRows(n) {
  const rows = new Array(n);
  for (let i = 0; i < n; i++) {
    rows[i] = { id: i, name: `Person ${i}`, score: (i * 37) % 1000, city: CITIES[i % CITIES.length] };
  }
  return rows;
}

// One MenuBuilder, branching on `ctx.target.kind` → distinct cell vs header menus.
const menu = (ctx) => {
  if (ctx.target.kind === 'cell') {
    return [
      builtinItems.copy(),
      builtinItems.cut(),
      builtinItems.paste(),
      { kind: 'separator', id: 's1' },
      // `custom` — developer-owned DOM mounted AS-IS (`SEC-MENU-CUSTOM-RENDER`).
      // The developer owns the node's a11y: here a well-formed `role="menuitem"`.
      {
        kind: 'custom',
        id: 'custom-action',
        render: () => {
          const el = document.createElement('div');
          el.setAttribute('role', 'menuitem');
          el.setAttribute('tabindex', '-1');
          el.className = 'mg-context-menu-item';
          el.setAttribute('data-mg-custom', '');
          el.textContent = '★ Custom action';
          el.addEventListener('click', () => {
            window.__customClicked = (window.__customClicked ?? 0) + 1;
          });
          return el;
        },
      },
      {
        kind: 'checkbox',
        id: 'flag',
        label: 'Flag row',
        checked: false,
        handler: () => {
          window.__toggled = (window.__toggled ?? 0) + 1;
        },
      },
      {
        kind: 'submenu',
        id: 'more',
        label: 'More…',
        children: [
          {
            kind: 'action',
            id: 'log-cell',
            label: 'Log this cell',
            handler: (c) => {
              window.__loggedCell = c.target.cellRef;
            },
          },
        ],
      },
    ];
  }
  if (ctx.target.kind === 'column-header') {
    return [
      builtinItems.sortAsc(ctx),
      builtinItems.sortDesc(ctx),
      builtinItems.clearSort(),
      { kind: 'separator', id: 's2' },
      // Built-in via a raw `{ command }` id (grid supplies behavior).
      { kind: 'action', id: 'hide-it', command: 'hide-column', label: 'Hide this column' },
      builtinItems.pinColumn(ctx),
      builtinItems.autofit(ctx),
      { kind: 'separator', id: 's3' },
      // A flag-hidden built-in: `group` is OFF (features below) → this AUTO-HIDES.
      { kind: 'action', id: 'group-it', command: 'group-by', label: 'Group by column' },
      {
        kind: 'submenu',
        id: 'view',
        label: 'View…',
        children: [
          { kind: 'radio', id: 'r-asc', group: 'dir', label: 'Ascending', checked: true },
          { kind: 'radio', id: 'r-desc', group: 'dir', label: 'Descending' },
        ],
      },
    ];
  }
  // row-header / corner
  return [builtinItems.selectAll()];
};

const app = document.getElementById('app');
const grid = createGrid(app, {
  columns: COLS,
  keyField: 'id',
  rowHeight: 28,
  overscan: 6,
  // `group` OFF so the `group-by` built-in demonstrates flag-aware auto-hide.
  features: { group: false },
  header: {
    rows: { content: 'number', width: 44, select: true },
    corner: { selectAll: true },
  },
  menu,
});

window.__grid = grid;
grid.setData(makeRows(200)).then((res) => {
  document.getElementById('status').textContent = `Mounted ${res.rowCount} rows.`;
  window.__ready = true;
});
