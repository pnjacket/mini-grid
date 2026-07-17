/**
 * `JOURNEY-EDIT` (editors) — the two v1.1 built-in editors against the live
 * 1,000,000-row demo in Chromium (`CAP-EDIT`, `LAYER-EDITOR`, `A11Y-EDITOR`):
 *
 *  1. `CE-SELECT-POPOVER` — the `select` editor opens a `role="listbox"` overlay
 *     popover portaled OUTSIDE the cell (escaping its overflow clip); the trigger
 *     cell carries `aria-expanded`; an option beyond the cell bounds is clickable
 *     and picking it commits the new value.
 *  2. `CE-BOOL-COMMIT` — clicking the `boolean` checkbox toggles + commits the new
 *     value immediately (on the editor's `change`), so the toggle is not lost to a
 *     premature blur; the flipped value persists.
 *  3. Accessibility — axe-core reports ZERO violations with the select popover open.
 *
 * The `active` (boolean) + `grade` (select) columns are appended at the right edge
 * of the demo, so each test first scrolls them into the render window.
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const boolCell = '[role=gridcell][data-row-key="0"][data-col-id="active"]';
const selectCell = '[role=gridcell][data-row-key="0"][data-col-id="grade"]';

test.beforeEach(async ({ page }) => {
  await page.goto("/demo/index.html");
  await page.waitForFunction(() => (window as any).__ready === true, null, {
    timeout: 60_000,
  });
  await page.waitForSelector("[role=gridcell]", { state: "attached" });
  // The select/boolean columns are appended at the right edge — scroll them into
  // the (horizontally virtualized) render window.
  await page.evaluate(() => {
    const s = (window as any).__scroller();
    s.scrollLeft = s.scrollWidth;
    s.dispatchEvent(new Event("scroll"));
  });
  await page.waitForSelector(selectCell, { state: "attached" });
});

test("CE-SELECT-POPOVER: options render OUTSIDE the cell + a pick commits", async ({
  page,
}) => {
  const cell = page.locator(selectCell);
  await cell.click();
  await page.keyboard.press("F2");

  const listbox = page.locator('[data-mg-select-popover][role=listbox]');
  await expect(listbox).toBeVisible();
  await expect(cell).toHaveAttribute("aria-expanded", "true");
  await expect(listbox.getByRole("option")).toHaveCount(4);

  // The listbox is portaled to <body>, NOT a descendant of the (clipped) cell.
  const clipped = await page.evaluate(
    ({ cs }) => {
      const c = document.querySelector(cs)!;
      const p = document.querySelector("[data-mg-select-popover]")!;
      return c.contains(p);
    },
    { cs: selectCell },
  );
  expect(clipped).toBe(false);

  // An option beyond the cell bounds is reachable + clickable.
  await listbox.getByRole("option", { name: /Poor/ }).click();
  await expect(cell).toHaveText("D"); // committed the picked value
  await expect(page.locator("[data-mg-select-popover]")).toHaveCount(0);
  await expect(cell).not.toHaveAttribute("aria-expanded", "true");
});

test("CE-SELECT-POPOVER: ArrowDown + Enter commits the highlighted option", async ({
  page,
}) => {
  const cell = page.locator(selectCell); // row 0 grade = 'A'
  await cell.click();
  await page.keyboard.press("F2");
  await expect(page.locator("[data-mg-select-popover]")).toBeVisible();

  await page.keyboard.press("ArrowDown"); // A → B
  await page.keyboard.press("Enter");
  await expect(cell).toHaveText("B");
  await expect(page.locator("[data-mg-select-popover]")).toHaveCount(0);
});

test("CE-BOOL-COMMIT: clicking the checkbox flips the value and persists", async ({
  page,
}) => {
  const cell = page.locator(boolCell);
  await expect(cell).toHaveText("true"); // row 0 active = true

  await cell.click();
  await page.keyboard.press("F2");
  const box = page.locator('[data-mg-editor] input[type="checkbox"]');
  await expect(box).toBeVisible();

  // Click toggles + commits on the editor's `change` — no lost toggle.
  await box.click();
  await expect(cell).toHaveText("false");
  await expect(page.locator("[data-mg-editor]")).toHaveCount(0);

  // The flipped value persists (re-open shows the committed state).
  await cell.click();
  await page.keyboard.press("F2");
  await expect(page.locator('[data-mg-editor] input[type="checkbox"]')).not.toBeChecked();
});

test("CE-SELECT-POPOVER a11y: axe reports ZERO violations with the popover open", async ({
  page,
}) => {
  const cell = page.locator(selectCell);
  await cell.click();
  await page.keyboard.press("F2");
  await expect(page.locator('[data-mg-select-popover][role=listbox]')).toBeVisible();

  const results = await new AxeBuilder({ page })
    .include("[data-mini-grid]")
    .include("[data-mg-select-popover]")
    .analyze();

  expect(results.violations).toEqual([]);
});
