/**
 * `JOURNEY-EDIT` — the real-flow editing journey (`CAP-EDIT`/`-VALIDATE`/`-UNDO`)
 * against the live 1,000,000-row demo in Chromium:
 *
 *  1. Open an editor (type-to-replace), type a value, Enter to commit — the cell
 *     shows the new value (`LAYER-EDITOR`, `EVT-AFTER-EDIT`, `MSG-APPLY-EDIT`).
 *  2. Edit again, then `grid.undo()` reverts to the prior value (`LIB-UNDO`,
 *     `INV-HISTORY-LINEAR`).
 *  3. A validation failure shows the invalid state — `aria-invalid` + the inline
 *     validation tip, editor stays open (`VALIDATION_FAILED`, `LAYER-VALIDATION-TIP`).
 *  4. Accessibility — axe-core reports ZERO violations with an editor open
 *     (`A11Y-EDITOR`, `AC-AXE`).
 *
 * Demo columns: colindex 2 (`c1`) is editable text (no validation); colindex 3
 * (`c2`) is editable text with a `^r` regex rule (forces the failure path).
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

const editableCell = '[role=gridcell][aria-rowindex="1"][aria-colindex="2"]';
const validatedCell = '[role=gridcell][aria-rowindex="1"][aria-colindex="3"]';

test("JOURNEY-EDIT: type-to-replace + Enter commits the new value", async ({
  page,
}) => {
  const cell = page.locator(editableCell);
  await cell.click();
  await expect(cell).toHaveAttribute("aria-readonly", "false");

  // Type-to-replace: the first key opens the editor seeded with it.
  await page.keyboard.type("Hello");
  await expect(page.locator("[data-mg-editor] input")).toHaveValue("Hello");
  await page.keyboard.press("Enter");

  await expect(cell).toHaveText("Hello");
  await expect(page.locator("[data-mg-editor]")).toHaveCount(0); // editor closed
});

test("JOURNEY-EDIT: edit again then grid.undo() reverts (LIB-UNDO)", async ({
  page,
}) => {
  const cell = page.locator(editableCell);

  await cell.click();
  await page.keyboard.type("Hello");
  await page.keyboard.press("Enter");
  await expect(cell).toHaveText("Hello");

  await cell.click();
  await page.keyboard.type("World");
  await page.keyboard.press("Enter");
  await expect(cell).toHaveText("World");

  await page.evaluate(() => (window as any).__grid.undo());
  await expect(cell).toHaveText("Hello"); // reverted to the prior edit
});

test("JOURNEY-EDIT: a validation failure shows the invalid state", async ({
  page,
}) => {
  const cell = page.locator(validatedCell);
  await cell.click();
  await page.keyboard.type("xyz"); // violates the ^r regex rule
  await page.keyboard.press("Enter");

  const input = page.locator("[data-mg-editor] input");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(input).toHaveAttribute("aria-describedby", /mg-tip-/);
  await expect(page.locator(".mg-validation-tip")).toBeVisible();
  // The editor stays open (rejected, not committed).
  await expect(page.locator("[data-mg-editor]")).toHaveCount(1);

  await page.keyboard.press("Escape"); // dismiss
  await expect(page.locator("[data-mg-editor]")).toHaveCount(0);
});

test("JOURNEY-EDIT a11y: axe reports ZERO violations with an editor open (AC-AXE)", async ({
  page,
}) => {
  const cell = page.locator(editableCell);
  await cell.click();
  await page.keyboard.type("Edit");
  await expect(page.locator("[data-mg-editor] input")).toBeFocused();

  const results = await new AxeBuilder({ page })
    .include("[data-mini-grid]")
    .analyze();

  expect(results.violations).toEqual([]);
});
