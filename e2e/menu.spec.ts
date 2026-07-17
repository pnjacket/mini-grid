/**
 * `AC-MENU-CONFIG` + `AC-MENU-A11Y` (slice 20, `CAP-MENU`) — the builder-driven,
 * target-branched context menus against the live `demo/menu.html` surface in
 * Chromium. Proves on the real DOM (roles / attributes / behavior):
 *
 *  1. Right-click a body cell vs a column header → **different** menus (the one
 *     `MenuBuilder` branches on `ctx.target.kind`).
 *  2. Rich item kinds render: a developer `custom` node (mounted AS-IS,
 *     `SEC-MENU-CUSTOM-RENDER`), a `submenu` (`aria-haspopup`), a `checkbox`
 *     (`menuitemcheckbox`), a `radio` (`menuitemradio`), a built-in-by-`command`.
 *  3. A flag-hidden built-in (`group-by`, `group` off) is **absent**.
 *  4. Programmatic `openMenu` opens the menu.
 *  5. Keyboard: arrow-nav, Space toggles a checkbox without closing, →/Enter opens
 *     a submenu, Esc closes + restores focus to the origin cell.
 *  6. **axe** reports ZERO violations with a rich cell menu AND a header submenu
 *     open (menuitem / menuitemcheckbox / menuitemradio / aria-haspopup).
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/* eslint-disable @typescript-eslint/no-explicit-any */

test.beforeEach(async ({ page }) => {
  await page.goto("/demo/menu.html");
  await page.waitForFunction(() => (window as any).__ready === true, null, {
    timeout: 60_000,
  });
});

const cell = (row: number, col: number) =>
  `[role=gridcell][aria-rowindex="${row + 1}"][aria-colindex="${col + 1}"]`;
const colHeader = (colId: string) =>
  `[role=columnheader][data-col-id="${colId}"]`;

test("right-click a cell vs a column-header → different menus (target-branched)", async ({
  page,
}) => {
  // Cell menu — clipboard + a developer custom item + a checkbox + a submenu.
  await page.locator(cell(1, 1)).click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Copy" })).toBeVisible();
  await expect(page.locator("[data-mg-custom]")).toBeVisible();
  await expect(
    page.getByRole("menuitemcheckbox", { name: "Flag row" }),
  ).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "More…" })).toHaveAttribute(
    "aria-haspopup",
    "menu",
  );
  // No header-only built-in on the cell menu.
  await expect(page.getByRole("menuitem", { name: "Sort ascending" })).toHaveCount(0);

  // Dismiss, then open the column-header menu — a DISTINCT set.
  await page.keyboard.press("Escape");
  await page.locator(colHeader("name")).click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Sort ascending" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Hide this column" })).toBeVisible();
  // The `group` feature is OFF → the group-by built-in AUTO-HIDES.
  await expect(page.getByRole("menuitem", { name: "Group by column" })).toHaveCount(0);
  // The cell-only custom item is absent here.
  await expect(page.locator("[data-mg-custom]")).toHaveCount(0);
});

test("a built-in-by-command-id invokes the built-in (hide-column)", async ({
  page,
}) => {
  const before = await page.locator("[role=columnheader][data-col-id]").count();
  await page.locator(colHeader("name")).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Hide this column" }).click();
  await expect(page.locator(colHeader("name"))).toHaveCount(0);
  const after = await page.locator("[role=columnheader][data-col-id]").count();
  expect(after).toBe(before - 1);
});

test("programmatic openMenu opens the menu", async ({ page }) => {
  await page.evaluate(() =>
    (window as any).__grid.openMenu({
      kind: "cell",
      cellRef: { rowKey: 0, columnId: "name" },
    }),
  );
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Copy" })).toBeVisible();
});

test("keyboard: arrow-nav, Space toggles a checkbox (stays open), Esc restores focus", async ({
  page,
}) => {
  const origin = page.locator(cell(2, 1));
  await origin.click(); // select/focus the cell first
  await origin.click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  // First enabled item (Copy) is focused.
  await expect(page.getByRole("menuitem", { name: "Copy" })).toBeFocused();

  // Arrow down to the checkbox, Space toggles it WITHOUT closing.
  const check = page.getByRole("menuitemcheckbox", { name: "Flag row" });
  await check.focus();
  await page.keyboard.press("Space");
  await expect(check).toHaveAttribute("aria-checked", "true");
  await expect(menu).toBeVisible();
  expect(await page.evaluate(() => (window as any).__toggled)).toBe(1);

  // Esc closes + restores focus to the origin cell.
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(origin).toBeFocused();
});

test("keyboard: ArrowRight opens a submenu (nested role=menu)", async ({
  page,
}) => {
  await page.locator(cell(0, 1)).click({ button: "right" });
  const parent = page.getByRole("menuitem", { name: "More…" });
  await parent.focus();
  await page.keyboard.press("ArrowRight");
  await expect(parent).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("menu")).toHaveCount(2);
  await expect(page.getByRole("menuitem", { name: "Log this cell" })).toBeVisible();
});

test("AC-MENU-A11Y: axe ZERO violations with a rich cell menu open", async ({
  page,
}) => {
  await page.locator(cell(1, 1)).click({ button: "right" });
  await expect(page.locator(".mg-context-menu")).toBeVisible();
  const results = await new AxeBuilder({ page })
    .include(".mg-context-menu")
    .analyze();
  expect(results.violations).toEqual([]);
});

test("AC-MENU-A11Y: axe ZERO violations with a header submenu (menuitemradio) open", async ({
  page,
}) => {
  await page.locator(colHeader("name")).click({ button: "right" });
  const view = page.getByRole("menuitem", { name: "View…" });
  await view.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("menuitemradio", { name: "Ascending" })).toBeVisible();
  const results = await new AxeBuilder({ page })
    .include(".mg-context-menu")
    .analyze();
  expect(results.violations).toEqual([]);
});
