/**
 * `JOURNEY-CRUD` — insert/delete rows AND columns via the context menu
 * (`LAYER-CONTEXT-MENU`, `CAP-EDIT`) against the live 1,000,000-row demo in
 * Chromium, plus the `A11Y-CONTEXT-MENU` keyboard path and an axe-core gate.
 *
 * Proves, on the real surface:
 *  1. Right-click a cell → `role=menu` → Insert/Delete row changes `aria-rowcount`
 *     (`LIB-INSERT-ROWS`/`-REMOVE-ROWS`, `EVT-AFTER-INSERT`/`-DELETE`).
 *  2. Insert/Delete column changes `aria-colcount` + the columnheader set
 *     (`LIB-COLUMN-CRUD`).
 *  3. Keyboard open (Shift+F10) + Esc closes and restores focus to the cell
 *     (`A11Y-CONTEXT-MENU`).
 *  4. axe-core reports ZERO violations with the menu open (`AC-AXE`).
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ page }) => {
  await page.goto("/demo/index.html");
  await page.waitForFunction(() => (window as any).__ready === true, null, {
    timeout: 60_000,
  });
  await page.waitForSelector("[role=gridcell]", { state: "attached" });
});

const grid = "[data-mini-grid]";
const targetCell = '[role=gridcell][aria-rowindex="2"][aria-colindex="2"]';

test("JOURNEY-CRUD: right-click → insert row / delete row changes aria-rowcount", async ({
  page,
}) => {
  await expect(page.locator(grid)).toHaveAttribute("aria-rowcount", "1000000");

  // Insert a row below the target cell.
  await page.locator(targetCell).click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await page.getByRole("menuitem", { name: "Insert row below" }).click();
  await expect(page.locator(grid)).toHaveAttribute("aria-rowcount", "1000001", {
    timeout: 15_000,
  });

  // Delete a row.
  await page.locator(targetCell).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete row", exact: true }).click();
  await expect(page.locator(grid)).toHaveAttribute("aria-rowcount", "1000000", {
    timeout: 15_000,
  });
});

test("JOURNEY-CRUD: right-click → insert column / delete column changes aria-colcount", async ({
  page,
}) => {
  // Baseline: 12 original columns + the v1.1 `active` (boolean) + `grade` (select).
  await expect(page.locator(grid)).toHaveAttribute("aria-colcount", "14");
  const headers = () => page.locator('[role=columnheader][data-col-id]');
  await expect(headers()).toHaveCount(14);

  // Insert a blank column to the left of the target cell.
  await page.locator(targetCell).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Insert column left" }).click();
  await expect(page.locator(grid)).toHaveAttribute("aria-colcount", "15", {
    timeout: 15_000,
  });
  await expect(headers()).toHaveCount(15);

  // Delete a column (the freshly-inserted blank column at colindex 2).
  await page
    .locator('[role=gridcell][aria-rowindex="2"][aria-colindex="2"]')
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete column", exact: true }).click();
  await expect(page.locator(grid)).toHaveAttribute("aria-colcount", "14", {
    timeout: 15_000,
  });
  await expect(headers()).toHaveCount(14);
});

test("A11Y-CONTEXT-MENU: Shift+F10 opens the menu; Esc closes + restores cell focus", async ({
  page,
}) => {
  const cell = page.locator(targetCell);
  await cell.click(); // focus + activate the cell
  await expect(cell).toBeFocused();

  await page.keyboard.press("Shift+F10");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  // Focus moved into the menu (first enabled item — Copy, now that clipboard is on).
  await expect(page.getByRole("menuitem", { name: "Copy" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(cell).toBeFocused(); // focus restored to the origin cell
});

test("JOURNEY-CRUD a11y: axe reports ZERO violations with the menu open (AC-AXE)", async ({
  page,
}) => {
  // Seed a selection so a cell holds the roving tab stop (the scroll region then
  // has focusable content), then open the menu over it.
  const cell = page.locator(targetCell);
  await cell.click();
  await cell.click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();

  // The grid + the portaled menu are both scanned (menu lives on <body>).
  const results = await new AxeBuilder({ page })
    .include(grid)
    .include(".mg-context-menu")
    .analyze();
  expect(results.violations).toEqual([]);
});
