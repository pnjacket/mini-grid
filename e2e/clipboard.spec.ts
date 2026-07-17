/**
 * `JOURNEY-RANGE-OPS` — the real-flow clipboard journey (`CAP-SELECT`/`-CLIPBOARD`)
 * against the live 1,000,000-row demo in Chromium:
 *
 *  1. Select a range → `copy()` → the system clipboard holds the TSV projection
 *     (`LIB-CLIPBOARD`, read back via `navigator.clipboard.readText`).
 *  2. Select a target → `paste()` → the target cells now hold the copied values
 *     (parsed as TSV, applied through the edit/commit path, `EVT-AFTER-PASTE`).
 *  3. Drag the fill handle at the active range's bottom-right corner → fill
 *     propagates the source value down (`BIND-POINTER` fill-handle drag).
 *  4. `cut()` then `paste()` round-trips (source cleared, block re-pasted).
 *  5. `SEC-PASTE-UNTRUSTED` (page-governed) — pasting an HTML-ish string shows it
 *     as LITERAL TEXT; no HTML element is materialized and nothing executes.
 *  6. Accessibility — axe-core reports ZERO violations with the fill handle shown.
 *
 * Demo columns: colindex 2 (`c1`) is editable text (no validation) — the copy/
 * paste/fill target. (colindex 3 `c2` carries a `^r` regex rule; avoided here.)
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Clipboard read/write for the page + grid (SEQ-PASTE seed/readback).
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test.beforeEach(async ({ page }) => {
  await page.goto("/demo/index.html");
  await page.waitForFunction(() => (window as any).__ready === true, null, {
    timeout: 60_000,
  });
  await page.waitForSelector("[role=gridcell]", { state: "attached" });
});

const cellSel = (row: number, col: number) =>
  `[role=gridcell][aria-rowindex="${row}"][aria-colindex="${col}"]`;

// Index-space helpers: aria indices are 1-based; the model is 0-based.
const setSelection = (page: any, r: {top:number;bottom:number;left:number;right:number}) =>
  page.evaluate((range: any) => {
    (window as any).__grid.setSelection({
      ranges: [range],
      anchor: { row: range.top, col: range.left },
      activeCell: null,
    });
  }, r);

test("JOURNEY-RANGE-OPS: copy a range → clipboard holds the TSV", async ({ page }) => {
  // c1 = column index 1 (aria-colindex 2). Copy rows 0..1.
  await setSelection(page, { top: 0, bottom: 1, left: 1, right: 1 });
  await page.evaluate(() => (window as any).__grid.copy());

  const tsv = await page.evaluate(() => navigator.clipboard.readText());
  expect(tsv).toBe("r0-c1\nr1-c1");
});

test("JOURNEY-RANGE-OPS: paste applies the copied values at the target", async ({ page }) => {
  await setSelection(page, { top: 0, bottom: 1, left: 1, right: 1 });
  await page.evaluate(() => (window as any).__grid.copy());

  // Target: anchor at row 3, c1 column.
  await setSelection(page, { top: 3, bottom: 3, left: 1, right: 1 });
  await page.evaluate(() => (window as any).__grid.paste());

  await expect(page.locator(cellSel(4, 2))).toHaveText("r0-c1");
  await expect(page.locator(cellSel(5, 2))).toHaveText("r1-c1");
});

test("JOURNEY-RANGE-OPS: drag the fill handle to fill down", async ({ page }) => {
  // Source = a single cell (row 0, c1 = 'r0-c1').
  await setSelection(page, { top: 0, bottom: 0, left: 1, right: 1 });

  const handle = page.locator("[data-mg-fill-handle]");
  await expect(handle).toBeVisible();
  const hb = await handle.boundingBox();
  const target = await page.locator(cellSel(3, 2)).boundingBox(); // 2 rows below
  if (!hb || !target) throw new Error("missing fill handle / target box");

  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 6 });
  await page.mouse.up();

  // Rows 1..2 (aria 2..3) now carry the source value.
  await expect(page.locator(cellSel(2, 2))).toHaveText("r0-c1");
  await expect(page.locator(cellSel(3, 2))).toHaveText("r0-c1");
});

test("JOURNEY-RANGE-OPS: cut clears the source, then paste restores it elsewhere", async ({ page }) => {
  await setSelection(page, { top: 0, bottom: 0, left: 1, right: 1 });
  await page.evaluate(() => (window as any).__grid.cut());
  // Source cleared.
  await expect(page.locator(cellSel(1, 2))).toHaveText("");

  // Paste into row 5.
  await setSelection(page, { top: 5, bottom: 5, left: 1, right: 1 });
  await page.evaluate(() => (window as any).__grid.paste());
  await expect(page.locator(cellSel(6, 2))).toHaveText("r0-c1");
});

test("JOURNEY-RANGE-OPS: 2× Ctrl+click → two disjoint ranges; copy acts on the active range", async ({
  page,
}) => {
  // A plain click selects the first cell; a Ctrl+click adds a disjoint second
  // range that becomes the active (primary) range (`CE-MULTI-RANGE-SELECT`).
  await page.locator(cellSel(1, 2)).click(); // r0-c1
  await page.locator(cellSel(3, 2)).click({ modifiers: ["Control"] }); // r2-c1 (active)

  // Two disjoint ranges, both highlighted (INV-SELECTION-WELLFORMED).
  const ranges = await page.evaluate(
    () => (window as any).__grid.getSelection().ranges.length,
  );
  expect(ranges).toBe(2);
  await expect(page.locator('[role=gridcell][aria-selected="true"]')).toHaveCount(2);

  // Copy operates on the ACTIVE range only (the 2nd click), not the whole set.
  await page.evaluate(() => (window as any).__grid.copy());
  const tsv = await page.evaluate(() => navigator.clipboard.readText());
  expect(tsv).toBe("r2-c1");
});

test("SEC-PASTE-UNTRUSTED: an HTML-ish paste shows as literal text, not HTML", async ({ page }) => {
  const payload = "<b>bold</b><img src=x onerror=alert(1)>";
  await page.evaluate((p) => navigator.clipboard.writeText(p), payload);

  await setSelection(page, { top: 0, bottom: 0, left: 1, right: 1 });
  await page.evaluate(() => (window as any).__grid.paste());

  const cell = page.locator(cellSel(1, 2));
  await expect(cell).toHaveText(payload); // rendered as literal text
  // No HTML materialized from the payload.
  expect(await cell.locator("b").count()).toBe(0);
  expect(await cell.locator("img").count()).toBe(0);
});

test("JOURNEY-RANGE-OPS a11y: axe reports ZERO violations with the fill handle shown (AC-AXE)", async ({
  page,
}) => {
  await setSelection(page, { top: 0, bottom: 1, left: 1, right: 1 });
  await expect(page.locator("[data-mg-fill-handle]")).toBeVisible();

  const results = await new AxeBuilder({ page })
    .include("[data-mini-grid]")
    .analyze();

  expect(results.violations).toEqual([]);
});
