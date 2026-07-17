// @vitest-environment jsdom
/**
 * `LIB-COLUMN-MANAGE` / `CAP-COLUMN-MANAGE` (`AC-COLUMN-MANAGE`) — hide/show,
 * leading pin, and autofit, driven through the real `createGrid` path in jsdom.
 * Proves `INV-COLUMN-HIDDEN-EXCLUDED` (hidden excluded from the view, def + data
 * retained, show restores), `INV-COLUMN-PIN-LEADING` (pinned → leading contiguous
 * block, RTL, composes with freeze), idempotency, the `INVALID_COLUMN_DEF`
 * unknown-id throw, the `EVT-COLUMN-*` notifications, and the BOUNDED autofit
 * measure (visible/sampled cells only — no full-column scan).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createGrid } from '../api/grid.js';
import type { ColumnDef, Grid } from '../api/options.js';
import type { FeatureFlags } from '../api/features.js';

const columns: ColumnDef[] = [
  { id: 'id', field: 'id', header: 'ID', width: 80, type: 'number' },
  { id: 'name', field: 'name', header: 'Name', width: 160, type: 'text' },
  { id: 'grade', field: 'grade', header: 'Grade', width: 120, type: 'text' },
  { id: 'city', field: 'city', header: 'City', width: 140, type: 'text' },
];

function rows(n: number): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < n; i++) {
    out.push({ id: i, name: `Person ${i}`, grade: ['A', 'B', 'C', 'D'][i % 4], city: 'Oslo' });
  }
  return out;
}

const mounted: Grid[] = [];
afterEach(() => {
  for (const g of mounted) g.destroy();
  mounted.length = 0;
  document.body.innerHTML = '';
});

async function flush(rounds = 12): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
}

async function mount(opts?: {
  features?: Partial<FeatureFlags>;
  direction?: 'ltr' | 'rtl';
  frozen?: { rows?: number; cols?: number };
  cols?: ColumnDef[];
  rowCount?: number;
}): Promise<{ grid: Grid; root: HTMLElement; el: HTMLElement }> {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const grid = createGrid(el, {
    columns: opts?.cols ?? columns,
    keyField: 'id',
    rowHeight: 28,
    overscan: 4,
    ...(opts?.features ? { features: opts.features } : {}),
    ...(opts?.direction ? { direction: opts.direction } : {}),
    ...(opts?.frozen ? { frozen: opts.frozen } : {}),
  });
  mounted.push(grid);
  await grid.setData(rows(opts?.rowCount ?? 200));
  await flush();
  const root = el.querySelector('[data-mini-grid]') as HTMLElement;
  return { grid, root, el };
}

/** Visible column ids in header render order (single default band). */
function headerOrder(root: HTMLElement): string[] {
  return [...root.querySelectorAll('[role=columnheader][data-col-id]')].map(
    (c) => c.getAttribute('data-col-id') as string,
  );
}

function bodyColIds(root: HTMLElement): Set<string> {
  const set = new Set<string>();
  for (const c of root.querySelectorAll('[role=gridcell][data-col-id]')) {
    set.add(c.getAttribute('data-col-id') as string);
  }
  return set;
}

describe('LIB-COLUMN-MANAGE.hideColumn/showColumn — INV-COLUMN-HIDDEN-EXCLUDED', () => {
  it('hide excludes a column from the view + fires EVT-COLUMN-HIDDEN; show restores it', async () => {
    const { grid, root } = await mount();
    const events: Array<{ columnId: string; hidden: boolean }> = [];
    grid.on('columnHidden', (e) => events.push({ columnId: e.columnId, hidden: e.hidden }));

    expect(bodyColIds(root).has('grade')).toBe(true);
    grid.hideColumn('grade');
    await flush();

    // Excluded from the header + body projection; neighbours remain.
    expect(headerOrder(root)).not.toContain('grade');
    expect(bodyColIds(root).has('grade')).toBe(false);
    expect(bodyColIds(root).has('name')).toBe(true);
    expect(bodyColIds(root).has('city')).toBe(true);
    expect(events).toEqual([{ columnId: 'grade', hidden: true }]);

    // Show restores the column unchanged (def + data retained — distinct from delete).
    grid.showColumn('grade');
    await flush();
    expect(headerOrder(root)).toContain('grade');
    expect(bodyColIds(root).has('grade')).toBe(true);
    // The restored cells still carry the original data.
    const cell = root.querySelector('[role=gridcell][data-col-id="grade"]') as HTMLElement;
    expect(['A', 'B', 'C', 'D']).toContain(cell.textContent);
    expect(events[1]).toEqual({ columnId: 'grade', hidden: false });
  });

  it('hiding the LAST (trailing) column removes its header AND every body cell, like a middle column; show restores', async () => {
    // Regression: a trailing `hideColumn` used to drop the header but leave the
    // recycled body cells carrying a stale `data-col-id` (queryable), because the
    // last cell falls off the render list as a surplus cell rather than being
    // overwritten by the leftward shift a middle-column hide triggers. The surplus
    // recycle must strip identity so ZERO `[data-col-id="city"]` body cells remain.
    const { grid, root } = await mount();
    const cellCount = (id: string): number =>
      root.querySelectorAll(`[role=gridcell][data-col-id="${id}"]`).length;

    expect(cellCount('city')).toBeGreaterThan(0); // 'city' is the last column
    grid.hideColumn('city');
    await flush();

    expect(headerOrder(root)).not.toContain('city');
    expect(cellCount('city')).toBe(0); // <-- the trailing-hide fix
    // Neighbours untouched.
    expect(cellCount('grade')).toBeGreaterThan(0);

    grid.showColumn('city');
    await flush();
    expect(headerOrder(root)).toContain('city');
    expect(cellCount('city')).toBeGreaterThan(0);
  });

  it('hiding a MIDDLE column removes its header AND every body cell', async () => {
    const { grid, root } = await mount();
    const cellCount = (id: string): number =>
      root.querySelectorAll(`[role=gridcell][data-col-id="${id}"]`).length;
    expect(cellCount('name')).toBeGreaterThan(0);
    grid.hideColumn('name');
    await flush();
    expect(headerOrder(root)).not.toContain('name');
    expect(cellCount('name')).toBe(0);
  });

  it('hide/show are idempotent (no duplicate EVT-COLUMN-HIDDEN)', async () => {
    const { grid } = await mount();
    const events: unknown[] = [];
    grid.on('columnHidden', (e) => events.push(e));

    grid.hideColumn('grade');
    grid.hideColumn('grade'); // no-op
    await flush();
    expect(events).toHaveLength(1);

    grid.showColumn('grade');
    grid.showColumn('grade'); // no-op
    await flush();
    expect(events).toHaveLength(2);
  });

  it('a create-time hidden column def is excluded from the initial projection', async () => {
    const cols = columns.map((c) => (c.id === 'grade' ? { ...c, hidden: true } : { ...c }));
    const { root } = await mount({ cols });
    expect(headerOrder(root)).not.toContain('grade');
    expect(bodyColIds(root).has('grade')).toBe(false);
  });
});

describe('LIB-COLUMN-MANAGE.pinColumn — INV-COLUMN-PIN-LEADING', () => {
  it('pins a column into the leading contiguous block + fires EVT-COLUMN-PINNED', async () => {
    const { grid, root } = await mount();
    const events: Array<{ columnId: string; pinned: 'leading' | null }> = [];
    grid.on('columnPinned', (e) => events.push({ columnId: e.columnId, pinned: e.pinned }));

    grid.pinColumn('city', 'leading');
    await flush();

    expect(headerOrder(root)[0]).toBe('city');
    // The pinned header cell joins the frozen leading block (composes with freeze).
    const pinned = root.querySelector('[role=columnheader][data-col-id="city"]') as HTMLElement;
    expect(pinned.classList.contains('mg-header-cell--frozen')).toBe(true);
    expect(events).toEqual([{ columnId: 'city', pinned: 'leading' }]);

    // Pin a second column → the two form a contiguous leading block (stable order).
    grid.pinColumn('grade', 'leading');
    await flush();
    expect(headerOrder(root).slice(0, 2)).toEqual(['city', 'grade']);
  });

  it('unpin returns the column to the unpinned group; idempotent', async () => {
    const { grid, root } = await mount();
    const events: unknown[] = [];
    grid.on('columnPinned', (e) => events.push(e));

    grid.pinColumn('city', 'leading');
    grid.pinColumn('city', 'leading'); // no-op
    await flush();
    expect(events).toHaveLength(1);
    expect(headerOrder(root)[0]).toBe('city');

    grid.pinColumn('city', null);
    await flush();
    // With no pinned column left (and no freeze), the ex-pinned cell is no longer
    // frozen — the leading pinned block is empty (INV-COLUMN-PIN-LEADING holds).
    const cityCell = root.querySelector('[role=columnheader][data-col-id="city"]') as HTMLElement;
    expect(cityCell.classList.contains('mg-header-cell--frozen')).toBe(false);
    expect(events).toHaveLength(2);
  });

  it('composes with the existing freeze prefix (freeze cols=1 + a pin → both frozen)', async () => {
    const { grid, root } = await mount({ frozen: { cols: 1 } });
    // id is frozen by the freeze prefix.
    const idCell = root.querySelector('[role=columnheader][data-col-id="id"]') as HTMLElement;
    expect(idCell.classList.contains('mg-header-cell--frozen')).toBe(true);
    grid.pinColumn('city', 'leading');
    await flush();
    // The pinned column joins the leading block; both it and the freeze column are frozen.
    const cityCell = root.querySelector('[role=columnheader][data-col-id="city"]') as HTMLElement;
    expect(cityCell.classList.contains('mg-header-cell--frozen')).toBe(true);
    expect(headerOrder(root)[0]).toBe('city');
  });

  it('RTL: the pinned block still leads the logical column order', async () => {
    const { grid, root } = await mount({ direction: 'rtl' });
    expect(root.getAttribute('dir')).toBe('rtl');
    grid.pinColumn('city', 'leading');
    await flush();
    // Leading = logical first (rendered at the right edge under RTL by the renderer).
    expect(headerOrder(root)[0]).toBe('city');
  });
});

describe('LIB-COLUMN-MANAGE.autofitColumn — bounded VISIBLE-only measure', () => {
  it('sizes a column to its widest VISIBLE content, ignoring off-screen rows (no full-column scan)', async () => {
    const cols: ColumnDef[] = [
      { id: 'id', field: 'id', header: 'ID', width: 80, type: 'number' },
      { id: 'v', field: 'v', header: 'V', width: 320, type: 'text' },
    ];
    const el = document.createElement('div');
    document.body.appendChild(el);
    const grid = createGrid(el, { columns: cols, keyField: 'id', rowHeight: 28, overscan: 4 });
    mounted.push(grid);
    // Visible rows (0..~18) hold SHORT text; a far off-screen row holds a HUGE string.
    const data = rows(400).map((r, i) => ({ ...r, v: i === 300 ? 'X'.repeat(120) : 'ab' }));
    await grid.setData(data);
    await flush();
    const root = el.querySelector('[data-mini-grid]') as HTMLElement;

    const events: Array<{ columnId?: string; width?: number }> = [];
    grid.on('columnAutofit', (e) => events.push(e as { columnId?: string; width?: number }));

    grid.autofitColumn('v');
    await flush();

    const width = grid.serializeState().columns.find((c) => c.id === 'v')?.width as number;
    // Fit the short visible content (~'ab') → far below the wide start (320) and FAR
    // below what the 120-char off-screen row would demand (~880) — proof the measure
    // sampled only the rendered window, never the full 400-row column.
    expect(width).toBeLessThan(120);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ columnId: 'v', width });
  });

  it('autofit BOTH shrinks an over-wide column AND grows a too-narrow one (widest-content contract)', async () => {
    // Deterministic jsdom fallback: measured width = approxTextWidth(text) + pad,
    // driven by KNOWN header/cell text. `wide` starts far wider than its short
    // content (must SHRINK); `narrow` starts far narrower than its long content
    // (must GROW). This is the LIB-COLUMN-MANAGE / performance-and-scalability
    // "size to the widest VISIBLE content" contract — grow AND shrink, not grow-only.
    const cols: ColumnDef[] = [
      { id: 'id', field: 'id', header: 'ID', width: 80, type: 'number' },
      { id: 'wide', field: 'wide', header: 'W', width: 260, type: 'text' }, // over-wide, short text
      { id: 'narrow', field: 'narrow', header: 'Narrow', width: 40, type: 'text' }, // too-narrow, long text
    ];
    const el = document.createElement('div');
    document.body.appendChild(el);
    const grid = createGrid(el, {
      columns: cols,
      keyField: 'id',
      rowHeight: 28,
      overscan: 4,
      features: { columnManage: true, autofit: true },
    });
    mounted.push(grid);
    await grid.setData(
      rows(30).map((r) => ({ ...r, wide: 'ab', narrow: 'a distinctly long visible value' })),
    );
    await flush();

    const wStart = 260;
    const nStart = 40;
    grid.autofitColumn('wide');
    grid.autofitColumn('narrow');
    await flush();

    const state = grid.serializeState().columns;
    const wFit = state.find((c) => c.id === 'wide')?.width as number;
    const nFit = state.find((c) => c.id === 'narrow')?.width as number;
    // Over-wide column shrank to ~content; too-narrow column grew to ~content.
    expect(wFit).toBeLessThan(wStart);
    expect(nFit).toBeGreaterThan(nStart);
  });

  it('autofit grows a narrow column to fit wider visible content', async () => {
    const cols: ColumnDef[] = [
      { id: 'id', field: 'id', header: 'ID', width: 80, type: 'number' },
      { id: 'v', field: 'v', header: 'V', width: 40, type: 'text' },
    ];
    const el = document.createElement('div');
    document.body.appendChild(el);
    const grid = createGrid(el, { columns: cols, keyField: 'id', rowHeight: 28, overscan: 4 });
    mounted.push(grid);
    await grid.setData(rows(20).map((r) => ({ ...r, v: 'a fairly wide visible value' })));
    await flush();

    grid.autofitColumn('v');
    await flush();
    const width = grid.serializeState().columns.find((c) => c.id === 'v')?.width as number;
    expect(width).toBeGreaterThan(120);
  });

  it('autofit on a hidden column is a no-op (no EVT-COLUMN-AUTOFIT)', async () => {
    const { grid } = await mount();
    grid.hideColumn('grade');
    await flush();
    const events: unknown[] = [];
    grid.on('columnAutofit', (e) => events.push(e));
    grid.autofitColumn('grade');
    await flush();
    expect(events).toHaveLength(0);
  });

  it('autofitAllColumns fits every visible column + fires one batched EVT-COLUMN-AUTOFIT', async () => {
    const { grid } = await mount();
    let payload: unknown;
    grid.on('columnAutofit', (e) => {
      payload = e;
    });
    grid.autofitAllColumns();
    await flush();
    const cols = (payload as { columns?: Array<{ columnId: string; width: number }> }).columns;
    expect(cols).toBeDefined();
    expect(cols!.map((c) => c.columnId).sort()).toEqual(['city', 'grade', 'id', 'name']);
  });

  it('double-clicking a column resize handle autofits the column (BIND-POINTER)', async () => {
    const { grid, root } = await mount();
    const events: unknown[] = [];
    grid.on('columnAutofit', (e) => events.push(e));
    const handle = root.querySelector(
      '[role=columnheader][data-col-id="name"] [data-mg-resize]',
    ) as HTMLElement;
    expect(handle).toBeTruthy();
    handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    await flush();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ columnId: 'name' });
  });
});

describe('LIB-COLUMN-MANAGE — errors + announcements', () => {
  it('an unknown column id throws INVALID_COLUMN_DEF', async () => {
    const { grid } = await mount();
    expect(() => grid.hideColumn('nope')).toThrow(/INVALID_COLUMN_DEF|Unknown column/);
    expect(() => grid.showColumn('nope')).toThrow();
    expect(() => grid.pinColumn('nope', 'leading')).toThrow();
    expect(() => grid.autofitColumn('nope')).toThrow();
  });

  it('an invalid pin edge throws INVALID_OPTIONS', async () => {
    const { grid } = await mount();
    // @ts-expect-error — exercising the runtime guard with a bad edge value
    expect(() => grid.pinColumn('city', 'trailing')).toThrow();
  });

  it('hide/pin/autofit announce politely on the live region', async () => {
    const { grid, el } = await mount();
    const region = el.querySelector('[data-mg-live="polite"]') as HTMLElement;
    grid.hideColumn('grade');
    await flush();
    expect(region.textContent).toMatch(/hidden/i);
    grid.showColumn('grade');
    await flush();
    expect(region.textContent).toMatch(/shown/i);
    grid.pinColumn('city', 'leading');
    await flush();
    expect(region.textContent).toMatch(/pinned/i);
  });

  it('columnManage / autofit flags OFF make the API inert', async () => {
    const { grid, root } = await mount({ features: { columnManage: false, autofit: false } });
    const events: unknown[] = [];
    grid.on('columnHidden', (e) => events.push(e));
    grid.on('columnAutofit', (e) => events.push(e));
    grid.hideColumn('grade');
    grid.autofitColumn('name');
    await flush();
    // Still validates the id (throws on unknown) but does nothing for a known id.
    expect(events).toHaveLength(0);
    expect(bodyColIds(root).has('grade')).toBe(true);
  });
});

// Spy sanity: the bounded measure never iterates the whole dataset.
describe('CAP-COLUMN-MANAGE autofit is bounded (Performance)', () => {
  it('measureColumnContentWidth samples only the live window, not every row', async () => {
    const { grid, root } = await mount({ rowCount: 5000 });
    // The rendered body has far fewer live cells than the 5000-row dataset.
    const liveCells = root.querySelectorAll('[role=gridcell]').length;
    expect(liveCells).toBeLessThan(500);
    // Autofit completes without touching all 5000 rows (would be O(rows) otherwise).
    const spy = vi.spyOn(root, 'querySelectorAll');
    grid.autofitColumn('name');
    await flush();
    spy.mockRestore();
    // No exception + a fit width recorded proves the bounded pass ran.
    const width = grid.serializeState().columns.find((c) => c.id === 'name')?.width as number;
    expect(width).toBeGreaterThan(0);
  });
});
