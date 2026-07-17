/**
 * `JOURNEY-BROWSE` (slice 6a) — the worksheet journey (`CAP-SORT`/`-FILTER`/
 * `-RESIZE`/`-REORDER`/`-FREEZE`) against the live 1,000,000-row demo in Chromium.
 * Proves on the real surface (attributes / counts / geometry — no pixel snapshots):
 *
 *  1. Header click sorts (aria-sort + the first visible rows are ordered); a
 *     Shift-click on a second header adds a secondary key (multi-sort).
 *  2. The filter menu opens, applies a per-column filter, and the row count drops.
 *  3. Dragging the resize handle widens a column; dragging a header reorders it.
 *  4. Freezing the top row keeps it pinned at the top while the body scrolls.
 *  5. axe-core reports ZERO violations with the filter menu open (`AC-AXE`).
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/* eslint-disable @typescript-eslint/no-explicit-any */

test.beforeEach(async ({ page }) => {
  await page.goto("/demo/index.html");
  await page.waitForFunction(() => (window as any).__ready === true, null, {
    timeout: 60_000,
  });
  await page.waitForSelector("[role=gridcell]", { state: "attached" });
});

const label = (colId: string) =>
  `[role=columnheader][data-col-id="${colId}"] .mg-header-label`;
const cellText = (page: import("@playwright/test").Page, rowIndex: number, colIndex: number) =>
  page
    .locator(`[role=gridcell][aria-rowindex="${rowIndex}"][aria-colindex="${colIndex}"]`)
    .textContent();
/** Parse a (possibly `number`-mask-formatted, comma-grouped) cell to a number. */
const cellNum = async (
  page: import("@playwright/test").Page,
  rowIndex: number,
  colIndex: number,
): Promise<number> => Number(((await cellText(page, rowIndex, colIndex)) ?? "").replace(/[^0-9.-]/g, ""));

test("CAP-SORT: header click sorts + Shift-click adds a secondary key (multi-sort)", async ({
  page,
}) => {
  // c3 (aria-colindex 4) is numeric + non-monotonic. Two clicks → descending;
  // the natural top row (id 0 → c3 0) can no longer be first.
  await page.locator(label("c3")).click();
  await page.locator(label("c3")).click();
  await expect(page.locator('[role=columnheader][data-col-id="c3"]')).toHaveAttribute(
    "aria-sort",
    "descending",
  );

  // First visible rows are ordered descending on c3, and the top row moved off id 0.
  await expect
    .poll(async () => cellNum(page, 1, 4))
    .toBeGreaterThanOrEqual(await cellNum(page, 2, 4));
  expect(await cellText(page, 1, 1)).not.toBe("0");

  // Shift-click a second header → multi-sort (two keys).
  await page.locator(label("c6")).click({ modifiers: ["Shift"] });
  await expect(page.locator('[role=columnheader][data-col-id="c6"]')).toHaveAttribute(
    "aria-sort",
    "ascending",
  );
  const entries = await page.evaluate(() => (window as any).__grid.getSortSpec().entries);
  expect(entries.length).toBe(2);
});

test("CAP-FILTER: opening the filter menu and applying drops the row count", async ({
  page,
}) => {
  const before = await page.evaluate(async () => (await (window as any).__grid.getRowCount()).rowCount);
  expect(before).toBe(1_000_000);

  // Open the id-column filter menu, apply `id > 500000`.
  await page.locator('[role=columnheader][data-col-id="id"] [data-mg-filter-btn]').click();
  const menu = page.locator(".mg-filter-menu");
  await expect(menu).toBeVisible();
  await menu.locator("[data-mg-filter-op]").selectOption("gt");
  await menu.locator("[data-mg-filter-value]").fill("500000");
  await menu.locator("[data-mg-filter-apply]").click();

  await expect(menu).toHaveCount(0); // menu closed after apply
  await expect
    .poll(async () => page.evaluate(async () => (await (window as any).__grid.getRowCount()).rowCount))
    .toBeLessThan(1_000_000);
  const after = await page.evaluate(async () => (await (window as any).__grid.getRowCount()).rowCount);
  expect(after).toBeGreaterThan(0);
});

test("CAP-RESIZE + CAP-REORDER: drag-resize widens a column; drag reorders headers", async ({
  page,
}) => {
  // --- Resize c3 by dragging its right-edge handle ---
  const c3 = page.locator('[role=columnheader][data-col-id="c3"]');
  const widthBefore = (await c3.boundingBox())!.width;
  const handle = c3.locator("[data-mg-resize]");
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 90, hb.y + hb.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await c3.boundingBox())!.width).toBeGreaterThan(widthBefore + 40);

  // --- Reorder: drag c1 onto c5 ---
  const orderBefore = await page.evaluate(() =>
    [...document.querySelectorAll("[role=columnheader]")]
      .filter((h) => (h as HTMLElement).style.display !== "none")
      .map((h) => h.getAttribute("data-col-id")),
  );
  const c1 = page.locator(label("c1"));
  const c5 = page.locator('[role=columnheader][data-col-id="c5"]');
  const b1 = (await c1.boundingBox())!;
  const b5 = (await c5.boundingBox())!;
  await page.mouse.move(b1.x + b1.width / 2, b1.y + b1.height / 2);
  await page.mouse.down();
  await page.mouse.move(b5.x + b5.width / 2, b5.y + b5.height / 2, { steps: 10 });
  await page.mouse.up();

  await expect
    .poll(async () =>
      page.evaluate(() =>
        [...document.querySelectorAll("[role=columnheader]")]
          .filter((h) => (h as HTMLElement).style.display !== "none")
          .map((h) => h.getAttribute("data-col-id"))
          .indexOf("c1"),
      ),
    )
    .toBeGreaterThan(orderBefore.indexOf("c1"));
});

test("CAP-FREEZE: the frozen top row stays pinned while the body scrolls", async ({
  page,
}) => {
  await page.evaluate(() => (window as any).__grid.setFrozen({ rows: 1 }));
  // The frozen data row is logical row 0 (aria-rowindex 1). Wait for the freeze to
  // apply (the pinned row carries the frozen class) before sampling its position, so
  // the pre-scroll baseline is read from a settled state — not mid async refresh.
  const frozen = page.locator('[role=gridcell][aria-rowindex="1"][aria-colindex="1"]');
  await expect(page.locator(".mg-row--frozen")).toHaveCount(1);
  await expect(frozen).toBeVisible();
  const topBefore = (await frozen.boundingBox())!.y;

  await page.locator(".mg-scroll").evaluate((el) => {
    (el as HTMLElement).scrollTop = 40_000;
  });

  // The pinned row is repositioned by the ASYNC window refresh after the scroll.
  // Poll for that settle deterministically (Playwright's built-in retrying assertion
  // — not a test-level retry): its pinned y returns to within 4px of the pre-scroll
  // top. This removes the race that flaked under 3-worker load WITHOUT weakening the
  // assertion — it still proves the frozen row did not scroll away after a 40k scroll.
  await expect(frozen).toBeVisible();
  await expect
    .poll(
      async () => {
        const box = await frozen.boundingBox();
        return box ? Math.abs(box.y - topBefore) : Number.POSITIVE_INFINITY;
      },
      { timeout: 10_000 },
    )
    .toBeLessThan(4); // did not scroll away

  // Once settled, the far-down window is what the body shows; the pinned row keeps
  // the lowest index present (aria-rowindex 1).
  await expect
    .poll(async () =>
      page.evaluate(() =>
        Math.min(
          ...[...document.querySelectorAll("[role=gridcell]")].map((c) =>
            Number(c.getAttribute("aria-rowindex")),
          ),
        ),
      ),
    )
    .toBe(1);
});

test("JOURNEY-STRUCTURE (CAP-MERGE): merge a range renders one spanning cell", async ({
  page,
}) => {
  // Merge logical (row 0, cols 1..2) → the anchor spans two columns; the covered
  // cell is suppressed (no longer a queryable gridcell).
  await page.evaluate(() =>
    (window as any).__grid.merge({ top: 0, left: 1, bottom: 0, right: 2 }),
  );
  const anchor = page.locator('[role=gridcell][aria-rowindex="1"][aria-colindex="2"]');
  await expect(anchor).toHaveAttribute("aria-colspan", "2");
  await expect(
    page.locator('[role=gridcell][aria-rowindex="1"][aria-colindex="3"]'),
  ).toHaveCount(0);
  const merges = await page.evaluate(() => (window as any).__grid.getMerges().length);
  expect(merges).toBe(1);
});

test("JOURNEY-STRUCTURE (CAP-GROUP): collapse a row group hides rows, expand restores", async ({
  page,
}) => {
  // Group logical rows 2..4; the outline toggle appears.
  await page.evaluate(() =>
    (window as any).__grid.group({ axis: "row", start: 2, span: 3 }),
  );
  const toggle = page.locator('[data-mg-group-toggle][data-group-axis="row"]');
  await expect(toggle).toHaveCount(1);
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  // Logical row 2 (aria-rowindex 3) is rendered before collapse.
  await expect(
    page.locator('[role=gridcell][aria-rowindex="3"][aria-colindex="1"]'),
  ).toBeVisible();

  await toggle.click(); // collapse
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.locator('[role=gridcell][aria-rowindex="3"][aria-colindex="1"]'),
  ).toHaveCount(0); // rows hidden

  await toggle.click(); // expand
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.locator('[role=gridcell][aria-rowindex="3"][aria-colindex="1"]'),
  ).toBeVisible();
});

test("JOURNEY-STRUCTURE: deleting a row inside a merge shrinks it", async ({
  page,
}) => {
  // Merge logical rows 0..2 of the id column, then delete the interior row 1.
  await page.evaluate(() =>
    (window as any).__grid.merge({ top: 0, left: 0, bottom: 2, right: 0 }),
  );
  const bottomBefore = await page.evaluate(
    () => (window as any).__grid.getMerges()[0].range.bottom,
  );
  expect(bottomBefore).toBe(2);

  await page.evaluate(async () => {
    const g = (window as any).__grid;
    const res = await g.getRows({ startIndex: 1, endIndex: 2 });
    await g.removeRows([res.rows[0].key]);
  });

  await expect
    .poll(async () =>
      page.evaluate(() => (window as any).__grid.getMerges()[0].range.bottom),
    )
    .toBe(1); // A1:A3 → A1:A2
});

test("a11y: axe reports ZERO violations with a merge + group present (AC-AXE)", async ({
  page,
}) => {
  await page.evaluate(() => {
    const g = (window as any).__grid;
    g.merge({ top: 0, left: 1, bottom: 0, right: 2 });
    g.group({ axis: "row", start: 3, span: 3 });
  });
  await page.locator('[role=gridcell][aria-rowindex="1"][aria-colindex="1"]').click();
  const results = await new AxeBuilder({ page }).include("[data-mini-grid]").analyze();
  expect(results.violations).toEqual([]);
});

test("a11y: axe reports ZERO violations with the filter menu open (AC-AXE)", async ({
  page,
}) => {
  // Seed a selection so a cell carries the roving tabindex (matches the other axe gates).
  await page.locator('[role=gridcell][aria-rowindex="1"][aria-colindex="1"]').click();

  await page.locator('[role=columnheader][data-col-id="c1"] [data-mg-filter-btn]').click();
  await expect(page.locator(".mg-filter-menu")).toBeVisible();

  const results = await new AxeBuilder({ page })
    .include("[data-mini-grid]")
    .include(".mg-filter-menu")
    .analyze();
  expect(results.violations).toEqual([]);
});
