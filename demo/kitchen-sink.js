// mini-grid — kitchen-sink demo.
//
// A single page that exercises EVERY capability (`CAP-*`) with live controls, and
// doubles as the SUCCESS-DX / QA E2E harness surface (`e2e/kitchen-sink.spec.ts`).
// Runs directly against the built ESM (no bundler): served from the repo root,
// this imports `packages/core/dist/index.js`.
//
// Every control is wired through `act(name, fn)`, which records the outcome so the
// E2E can assert non-error results and so the on-page activity log stays useful for
// manual exploratory testing. Unexpected failures land in `window.__errors`.
import { createGrid, FEATURE_FLAG_KEYS, builtinItems } from '../packages/core/dist/index.js';

/* ----------------------------------------------------------------------------
 * Dataset — 100,000 rows across text / number / date / boolean / select columns.
 * -------------------------------------------------------------------------- */
const ROWS = 100_000;
const CATEGORIES = ['Hardware', 'Software', 'Service', 'Subscription'];
const FIRST = ['Ada', 'Alan', 'Grace', 'Linus', 'Katherine', 'Dennis', 'Barbara', 'Tim'];
const LAST = ['Lovelace', 'Turing', 'Hopper', 'Torvalds', 'Johnson', 'Ritchie', 'Liskov', 'Berners-Lee'];

/** @returns {import('../packages/core/dist/index.js').ColumnDef[]} */
function makeColumns() {
  return [
    // CAP-HEADER — a `headerTooltip` (title/aria) on the ID column.
    { id: 'id', field: 'id', header: 'ID', width: 72, type: 'number', headerTooltip: 'Unique record identifier' },
    {
      id: 'name',
      field: 'name',
      header: 'Name',
      width: 150,
      type: 'text',
      editable: true,
      validation: [{ kind: 'required', message: 'Name is required' }],
      // CAP-HEADER — a custom per-column `headerRender` (a ★ icon + label,
      // `SEC-RENDERER-DOM-ONLY`: a DOM Node, never a raw-HTML string). `name` is an
      // odd (covered) column, so this only fires for the primary band (band 1); the
      // band-0 branch is a harmless empty cell reachable only via an interactive pin.
      headerRender: (ctx) => {
        const el = document.createElement('span');
        el.className = 'mg-header-label';
        el.dataset.ksStarHeader = '';
        el.textContent = ctx.band === 1 ? '★ Name' : '';
        return el;
      },
    },
    {
      id: 'category',
      field: 'category',
      header: 'Category',
      width: 140,
      type: 'text',
      editable: true,
      // `select` editor (dropdown) + a list (oneOf) validator over the same set.
      editor: { kind: 'select', options: CATEGORIES.map((c) => ({ value: c })) },
      validation: [{ kind: 'oneOf', values: CATEGORIES, message: 'Pick a listed category' }],
    },
    {
      id: 'amount',
      field: 'amount',
      header: 'Amount',
      width: 130,
      type: 'number',
      editable: true,
      formatMask: 'currency:USD',
    },
    {
      id: 'score',
      field: 'score',
      header: 'Score',
      width: 92,
      type: 'number',
      editable: true,
      formatMask: 'number',
      // Range validator: 0..100.
      validation: [{ kind: 'range', min: 0, max: 100, message: 'Score must be 0–100' }],
    },
    { id: 'active', field: 'active', header: 'Active', width: 84, type: 'boolean', editable: true },
    { id: 'date', field: 'date', header: 'Joined', width: 128, type: 'date', editable: true, formatMask: 'date' },
    { id: 'notes', field: 'notes', header: 'Notes', width: 200, type: 'text', editable: true },
  ];
}

function makeRows(n) {
  const rows = new Array(n);
  const base = Date.UTC(2020, 0, 1);
  for (let i = 0; i < n; i++) {
    rows[i] = {
      id: i,
      name: `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`,
      category: CATEGORIES[i % CATEGORIES.length],
      amount: Math.round(((i * 37) % 100000) * 1.25) / 100 + 9.99,
      score: (i * 13) % 101,
      active: i % 3 === 0,
      date: new Date(base + ((i * 86400037) % (1500 * 86400000))).toISOString().slice(0, 10),
      notes: `Record #${i} — lorem ipsum`,
    };
  }
  return rows;
}

const COLUMNS = makeColumns();
const DATA = makeRows(ROWS);

/* ----------------------------------------------------------------------------
 * CAP-HEADER (v1.3) — the unified header region: a 2-band column header with
 * developer-driven group spans (band 0) over the per-column labels (band 1), a
 * frozen row-number gutter, a select-all corner, and column tooltips. Band-0
 * groups are keyed by their leading column; the 2-wide span is clamped to the
 * remaining columns so a pin/reorder (CAP-COLUMN-MANAGE) never pushes a span
 * out of bounds. `LABELS` mirrors each column's default label for band 1.
 * -------------------------------------------------------------------------- */
const LABELS = Object.fromEntries(COLUMNS.map((c) => [c.id, c.header]));
// Band-0 group headers, tiled by *position* (an anchor at a fixed slot spans the
// columns after it). Full coverage keeps every column either an anchor or covered
// by exactly one span, so a column has a single, stable band-0 footprint under
// reorder/hide. The `Details` span is 4-wide so `amount`+`score` (adjacent, both
// referenced single-match by existing tests) stay covered (band-1 only).
const BAND0_SPANS = {
  0: { label: 'Identity', span: 2 }, // covers slots 0–1 (id, name)
  2: { label: 'Details', span: 4 }, //  covers slots 2–5 (category, amount, score, active)
  6: { label: 'Records', span: 2 }, //  covers slots 6–7 (date, notes)
};

const HEADER_CONFIG = {
  columns: {
    bands: 2,
    height: [22, 28],
    resizable: true,
    // Band 0 = spanning group headers; band 1 = per-column labels (the fallback
    // for any column that also carries its own `headerRender`).
    render: (ctx) => {
      if (ctx.band === 0) {
        const g = BAND0_SPANS[ctx.colIndex];
        if (g) return { content: g.label, colSpan: Math.min(g.span, COLUMNS.length - ctx.colIndex) };
        return ''; // covered by an earlier anchor's span
      }
      return LABELS[ctx.columnId] ?? ctx.columnId;
    },
  },
  // The frozen leading-edge row-number gutter (role="rowheader"); click to
  // line-select a row (multi-range CAP-SELECT).
  rows: { content: 'number', width: 48, resizable: true, select: true },
  corner: { selectAll: true, render: () => '#' },
  tooltips: true,
  // CAP-COLUMN-MANAGE — enable the autofit affordance (double-click a resize
  // handle to fit + the autofit actions below).
  autofit: true,
};

/* ----------------------------------------------------------------------------
 * CAP-MENU (v1.4) — ONE target-branched `MenuBuilder` drives BOTH the body-cell
 * menu (`LAYER-CONTEXT-MENU`) and the dedicated header menu (`LAYER-HEADER-MENU`).
 * The cell branch mixes built-ins (copy/paste) with a developer `custom` node
 * (`SEC-MENU-CUSTOM-RENDER`), a `checkbox` toggle, and a `submenu`; the
 * column-header branch composes sort/hide/pin/autofit built-ins (by
 * `builtinItems`/command id) with one custom action. Flag-off built-ins auto-hide.
 * -------------------------------------------------------------------------- */
window.__ksMenu = { toggled: 0, custom: 0, loggedCell: null, loggedCol: null };
const MENU_BUILDER = (ctx) => {
  if (ctx.target.kind === 'cell') {
    return [
      builtinItems.copy(),
      builtinItems.paste(),
      { kind: 'separator', id: 'ks-sep-1' },
      {
        // Developer-owned DOM, mounted AS-IS — a well-formed role="menuitem".
        kind: 'custom',
        id: 'ks-custom-flag',
        render: () => {
          const el = document.createElement('div');
          el.setAttribute('role', 'menuitem');
          el.setAttribute('tabindex', '-1');
          el.className = 'mg-context-menu-item';
          el.setAttribute('data-mg-custom', '');
          el.textContent = '★ Flag this cell';
          el.addEventListener('click', () => (window.__ksMenu.custom += 1));
          return el;
        },
      },
      {
        kind: 'checkbox',
        id: 'ks-star-row',
        label: 'Star row',
        checked: false,
        handler: () => (window.__ksMenu.toggled += 1),
      },
      {
        kind: 'submenu',
        id: 'ks-more',
        label: 'More…',
        children: [
          {
            kind: 'action',
            id: 'ks-log-cell',
            label: 'Log this cell',
            handler: (c) => (window.__ksMenu.loggedCell = c.target.cellRef),
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
      { kind: 'separator', id: 'ks-sep-2' },
      builtinItems.hideColumn(ctx),
      builtinItems.pinColumn(ctx),
      builtinItems.autofit(ctx),
      { kind: 'separator', id: 'ks-sep-3' },
      {
        kind: 'action',
        id: 'ks-log-col',
        label: 'Log this column',
        handler: (c) => (window.__ksMenu.loggedCol = c.target.columnId),
      },
    ];
  }
  // row-header / corner
  return [builtinItems.selectAll()];
};

/* ----------------------------------------------------------------------------
 * Grid lifecycle — feature flags + theme/density/locale/direction are all
 * construction-time options, so `build()` (re)creates the grid when they change.
 * -------------------------------------------------------------------------- */
const app = document.getElementById('grid');
const config = { theme: 'light', density: 'comfortable', locale: 'en-US', direction: 'ltr' };
const flags = Object.fromEntries(FEATURE_FLAG_KEYS.map((k) => [k, true]));

/** Unexpected failures (asserted empty by the E2E). */
window.__errors = [];
/** Grid `EVT-ERROR` codes seen (XLSX_UNAVAILABLE is expected in the no-bundler demo). */
window.__gridErrors = [];
/** Structured activity log for the on-page panel + the E2E. */
window.__log = [];

let grid = null;
let lastGroupId = null;
const ruleIds = [];

function build() {
  window.__ready = false;
  if (grid) grid.destroy();
  grid = createGrid(app, {
    columns: COLUMNS,
    keyField: 'id',
    features: flags,
    header: HEADER_CONFIG,
    menu: MENU_BUILDER,
    theme: config.theme,
    density: config.density,
    locale: config.locale,
    direction: config.direction,
    rowHeight: 28,
    overscan: 6,
    historyMaxDepth: 500,
    announceEdits: true,
  });
  window.__grid = grid;
  grid.on('error', (e) => {
    const code = e.error && e.error.code;
    window.__gridErrors.push(code);
    if (code !== 'XLSX_UNAVAILABLE') {
      window.__errors.push({ name: 'grid.error', message: code });
    }
  });
  grid.on('selectionChange', ({ selection }) => reflectSelection(selection));
  lastGroupId = null;
  ruleIds.length = 0;
  return grid.setData(DATA).then((res) => {
    window.__ready = true;
    updateStatus(res.rowCount);
    return res;
  });
}

/* ----------------------------------------------------------------------------
 * Small UI plumbing — status line, activity log, selection readout.
 * -------------------------------------------------------------------------- */
const statusEl = document.getElementById('status');
const selEl = document.getElementById('selection');
const logEl = document.getElementById('log');

async function updateStatus(rowCount) {
  const cnt = rowCount ?? (await grid.getRowCount()).rowCount;
  const enabled = FEATURE_FLAG_KEYS.filter((k) => flags[k]).length;
  statusEl.textContent = `${cnt.toLocaleString()} rows · ${enabled}/${FEATURE_FLAG_KEYS.length} features on · ${config.theme}/${config.density} · ${config.locale} ${config.direction}`;
}

function reflectSelection(selection) {
  const a = selection.activeCell;
  const r = selection.ranges[0];
  const span = r ? (r.bottom - r.top + 1) * (r.right - r.left + 1) : 0;
  selEl.textContent = a ? `active ${String(a.rowKey)}/${a.columnId} · ${span} cell(s)` : 'none';
}

function log(name, status, detail) {
  const entry = { name, status, detail, t: Date.now() };
  window.__log.push(entry);
  const row = document.createElement('div');
  row.className = `log-row log-${status}`;
  row.textContent = `${status === 'ok' ? '✓' : '✕'} ${name}${detail ? ' — ' + detail : ''}`;
  logEl.prepend(row);
  while (logEl.childElementCount > 40) logEl.lastElementChild.remove();
}

/** Run a control action, recording its outcome (never throws to the UI). */
async function act(name, fn) {
  try {
    const detail = await fn();
    log(name, 'ok', typeof detail === 'string' ? detail : undefined);
    await updateStatus();
    return detail;
  } catch (e) {
    const message = (e && e.message) || String(e);
    // A deliberately-invalid edit rejects with VALIDATION_FAILED — that's the
    // demonstrated behavior, not an unexpected error.
    if (e && e.code === 'VALIDATION_FAILED') {
      log(name, 'ok', 'rejected (validation)');
    } else {
      window.__errors.push({ name, message });
      log(name, 'error', message);
    }
    await updateStatus();
    return undefined;
  }
}

/** The active range (or a small default), for range-scoped actions. */
function currentRange() {
  const r = grid.getSelection().ranges[0];
  if (r) return { top: r.top, left: r.left, bottom: r.bottom, right: r.right };
  return { top: 0, left: 1, bottom: 3, right: 2 };
}

function selectRange(range) {
  grid.setSelection({
    ranges: [range],
    anchor: { row: range.top, col: range.left },
    activeCell: { rowKey: range.top, columnId: COLUMNS[range.left].id },
  });
}
window.__ks = { selectRange, currentRange: () => currentRange(), flags: () => ({ ...flags }) };

/* ----------------------------------------------------------------------------
 * Wire the controls. `on(id, handler)` binds a click; `bind` groups by CAP.
 * -------------------------------------------------------------------------- */
const $ = (id) => document.getElementById(id);
const on = (id, handler) => $(id).addEventListener('click', handler);

// CAP-DATA-BIND / CAP-VIRTUALIZE
on('ctl-reload', () => act('reload', () => build().then(() => 'rebound')));
on('ctl-scroll', () =>
  act('scroll', () => {
    grid.scrollTo({ rowIndex: 50_000 });
    return 'to row 50,000';
  }),
);

// CAP-SELECT
on('ctl-select', () =>
  act('select', () => {
    selectRange({ top: 2, left: 1, bottom: 6, right: 3 });
    return 'rows 2–6, cols name–amount';
  }),
);

// CAP-EDIT — programmatic + CRUD
on('ctl-edit', () =>
  act('edit', () => grid.updateCell(0, 'name', 'Edited ✎').then((r) => `name → ${r.newValue}`)),
);
on('ctl-edit-invalid', () =>
  act('edit-invalid', () => grid.updateCell(0, 'score', 999)),
);
on('ctl-insert-row', () =>
  act('insert-row', () =>
    grid.insertRows(0, [{ id: 1_000_000 + Math.floor(Math.random() * 1e6), name: 'New row', category: 'Service', amount: 0, score: 0, active: true, date: '2024-01-01', notes: '' }]).then((r) => `+${r.count} row`),
  ),
);
on('ctl-remove-row', () =>
  act('remove-row', async () => {
    const { rows } = await grid.getRows({ startIndex: 0, endIndex: 1 });
    const res = await grid.removeRows([rows[0].key]);
    return `-${res.removed.length} row`;
  }),
);
on('ctl-insert-col', () => act('insert-col', () => grid.insertColumn(1).then((r) => `+col ${r.column.id}`)));
on('ctl-remove-col', () => act('remove-col', () => grid.removeColumn('notes').then((r) => `-col ${r.columnId}`)));

// CAP-UNDO
on('ctl-undo', () => act('undo', () => grid.undo().then(() => 'undone')));
on('ctl-redo', () => act('redo', () => grid.redo().then(() => 'redone')));

// CAP-SORT
on('ctl-sort-asc', () => act('sort-asc', () => grid.sort({ entries: [{ columnId: 'amount', direction: 'asc' }] }).then(() => 'amount ↑')));
on('ctl-sort-multi', () =>
  act('sort-multi', () =>
    grid.sort({ entries: [{ columnId: 'category', direction: 'asc' }, { columnId: 'amount', direction: 'desc' }] }).then(() => 'category ↑, amount ↓'),
  ),
);
on('ctl-sort-clear', () => act('sort-clear', () => grid.sort({ entries: [] }).then(() => 'natural')));

// CAP-FILTER
on('ctl-filter', () =>
  act('filter', () =>
    grid.filter({ perColumn: { score: (v) => Number(v) > 50 } }).then((r) => `score > 50 → ${r.rowCount.toLocaleString()} rows`),
  ),
);
on('ctl-filter-clear', () => act('filter-clear', () => grid.filter({ perColumn: {} }).then((r) => `${r.rowCount.toLocaleString()} rows`)));

// CAP-RESIZE / CAP-REORDER
on('ctl-resize', () =>
  act('resize', () => {
    grid.setColumnWidth('name', 260);
    return 'name → 260px';
  }),
);
on('ctl-reorder', () =>
  act('reorder', () => {
    grid.moveColumn('name', 5);
    return 'name → index 5';
  }),
);

// CAP-COLUMN-MANAGE — hide/show + leading pin + autofit on the active column.
// The "active" column is the one carrying the active cell (click a cell or a
// header to choose it); it falls back to `notes` so the controls always work.
function activeColumnId() {
  const a = grid.getSelection().activeCell;
  return (a && a.columnId) || 'notes';
}
on('ctl-hide-col', () =>
  act('hide-col', () => {
    const id = activeColumnId();
    grid.hideColumn(id);
    return `hid ${id}`;
  }),
);
on('ctl-show-all', () =>
  act('show-all', () => {
    for (const c of COLUMNS) grid.showColumn(c.id);
    return 'all columns shown';
  }),
);
on('ctl-pin-col', () =>
  act('pin-col', () => {
    const id = activeColumnId();
    grid.pinColumn(id, 'leading');
    return `pinned ${id}`;
  }),
);
on('ctl-unpin-col', () =>
  act('unpin-col', () => {
    const id = activeColumnId();
    grid.pinColumn(id, null);
    return `unpinned ${id}`;
  }),
);
on('ctl-autofit', () =>
  act('autofit', () => {
    const id = activeColumnId();
    grid.autofitColumn(id);
    return `autofit ${id}`;
  }),
);
on('ctl-autofit-all', () =>
  act('autofit-all', () => {
    grid.autofitAllColumns();
    return 'autofit all';
  }),
);

// CAP-FREEZE
let frozen = false;
on('ctl-freeze', () =>
  act('freeze', () => {
    frozen = !frozen;
    grid.setFrozen(frozen ? { rows: 1, cols: 1 } : { rows: 0, cols: 0 });
    return frozen ? '1 row + 1 col pinned' : 'unpinned';
  }),
);

// CAP-MERGE
on('ctl-merge', () =>
  act('merge', () => {
    const r = currentRange();
    // Ensure a >=2-cell range.
    const range = r.right > r.left || r.bottom > r.top ? r : { ...r, right: r.left + 1 };
    grid.merge(range);
    return `${grid.getMerges().length} merge(s)`;
  }),
);
on('ctl-unmerge', () =>
  act('unmerge', () => {
    grid.unmerge(currentRange());
    return `${grid.getMerges().length} merge(s)`;
  }),
);

// CAP-GROUP
on('ctl-group', () =>
  act('group', () => {
    const { id } = grid.group({ axis: 'row', start: 10, span: 6 });
    lastGroupId = id;
    return `group rows 10–15`;
  }),
);
on('ctl-collapse', () =>
  act('collapse', () => {
    if (!lastGroupId) grid.group({ axis: 'row', start: 10, span: 6 }), (lastGroupId = grid.getGroups()[0].id);
    const g = grid.getGroups().find((n) => n.id === lastGroupId);
    grid.setCollapsed(lastGroupId, !(g && g.collapsed));
    return g && g.collapsed ? 'expanded' : 'collapsed';
  }),
);

// CAP-FMT-CELL — cell/range styling
on('ctl-style-fill', () =>
  act('style-fill', () => {
    grid.setStyle(currentRange(), { fillColor: '#fff3bf', textColor: '#5f3dc4', fontWeight: 'bold' });
    return 'range styled';
  }),
);
on('ctl-style-clear', () =>
  act('style-clear', () => {
    grid.clearStyle(currentRange());
    return 'cleared';
  }),
);

// CAP-COND-FMT — a value rule, a color scale, a data bar, an icon set
on('ctl-cf-value', () =>
  act('cf-value', () => {
    ruleIds.push(
      grid.addConditionalRule({
        kind: 'value',
        scope: [{ top: 0, left: 4, bottom: ROWS, right: 4 }],
        config: { op: '>', value: 80 },
        style: { fillColor: '#c92a2a', textColor: '#ffffff', fontWeight: 'bold' },
      }).id,
    );
    return 'score > 80 → red';
  }),
);
on('ctl-cf-scale', () =>
  act('cf-scale', () => {
    ruleIds.push(
      grid.addConditionalRule({
        kind: 'colorScale',
        scope: [{ top: 0, left: 4, bottom: ROWS, right: 4 }],
        config: { columnId: 'score', min: '#ffffff', mid: '#ffd43b', max: '#2b8a3e' },
      }).id,
    );
    return 'score color scale';
  }),
);
on('ctl-cf-bar', () =>
  act('cf-bar', () => {
    ruleIds.push(
      grid.addConditionalRule({
        kind: 'dataBar',
        scope: [{ top: 0, left: 3, bottom: ROWS, right: 3 }],
        config: { columnId: 'amount', color: '#4263eb' },
      }).id,
    );
    return 'amount data bar';
  }),
);
on('ctl-cf-icon', () =>
  act('cf-icon', () => {
    ruleIds.push(
      grid.addConditionalRule({
        kind: 'iconSet',
        scope: [{ top: 0, left: 4, bottom: ROWS, right: 4 }],
        config: { columnId: 'score', icons: [{ min: 0, icon: '🔴' }, { min: 34, icon: '🟡' }, { min: 67, icon: '🟢' }] },
      }).id,
    );
    return 'score icon set';
  }),
);
on('ctl-cf-clear', () =>
  act('cf-clear', () => {
    for (const id of ruleIds.splice(0)) grid.removeConditionalRule(id);
    return 'rules cleared';
  }),
);

// CAP-CLIPBOARD — copy / paste / fill
on('ctl-copy', () =>
  act('copy', () => {
    selectRange({ top: 0, left: 1, bottom: 2, right: 1 });
    return grid.copy().then(() => 'copied names 0–2');
  }),
);
on('ctl-paste', () =>
  act('paste', () => {
    selectRange({ top: 10, left: 1, bottom: 10, right: 1 });
    return grid.paste().then(() => 'pasted at row 10');
  }),
);
on('ctl-fill', () =>
  act('fill', () => {
    selectRange({ top: 20, left: 1, bottom: 20, right: 1 });
    return grid.fill({ top: 20, left: 1, bottom: 25, right: 1 }).then(() => 'filled down 5');
  }),
);

// CAP-EXPORT — CSV (dependency-free) + xlsx (fail-soft in the no-bundler demo)
on('ctl-export-csv', () =>
  act('export-csv', async () => {
    const blob = await grid.exportCsv();
    downloadBlob(blob, 'mini-grid.csv');
    return `${blob.size} bytes`;
  }),
);
on('ctl-export-xlsx', () =>
  act('export-xlsx', async () => {
    try {
      const blob = await grid.exportXlsx();
      downloadBlob(blob, 'mini-grid.xlsx');
      return `${blob.size} bytes`;
    } catch (e) {
      if (e && e.code === 'XLSX_UNAVAILABLE') return 'xlsx lib not bundled (fail-soft)';
      throw e;
    }
  }),
);

// CAP-PERSIST-STATE
let savedState = null;
on('ctl-state-save', () =>
  act('state-save', () => {
    savedState = grid.serializeState();
    return 'layout snapshot taken';
  }),
);
on('ctl-state-restore', () =>
  act('state-restore', () => {
    if (!savedState) throw Object.assign(new Error('no snapshot'), { code: 'NO_SNAPSHOT' });
    grid.restoreState(savedState);
    return 'layout restored';
  }),
);

// CAP-THEME + density
on('ctl-theme', () =>
  act('theme', () => {
    config.theme = config.theme === 'light' ? 'dark' : 'light';
    grid.setTheme(config.theme);
    document.body.dataset.theme = config.theme;
    return config.theme;
  }),
);
on('ctl-density', () =>
  act('density', () => {
    config.density = config.density === 'comfortable' ? 'compact' : 'comfortable';
    return build().then(() => config.density); // density is construction-time
  }),
);

// CAP-I18N — locale + RTL
$('ctl-locale').addEventListener('change', (ev) =>
  act('locale', () => {
    config.locale = ev.target.value;
    grid.setLocale(config.locale);
    return config.locale;
  }),
);
on('ctl-rtl', () =>
  act('rtl', () => {
    config.direction = config.direction === 'ltr' ? 'rtl' : 'ltr';
    grid.setDirection(config.direction);
    return config.direction;
  }),
);

/* ----------------------------------------------------------------------------
 * CAP-FEATURE-FLAGS — a checkbox per flag; toggling rebuilds the grid so the
 * disabled capability leaves no affordance (PATTERN-FEATURE-FLAGS).
 * -------------------------------------------------------------------------- */
const flagPanel = document.getElementById('flags');
for (const key of FEATURE_FLAG_KEYS) {
  const label = document.createElement('label');
  label.className = 'flag';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = true;
  cb.dataset.flag = key;
  cb.addEventListener('change', () => {
    flags[key] = cb.checked;
    act(`flag:${key}`, () => build().then(() => (cb.checked ? 'on' : 'off')));
  });
  label.append(cb, document.createTextNode(' ' + key));
  flagPanel.appendChild(label);
}

/* ----------------------------------------------------------------------------
 * Utilities.
 * -------------------------------------------------------------------------- */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Boot.
build();
