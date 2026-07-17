/**
 * `JOURNEY-HEADER` (slice 18, `CAP-HEADER`) — the unified header region against
 * the live `demo/header.html` surface in Chromium. Proves on the real DOM
 * (attributes / roles / geometry — no pixel snapshots):
 *
 *  1. Multi-band column headers render as role=row bands with developer spans
 *     (`aria-colspan` / `data-band`).
 *  2. The row-header gutter shows the visual number, is `role="rowheader"`, and
 *     stays frozen (pinned) on horizontal scroll.
 *  3. A corner click selects the whole sheet (developer-customized content +
 *     "Select all" accessible name).
 *  4. `headerTooltip` sets a title; a wrapping label carries the wrap class.
 *  5. Band-height + row-header-width drag-resize change the geometry.
 *  6. The dual-fire split: clicking the header BODY line-selects the column while
 *     the sort affordance sorts — never both.
 *  7. `AC-HEADER-A11Y` — axe reports ZERO violations with the header region,
 *     LTR + RTL.
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/* eslint-disable @typescript-eslint/no-explicit-any */

test.beforeEach(async ({ page }) => {
  await page.goto("/demo/header.html");
  await page.waitForFunction(() => (window as any).__ready === true, null, {
    timeout: 60_000,
  });
  await page.waitForSelector("[role=rowheader]", { state: "attached" });
});

const bandCell = (colId: string, band: number) =>
  `[role=columnheader][data-band="${band}"][data-col-id="${colId}"]`;

test("multi-band column headers render with spans (aria-colspan + data-band)", async ({
  page,
}) => {
  const bands = page.locator(".mg-header [role=row]");
  await expect(bands).toHaveCount(2);
  // Band-0 group header spans two columns.
  const group = page.locator(bandCell("id", 0));
  await expect(group).toHaveAttribute("aria-colspan", "2");
  await expect(group).toHaveText(/Identity/);
  // Band-1 carries the per-column label.
  await expect(page.locator(bandCell("name", 1))).toHaveText(/Name/);
});

test("row-header gutter shows the number, is role=rowheader, and is frozen on horizontal scroll", async ({
  page,
}) => {
  const first = page.locator('[role=rowheader][data-row-index="0"]');
  await expect(first).toHaveText("1"); // 1-based visual position
  const before = await first.boundingBox();
  // Scroll the body horizontally; the gutter cell must stay pinned at the leading edge.
  await page.evaluate(() => {
    const s = (window as any).__scroller();
    s.scrollLeft = 300;
    s.dispatchEvent(new Event("scroll"));
  });
  await page.waitForTimeout(100);
  const after = await first.boundingBox();
  expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeLessThan(2); // pinned
});

test("corner click selects the whole sheet (Select all + custom content)", async ({
  page,
}) => {
  const corner = page.locator("[data-mg-corner]");
  await expect(corner).toHaveAttribute("aria-label", "Select all");
  await expect(corner).toHaveText(/✔/);
  await corner.click();
  const sel = await page.evaluate(() => (window as any).__grid.getSelection());
  expect(sel.ranges[0].top).toBe(0);
  expect(sel.ranges[0].left).toBe(0);
  expect(sel.ranges[0].right).toBe(5); // 6 columns
});

test("headerTooltip sets a title; a wrapping label carries the wrap class", async ({
  page,
}) => {
  await expect(page.locator(bandCell("id", 1))).toHaveAttribute(
    "title",
    "The row identifier",
  );
  await expect(page.locator(".mg-header-label--wrap").first()).toBeVisible();
});

test("dual-fire: header body line-selects the column while the sort affordance sorts", async ({
  page,
}) => {
  // Clicking the header BODY (outside the sort affordance) line-selects the column.
  await page.locator(`${bandCell("grade", 1)} [data-mg-header-body]`).click();
  let sort = await page.evaluate(() => (window as any).__grid.getSortSpec());
  expect(sort.entries.length).toBe(0); // did NOT sort
  let sel = await page.evaluate(() => (window as any).__grid.getSelection());
  expect(sel.ranges[0].left).toBe(3); // column "grade" (index 3) line-selected
  expect(sel.ranges[0].right).toBe(3);

  // Clicking the sort affordance (label) sorts and does NOT line-select.
  await page.locator(`${bandCell("score", 1)} [data-mg-sort]`).click();
  sort = await page.evaluate(() => (window as any).__grid.getSortSpec());
  expect(sort.entries.length).toBe(1);
  expect(sort.entries[0].columnId).toBe("score");
});

test("AC-HEADER-SPAN-SELECT: clicking a spanning group header line-selects ALL columns it spans", async ({
  page,
}) => {
  // Band-0 "Identity" group spans id(0)+name(1). Clicking it must line-select the
  // WHOLE spanned range — not just the anchor column (the slice-21 BUG-1 fix).
  await page.locator(bandCell("id", 0)).click();
  const sel = await page.evaluate(() => (window as any).__grid.getSelection());
  const cols = new Set<number>();
  for (const r of sel.ranges) for (let c = r.left; c <= r.right; c++) cols.add(c);
  expect([...cols].sort((a, b) => a - b)).toEqual([0, 1]); // span=2 columns, not 1
  for (const r of sel.ranges) expect(r.top).toBe(0); // full-height column lines
  // DOM: both spanned columns carry selected body cells; the next column does not.
  await expect(
    page.locator('[role=gridcell][data-col-id="id"][aria-selected="true"]').first(),
  ).toBeVisible();
  await expect(
    page.locator('[role=gridcell][data-col-id="name"][aria-selected="true"]').first(),
  ).toBeVisible();
  await expect(
    page.locator('[role=gridcell][data-col-id="score"][aria-selected="true"]'),
  ).toHaveCount(0);
});

test("DOM-HEADER: after sorting, exactly one aria-sort cell exists for the column (no band/span leak)", async ({
  page,
}) => {
  // Sort "id" via its bottom-band sort affordance (cycles → ascending).
  await page.locator(`${bandCell("id", 1)} [data-mg-sort]`).click();
  const sort = await page.evaluate(() => (window as any).__grid.getSortSpec());
  expect(sort.entries[0].columnId).toBe("id");
  // Exactly ONE header cell carries the sort indicator — id's bottom-band affordance
  // cell — and NOT the spanning band-0 "Identity" cell that covers id (BUG-2 fix).
  await expect(page.locator('[role=columnheader][aria-sort="ascending"]')).toHaveCount(1);
  await expect(page.locator(bandCell("id", 1))).toHaveAttribute("aria-sort", "ascending");
  await expect(page.locator(bandCell("id", 0))).not.toHaveAttribute("aria-sort", /.*/);
});

test("row-header gutter line-selects the whole row", async ({ page }) => {
  await page.locator('[role=rowheader][data-row-index="2"]').click();
  const sel = await page.evaluate(() => (window as any).__grid.getSelection());
  expect(sel.ranges[0].top).toBe(2);
  expect(sel.ranges[0].bottom).toBe(2);
  expect(sel.ranges[0].right).toBe(5); // full-width row line
});

test("band-height resize changes the band geometry", async ({ page }) => {
  const band = page.locator(".mg-header [role=row]").nth(1);
  const before = await band.boundingBox();
  // Resize band 1 via its own bottom-edge handle (band-1 cell, e.g. "name").
  const handle = page.locator(`${bandCell("name", 1)} [data-mg-band-resize]`);
  const hb = await handle.boundingBox();
  await page.mouse.move(hb!.x + hb!.width / 2, hb!.y + hb!.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb!.x + hb!.width / 2, hb!.y + 20);
  await page.mouse.up();
  const after = await band.boundingBox();
  expect((after?.height ?? 0)).toBeGreaterThan((before?.height ?? 0));
});

test("row-header width resize widens the gutter", async ({ page }) => {
  const corner = page.locator("[data-mg-corner]");
  const before = await corner.boundingBox();
  const handle = page.locator("[data-mg-rowheader-resize]");
  const hb = await handle.boundingBox();
  await page.mouse.move(hb!.x + hb!.width / 2, hb!.y + hb!.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb!.x + 30, hb!.y + hb!.height / 2);
  await page.mouse.up();
  const after = await corner.boundingBox();
  expect((after?.width ?? 0)).toBeGreaterThan((before?.width ?? 0));
});

// ===========================================================================
// CAP-COLUMN-MANAGE (LIB-COLUMN-MANAGE) — hide/show + leading pin + autofit.
// Driven via the demo's buttons/API (NOT a menu — configurable menus are slice
// 20). Proves AC-COLUMN-MANAGE + the polite hide/pin/autofit announcements.
// ===========================================================================
const politeRegion = '[data-mg-live="polite"]';
const gradeHeader = `[role=columnheader][data-band="1"][data-col-id="grade"]`;
const cityHeader = `[role=columnheader][data-band="1"][data-col-id="city"]`;

test("hide a column removes it (others reflow); show returns it", async ({ page }) => {
  await expect(page.locator(gradeHeader)).toBeVisible();
  const cityBefore = await page.locator(cityHeader).boundingBox();

  await page.locator("#hide-grade").click();
  await expect(page.locator(gradeHeader)).toHaveCount(0);
  // Grade body cells are gone; the remaining columns reflow leftward (city shifts).
  await expect(page.locator('[role=gridcell][data-col-id="grade"]')).toHaveCount(0);
  const cityAfter = await page.locator(cityHeader).boundingBox();
  expect((cityAfter?.x ?? 0)).toBeLessThan((cityBefore?.x ?? 0));

  await page.locator("#show-grade").click();
  await expect(page.locator(gradeHeader)).toBeVisible();
  await expect(page.locator('[role=gridcell][data-col-id="grade"]').first()).toBeVisible();
});

test("hide announces politely (Column Grade hidden)", async ({ page }) => {
  await page.locator("#hide-grade").click();
  await expect(page.locator(politeRegion)).toHaveText(/hidden/i);
});

test("pin a column keeps it in the leading block under horizontal scroll", async ({
  page,
}) => {
  await page.locator("#pin-city").click();
  const city = page.locator(cityHeader);
  // Pinned → joins the frozen leading block.
  await expect(city).toHaveClass(/mg-header-cell--frozen/);
  const before = await city.boundingBox();
  await page.evaluate(() => {
    const s = (window as any).__scroller();
    s.scrollLeft = 300;
    s.dispatchEvent(new Event("scroll"));
  });
  await page.waitForTimeout(100);
  const after = await city.boundingBox();
  expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeLessThan(2); // stays pinned
  await expect(page.locator(politeRegion)).toHaveText(/pinned/i);
});

test("double-clicking a column resize handle autofits it (fit-to-content)", async ({
  page,
}) => {
  const name = page.locator(`[role=columnheader][data-band="1"][data-col-id="name"]`);
  const before = await name.boundingBox();
  await page.locator(`${`[role=columnheader][data-band="1"][data-col-id="name"]`} [data-mg-resize]`).dblclick();
  await page.waitForTimeout(100);
  const after = await name.boundingBox();
  // The visible "Person N" content is narrower than the 160px default → shrinks.
  expect((after?.width ?? 999)).toBeLessThan((before?.width ?? 0));
  await expect(page.locator(politeRegion)).toHaveText(/resized to fit/i);
});

test("fit-all autofits every visible column", async ({ page }) => {
  const widths = async () =>
    page.evaluate(() =>
      (window as any).__grid.serializeState().columns.map((c: any) => c.width),
    );
  const before = await widths();
  await page.locator("#autofit-all").click();
  await page.waitForTimeout(100);
  const after = await widths();
  expect(after).not.toEqual(before); // at least one column resized to fit
  await expect(page.locator(politeRegion)).toHaveText(/resized to fit/i);
});

test("AC-COLUMN-MANAGE-A11Y — axe ZERO violations after hide + pin", async ({
  page,
}) => {
  await page.locator("#hide-grade").click();
  await page.locator("#pin-city").click();
  // Give the scrollable body a focusable descendant (roving tabindex) for axe —
  // click a non-frozen body cell (the pinned leading cell fails hit-testing).
  await page.locator('[role=gridcell][data-col-id="name"]').first().click();
  const results = await new AxeBuilder({ page }).include("[data-mini-grid]").analyze();
  expect(results.violations).toEqual([]);
});

test("AC-HEADER-A11Y — axe ZERO violations with the header region (LTR)", async ({
  page,
}) => {
  // Focus a cell so the scrollable body has a focusable descendant (roving tabindex).
  await page.locator('[role=gridcell][aria-rowindex="1"][aria-colindex="1"]').click();
  const results = await new AxeBuilder({ page }).include("[data-mini-grid]").analyze();
  expect(results.violations).toEqual([]);
});

test("AC-HEADER-A11Y — axe ZERO violations with the header region (RTL)", async ({
  page,
}) => {
  await page.evaluate(() => (window as any).__grid.setDirection("rtl"));
  await expect(page.locator('[data-mini-grid][dir="rtl"]')).toBeVisible();
  await page.locator('[role=gridcell][aria-rowindex="1"][aria-colindex="1"]').click();
  const results = await new AxeBuilder({ page }).include("[data-mini-grid]").analyze();
  expect(results.violations).toEqual([]);
});
