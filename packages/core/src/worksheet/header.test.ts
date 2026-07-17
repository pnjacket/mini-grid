// @vitest-environment jsdom
/**
 * `AC-HEADER-CONFIG` / `AC-HEADER-A11Y` (`CAP-HEADER`, slice 18) — the unified
 * header region: N column-header bands + spans (`DOM-HEADER`), the frozen
 * row-header gutter (`DOM-ROWHEADER`), the corner (`DOM-CORNER`), tooltips, band
 * resize, wrap, and the sort-vs-line-select **dual-fire** split.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { createGrid } from '../api/grid.js';
import type { ColumnDef, Grid } from '../api/options.js';
import type { HeaderConfig } from '../types.js';
import type { FeatureFlags } from '../api/features.js';

const columns: ColumnDef[] = [
  { id: 'id', field: 'id', header: 'ID', width: 80, type: 'number' },
  { id: 'k', field: 'k', header: 'K', width: 90, type: 'number' },
  { id: 't', field: 't', header: 'T', width: 90, type: 'text' },
];

function rows(n = 6): Array<Record<string, unknown>> {
  return Array.from({ length: n }, (_, i) => ({ id: i, k: n - i, t: `t${i}` }));
}

const mounted: Grid[] = [];
afterEach(() => {
  for (const g of mounted) g.destroy();
  mounted.length = 0;
  document.body.innerHTML = '';
});

async function flush(r = 8): Promise<void> {
  for (let i = 0; i < r; i++) {
    await Promise.resolve();
    await new Promise((res) => setTimeout(res, 0));
  }
}

async function mount(
  header?: HeaderConfig,
  extra?: { features?: Partial<FeatureFlags>; cols?: ColumnDef[] },
): Promise<{ grid: Grid; root: HTMLElement }> {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const grid = createGrid(el, {
    columns: extra?.cols ?? columns,
    keyField: 'id',
    rowHeight: 28,
    overscan: 6,
    ...(header ? { header } : {}),
    ...(extra?.features ? { features: extra.features } : {}),
  });
  mounted.push(grid);
  await grid.setData(rows());
  await flush();
  const root = el.querySelector('[data-mini-grid]') as HTMLElement;
  return { grid, root };
}

function fire(target: EventTarget, type: string, opts: MouseEventInit = {}): void {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...opts }));
}

const headerCell = (root: HTMLElement, colId: string, band?: number): HTMLElement =>
  root.querySelector(
    band === undefined
      ? `[role=columnheader][data-col-id="${colId}"]`
      : `[role=columnheader][data-col-id="${colId}"][data-band="${band}"]`,
  ) as HTMLElement;

describe('AC-HEADER-CONFIG — column-header bands + spans (DOM-HEADER)', () => {
  it('N bands render as role=row bands with data-band + declared spans', async () => {
    const { root } = await mount({
      columns: {
        bands: 2,
        render: (ctx) => {
          if (ctx.band === 0) {
            if (ctx.colIndex === 0) return { content: 'Group', colSpan: 2 };
            if (ctx.colIndex === 2) return 'Solo';
            return '';
          }
          return ctx.columnId ?? '';
        },
      },
    });
    // Two role=row bands inside the header rowgroup.
    const bands = root.querySelectorAll('.mg-header [role=row]');
    expect(bands.length).toBe(2);
    // Top-band group cell spans 2 columns.
    const group = headerCell(root, 'id', 0);
    expect(group.getAttribute('aria-colspan')).toBe('2');
    expect(group.textContent).toContain('Group');
    // The covered column (k) has no top-band cell; bottom band carries per-col labels.
    expect(headerCell(root, 'k', 0)).toBeNull();
    expect(headerCell(root, 'k', 1)).not.toBeNull();
    expect(headerCell(root, 't', 1)?.getAttribute('data-band')).toBe('1');
  });

  it('rowSpan renders aria-rowspan on the spanning cell', async () => {
    const { root } = await mount({
      columns: {
        bands: 2,
        render: (ctx) => {
          if (ctx.colIndex === 0 && ctx.band === 0) return { content: 'Tall', rowSpan: 2 };
          if (ctx.band === 1 && ctx.colIndex === 0) return ''; // covered
          return ctx.columnId ?? '';
        },
      },
    });
    expect(headerCell(root, 'id', 0)?.getAttribute('aria-rowspan')).toBe('2');
  });

  it('an overlapping span throws INVALID_OPTIONS at createGrid', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    expect(() =>
      createGrid(el, {
        columns,
        header: {
          columns: {
            bands: 2,
            render: (ctx) => {
              if (ctx.band === 0 && ctx.colIndex === 1) return { content: 'x', rowSpan: 2 };
              if (ctx.band === 1 && ctx.colIndex === 0) return { content: 'y', colSpan: 2 };
              return ctx.columnId ?? '';
            },
          },
        },
      }),
    ).toThrow(/INVALID_OPTIONS|overlap/i);
  });

  it('an out-of-bounds span throws INVALID_OPTIONS', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    expect(() =>
      createGrid(el, {
        columns,
        header: {
          columns: { render: (ctx) => (ctx.colIndex === 2 ? { content: 'x', colSpan: 2 } : '') },
        },
      }),
    ).toThrow(/INVALID_OPTIONS|bounds/i);
  });

  it('wrap toggles the multi-line label class', async () => {
    const { root } = await mount({ columns: { wrap: true } });
    expect(root.querySelector('.mg-header-label--wrap')).not.toBeNull();
    const { root: root2 } = await mount();
    expect(root2.querySelector('.mg-header-label--wrap')).toBeNull();
  });

  it('each sub-flag off removes only its affordance (corner.selectAll:false)', async () => {
    const { root } = await mount(
      { rows: {}, corner: { selectAll: false } },
      { features: { rowHeader: true } },
    );
    const corner = root.querySelector('[data-mg-corner]') as HTMLElement;
    expect(corner).not.toBeNull();
    expect(corner.hasAttribute('data-mg-select-all')).toBe(false);
  });
});

describe('AC-HEADER-CONFIG — row-header gutter (DOM-ROWHEADER)', () => {
  it("content 'number' renders the visual row position; cells are role=rowheader", async () => {
    const { root } = await mount({ rows: { content: 'number' } }, { features: { rowHeader: true } });
    const gutter = root.querySelectorAll('[role=rowheader]');
    expect(gutter.length).toBeGreaterThan(0);
    const first = root.querySelector('[role=rowheader][data-row-index="0"]') as HTMLElement;
    expect(first.textContent).toBe('1'); // 1-based visual position
    expect(first.getAttribute('data-band')).toBe('0');
  });

  it("content 'key' renders the row key", async () => {
    const { root } = await mount({ rows: { content: 'key' } }, { features: { rowHeader: true } });
    const first = root.querySelector('[role=rowheader][data-row-index="0"]') as HTMLElement;
    expect(first.getAttribute('data-row-key')).toBe('0');
    expect(first.textContent).toBe('0');
  });

  it('custom content renderer receives the row context', async () => {
    const { root } = await mount(
      { rows: { content: (ctx) => `R${ctx.rowIndex}` } },
      { features: { rowHeader: true } },
    );
    const c2 = root.querySelector('[role=rowheader][data-row-index="2"]') as HTMLElement;
    expect(c2.textContent).toBe('R2');
  });

  it('gutter shifts the data columns right (leading reserved width)', async () => {
    const { root } = await mount(
      { rows: { width: 50 } },
      { features: { rowHeader: true } },
    );
    const idCell = root.querySelector('[role=gridcell][data-col-id="id"][aria-rowindex="1"]') as HTMLElement;
    // Data column 0 now begins after the 50px gutter.
    expect(parseFloat(idCell.style.insetInlineStart)).toBeGreaterThanOrEqual(50);
  });

  it('rowHeader feature flag OFF suppresses the gutter even when configured', async () => {
    const { root } = await mount({ rows: {} }, { features: { rowHeader: false } });
    expect(root.querySelector('[role=rowheader]')).toBeNull();
  });

  it('no header.rows → no gutter (default off)', async () => {
    const { root } = await mount();
    expect(root.querySelector('[role=rowheader]')).toBeNull();
  });
});

describe('AC-HEADER-CONFIG — corner select-all (DOM-CORNER)', () => {
  it('a corner click selects the whole sheet', async () => {
    const { grid, root } = await mount({ rows: {} }, { features: { rowHeader: true } });
    const corner = root.querySelector('[data-mg-corner]') as HTMLElement;
    expect(corner.getAttribute('role')).toBe('columnheader');
    expect(corner.getAttribute('aria-label')).toBe('Select all');
    fire(corner, 'click');
    await flush();
    const sel = grid.getSelection();
    const r = sel.ranges[0]!;
    expect(r.top).toBe(0);
    expect(r.left).toBe(0);
    expect(r.right).toBe(columns.length - 1);
    expect(r.bottom).toBe(rows().length - 1);
  });
});

describe('AC-HEADER — tooltips (headerTooltip)', () => {
  it('headerTooltip sets title + aria-description when tooltips on', async () => {
    const cols: ColumnDef[] = [
      { id: 'id', field: 'id', header: 'ID', width: 80, headerTooltip: 'The identifier' },
      { id: 'k', field: 'k', header: 'K', width: 90 },
    ];
    const { root } = await mount(undefined, { cols });
    const idH = headerCell(root, 'id');
    expect(idH.getAttribute('title')).toBe('The identifier');
    expect(idH.getAttribute('aria-description')).toBe('The identifier');
  });

  it('tooltips:false disables the tooltip', async () => {
    const cols: ColumnDef[] = [
      { id: 'id', field: 'id', header: 'ID', width: 80, headerTooltip: 'The identifier' },
    ];
    const { root } = await mount({ tooltips: false }, { cols });
    expect(headerCell(root, 'id').hasAttribute('title')).toBe(false);
  });
});

describe('AC-HEADER — sort-vs-line-select dual-fire split (DOM-HEADER)', () => {
  it('clicking the header BODY line-selects the column and does NOT sort', async () => {
    const { grid, root } = await mount();
    const body = headerCell(root, 'k').querySelector('[data-mg-header-body]') as HTMLElement;
    fire(body, 'mousedown', { clientX: 10 });
    fire(document, 'mouseup', { clientX: 10 });
    await flush();
    expect(grid.getSortSpec().entries).toHaveLength(0); // did NOT sort
    const r = grid.getSelection().ranges[0]!;
    expect(r.left).toBe(1); // column k line-selected (full height)
    expect(r.right).toBe(1);
    expect(r.top).toBe(0);
    expect(r.bottom).toBe(rows().length - 1);
  });

  it('clicking the sort affordance (label) sorts and does NOT line-select', async () => {
    const { grid, root } = await mount();
    const label = headerCell(root, 'k').querySelector('[data-mg-sort]') as HTMLElement;
    expect(label).not.toBeNull();
    fire(label, 'mousedown', { clientX: 10 });
    fire(document, 'mouseup', { clientX: 10 });
    await flush();
    expect(grid.getSortSpec().entries).toHaveLength(1); // sorted
    expect(grid.getSortSpec().entries[0]!.columnId).toBe('k');
  });

  it('shift-click on the sort affordance adds a multi-sort key', async () => {
    const { grid, root } = await mount();
    const kLabel = headerCell(root, 'k').querySelector('[data-mg-sort]') as HTMLElement;
    fire(kLabel, 'mousedown', { clientX: 10 });
    fire(document, 'mouseup', { clientX: 10 });
    await flush();
    const tLabel = headerCell(root, 't').querySelector('[data-mg-sort]') as HTMLElement;
    fire(tLabel, 'mousedown', { clientX: 10, shiftKey: true });
    fire(document, 'mouseup', { clientX: 10, shiftKey: true });
    await flush();
    expect(grid.getSortSpec().entries.map((e) => e.columnId)).toEqual(['k', 't']);
  });
});

// A 2-band header: band 0 groups columns `id`+`k` under one spanning cell + a solo
// `t`; band 1 carries the per-column affordance labels. Used by the span-select and
// sort-indicator specs below (`AC-HEADER-SPAN-SELECT`, `DOM-HEADER`).
async function mountGrouped(): Promise<{ grid: Grid; root: HTMLElement }> {
  return mount({
    columns: {
      bands: 2,
      render: (ctx) => {
        if (ctx.band === 0) {
          if (ctx.colIndex === 0) return { content: 'Group', colSpan: 2 };
          if (ctx.colIndex === 2) return 'Solo';
          return '';
        }
        return ctx.columnId ?? '';
      },
    },
  });
}

describe('AC-HEADER-SPAN-SELECT — a spanning header cell line-selects all spanned columns', () => {
  const coveredCols = (grid: Grid): number[] => {
    const cols = new Set<number>();
    for (const r of grid.getSelection().ranges) for (let c = r.left; c <= r.right; c++) cols.add(c);
    return [...cols].sort((a, b) => a - b);
  };

  it('clicking a colSpan=2 group cell selects BOTH spanned columns (not just the anchor)', async () => {
    const { grid, root } = await mountGrouped();
    const group = headerCell(root, 'id', 0);
    expect(group.getAttribute('aria-colspan')).toBe('2');
    fire(group, 'mousedown', { clientX: 10 });
    fire(document, 'mouseup', { clientX: 10 });
    await flush();
    expect(coveredCols(grid)).toEqual([0, 1]); // full spanned range, not just anchor 0
    // Full-height column lines.
    for (const r of grid.getSelection().ranges) {
      expect(r.top).toBe(0);
      expect(r.bottom).toBe(rows().length - 1);
    }
  });

  it('Ctrl-clicking a span adds the whole spanned range disjoint to the existing selection', async () => {
    const { grid, root } = await mountGrouped();
    // Line-select column `t` (colIndex 2) first…
    const t = headerCell(root, 't', 1);
    fire(t, 'mousedown', { clientX: 10 });
    fire(document, 'mouseup', { clientX: 10 });
    await flush();
    expect(coveredCols(grid)).toEqual([2]);
    // …then Ctrl-click the group span → adds cols 0+1, keeping 2.
    const group = headerCell(root, 'id', 0);
    fire(group, 'mousedown', { clientX: 10, ctrlKey: true });
    fire(document, 'mouseup', { clientX: 10, ctrlKey: true });
    await flush();
    expect(coveredCols(grid)).toEqual([0, 1, 2]);
  });

  it('clicking a solo (colSpan=1) group-band cell selects only that column', async () => {
    const { grid, root } = await mountGrouped();
    const solo = headerCell(root, 't', 0);
    expect(solo.hasAttribute('aria-colspan')).toBe(false);
    fire(solo, 'mousedown', { clientX: 10 });
    fire(document, 'mouseup', { clientX: 10 });
    await flush();
    expect(coveredCols(grid)).toEqual([2]);
  });
});

describe('DOM-HEADER — the sort indicator sits on exactly one affordance cell (no band/span leak)', () => {
  const ariaSort = (root: HTMLElement, colId: string, band: number): string | null =>
    headerCell(root, colId, band)?.getAttribute('aria-sort') ?? null;

  it('a sorted column exposes aria-sort on ONLY its affordance (bottom-band, colSpan-1) cell', async () => {
    const { grid, root } = await mountGrouped();
    await grid.sort({ entries: [{ columnId: 'k', direction: 'asc' }] });
    await flush();
    // The one true indicator: k's bottom-band affordance cell.
    expect(ariaSort(root, 'k', 1)).toBe('ascending');
    // The spanning band-0 group cell (covers id+k) must NOT mirror it.
    expect(headerCell(root, 'id', 0).getAttribute('aria-colspan')).toBe('2');
    expect(headerCell(root, 'id', 0).hasAttribute('aria-sort')).toBe(false);
    expect(headerCell(root, 'id', 0).hasAttribute('data-sort-order')).toBe(false);
    // Other affordance (bottom-band, sortable) cells read 'none'.
    expect(ariaSort(root, 'id', 1)).toBe('none');
    expect(ariaSort(root, 't', 1)).toBe('none');
    // The solo band-0 `t` cell is not an affordance host → no aria-sort at all.
    expect(headerCell(root, 't', 0).hasAttribute('aria-sort')).toBe(false);
    // Exactly ONE ascending indicator exists across the whole header.
    expect(root.querySelectorAll('[role=columnheader][aria-sort="ascending"]').length).toBe(1);
  });
});

describe('AC-HEADER — band-height + row-header-width resize (headerResize)', () => {
  it('dragging the band-resize handle changes the band height', async () => {
    const { root } = await mount({ columns: { height: 30 } });
    const band = root.querySelector('.mg-header [role=row]') as HTMLElement;
    expect(band.style.height).toBe('30px');
    const handle = root.querySelector('[data-mg-band-resize]') as HTMLElement;
    expect(handle.style.display).not.toBe('none');
    fire(handle, 'mousedown', { clientY: 100 });
    fire(document, 'mousemove', { clientY: 120 });
    fire(document, 'mouseup', { clientY: 120 });
    await flush();
    expect(parseFloat(band.style.height)).toBeGreaterThan(30);
  });

  it('dragging the row-header resize handle changes the gutter width', async () => {
    const { root } = await mount(
      { rows: { width: 50, resizable: true } },
      { features: { rowHeader: true } },
    );
    const corner = root.querySelector('[data-mg-corner]') as HTMLElement;
    expect(parseFloat(corner.style.width)).toBe(50);
    const handle = root.querySelector('[data-mg-rowheader-resize]') as HTMLElement;
    expect(handle.style.display).not.toBe('none');
    fire(handle, 'mousedown', { clientX: 50 });
    fire(document, 'mousemove', { clientX: 90 });
    fire(document, 'mouseup', { clientX: 90 });
    await flush();
    expect(parseFloat(corner.style.width)).toBeGreaterThan(50);
  });

  it('headerResize OFF hides the band-resize handle', async () => {
    const { root } = await mount({ columns: {} }, { features: { headerResize: false } });
    const handle = root.querySelector('[data-mg-band-resize]') as HTMLElement;
    expect(handle.style.display).toBe('none');
  });
});

describe('AC-HEADER — row-header gutter line-select', () => {
  it('clicking a gutter cell line-selects the whole row', async () => {
    const { grid, root } = await mount(
      { rows: { content: 'number', select: true } },
      { features: { rowHeader: true } },
    );
    const rh = root.querySelector('[role=rowheader][data-row-index="2"]') as HTMLElement;
    fire(rh, 'click');
    await flush();
    const r = grid.getSelection().ranges[0]!;
    expect(r.top).toBe(2);
    expect(r.bottom).toBe(2);
    expect(r.left).toBe(0);
    expect(r.right).toBe(columns.length - 1); // full-width row line
  });

  it('select:false → clicking a gutter cell does not select', async () => {
    const { grid, root } = await mount(
      { rows: { select: false } },
      { features: { rowHeader: true } },
    );
    grid.clearSelection();
    const rh = root.querySelector('[role=rowheader][data-row-index="2"]') as HTMLElement;
    fire(rh, 'click');
    await flush();
    expect(grid.getSelection().ranges).toHaveLength(0);
  });
});
