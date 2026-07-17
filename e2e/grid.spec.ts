/**
 * `E2E-STANDARD` — the first real-flow end-to-end journey for mini-grid,
 * traversing the scroll+select portion of `JOURNEY-BROWSE` against the real
 * demo (1,000,000 rows) in Chromium, plus an axe-core a11y gate (`AC-AXE`).
 *
 * Proves, on the live surface (not frame timings — run-invariant observables):
 *  1. Virtualization real-flow — scrolling changes the rendered row window while
 *     the live `role=gridcell` node count stays bounded (`CAP-VIRTUALIZE`).
 *  2. Pointer select — click sets `aria-selected` + roving focus (`BIND-POINTER`).
 *  3. Keyboard nav — ArrowDown/ArrowRight move the active cell (`BIND-KEYS`).
 *  4. Shift-extend — Shift+ArrowDown grows a contiguous selection range.
 *  5. Accessibility — axe-core reports ZERO violations on the grid (`A11Y-GRID`).
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ page }) => {
  await page.goto("/demo/index.html");
  await page.waitForFunction(() => (window as any).__ready === true, null, {
    timeout: 60_000,
  });
  await page.waitForSelector('[role=gridcell]', { state: "attached" });
});

/** Min logical row index (1-based `aria-rowindex`) currently in the DOM. */
function minRowIndex(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => {
    const cells = [...document.querySelectorAll('[role=gridcell]')];
    return Math.min(...cells.map((c) => Number(c.getAttribute("aria-rowindex"))));
  });
}

test("virtualization real-flow: scroll changes the rendered window, nodes stay bounded", async ({
  page,
}) => {
  const before = await minRowIndex(page);
  const nodesBefore = await page.evaluate(
    () => document.querySelectorAll('[role=gridcell]').length,
  );
  expect(nodesBefore).toBeLessThan(600); // bounded window, not 1M rows

  await page.locator(".mg-scroll").evaluate((el) => {
    (el as HTMLElement).scrollTop = 40_000;
  });

  // The rendered row window advanced well past the original top rows.
  await expect
    .poll(() => minRowIndex(page), { timeout: 10_000 })
    .toBeGreaterThan(before + 500);

  // Live node count is still bounded (virtualization held during the flow).
  const nodesAfter = await page.evaluate(
    () => document.querySelectorAll('[role=gridcell]').length,
  );
  expect(nodesAfter).toBeLessThan(600);
});

test("pointer select: click sets aria-selected + roving focus (BIND-POINTER)", async ({
  page,
}) => {
  const cell = page.locator(
    '[role=gridcell][aria-rowindex="1"][aria-colindex="2"]',
  );
  await cell.click();

  await expect(cell).toHaveAttribute("aria-selected", "true");
  await expect(cell).toHaveAttribute("tabindex", "0");
  await expect(cell).toBeFocused();

  // Roving tabindex: exactly one cell is the tab stop.
  await expect(page.locator('[role=gridcell][tabindex="0"]')).toHaveCount(1);
});

test("keyboard nav: ArrowDown/ArrowRight move the active cell (BIND-KEYS)", async ({
  page,
}) => {
  await page
    .locator('[role=gridcell][aria-rowindex="1"][aria-colindex="1"]')
    .click();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");

  const active = page.locator('[role=gridcell][tabindex="0"]');
  await expect(active).toHaveAttribute("aria-rowindex", "2");
  await expect(active).toHaveAttribute("aria-colindex", "2");
  await expect(active).toBeFocused();
});

test("shift-extend: Shift+ArrowDown grows a contiguous selection range", async ({
  page,
}) => {
  await page
    .locator('[role=gridcell][aria-rowindex="2"][aria-colindex="2"]')
    .click();
  await page.keyboard.press("Shift+ArrowDown");

  await expect(page.locator('[role=gridcell][aria-selected="true"]')).toHaveCount(
    2,
  );
  const range = await page.evaluate(
    () => (window as any).__grid.getSelection().ranges[0],
  );
  expect(range).toEqual({ top: 1, bottom: 2, left: 1, right: 1 });
});

test("multi-range: 2× Ctrl+click selects two disjoint ranges (AC-SELECTION-SET)", async ({
  page,
}) => {
  await page.locator('[role=gridcell][aria-rowindex="1"][aria-colindex="2"]').click();
  await page
    .locator('[role=gridcell][aria-rowindex="3"][aria-colindex="4"]')
    .click({ modifiers: ["Control"] });

  const ranges = await page.evaluate(
    () => (window as any).__grid.getSelection().ranges.length,
  );
  expect(ranges).toBe(2); // disjoint set (INV-SELECTION-WELLFORMED)
  await expect(page.locator('[role=gridcell][aria-selected="true"]')).toHaveCount(2);
});

test("column-header click line-selects the whole column (CAP-SELECT / INV-SELECTION-LINE)", async ({
  page,
}) => {
  // Dual-fire split (slice 18): the header BODY (outside the sort affordance)
  // line-selects the column; the sort affordance (`.mg-header-label`) sorts.
  await page.locator('[role=columnheader][data-col-id="c1"] [data-mg-header-body]').click();
  const sel = await page.evaluate(() => (window as any).__grid.getSelection());
  // c1 is column index 1 → a full-height range + a column line entry.
  expect(sel.ranges[0].left).toBe(1);
  expect(sel.ranges[0].right).toBe(1);
  expect(sel.ranges[0].top).toBe(0);
  expect(sel.ranges[0].bottom).toBeGreaterThan(1000); // spans all 1M rows
  expect(sel.lines).toContainEqual({ kind: "column", index: 1 });
});

test("select-all selects the whole sheet (CAP-SELECT corner select-all)", async ({
  page,
}) => {
  await page.evaluate(() => (window as any).__grid.selectAll());
  const r = await page.evaluate(() => (window as any).__grid.getSelection().ranges[0]);
  expect(r.top).toBe(0);
  expect(r.left).toBe(0);
  expect(r.bottom).toBeGreaterThan(1000);
  expect(r.right).toBeGreaterThan(5); // spans every column
});

test("shift-click extends the active range (AC-SELECTION-SET)", async ({ page }) => {
  await page.locator('[role=gridcell][aria-rowindex="2"][aria-colindex="2"]').click();
  await page
    .locator('[role=gridcell][aria-rowindex="4"][aria-colindex="3"]')
    .click({ modifiers: ["Shift"] });
  const r = await page.evaluate(() => (window as any).__grid.getSelection().ranges[0]);
  expect(r).toEqual({ top: 1, bottom: 3, left: 1, right: 2 });
});

test("AC-MULTI-SELECT-A11Y: axe reports ZERO violations with a multi-range selection", async ({
  page,
}) => {
  await page.locator('[role=gridcell][aria-rowindex="1"][aria-colindex="1"]').click();
  await page
    .locator('[role=gridcell][aria-rowindex="4"][aria-colindex="3"]')
    .click({ modifiers: ["Control"] });
  await expect(page.locator('[role=gridcell][aria-selected="true"]')).toHaveCount(2);

  const results = await new AxeBuilder({ page })
    .include("[data-mini-grid]")
    .analyze();
  expect(results.violations).toEqual([]);
});

test("a11y: axe-core reports ZERO violations on the grid (AC-AXE)", async ({
  page,
}) => {
  // Seed a selection so aria-selected/roving-focus are exercised under axe too.
  await page
    .locator('[role=gridcell][aria-rowindex="1"][aria-colindex="1"]')
    .click();

  const results = await new AxeBuilder({ page })
    .include("[data-mini-grid]")
    .analyze();

  expect(results.violations).toEqual([]);
});
