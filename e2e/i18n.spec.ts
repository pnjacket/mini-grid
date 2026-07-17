/**
 * `COMPONENT-I18N` / `LIB-LOCALE` (`CAP-I18N`, `AC-RTL`) — the i18n + RTL journey
 * on the live surface. Proves, run-invariant:
 *  1. `setDirection('rtl')` sets `dir=rtl` on `DOM-ROOT` and mirrors layout —
 *     columns render right-to-left and a frozen column pins to the RIGHT edge.
 *  2. Horizontal scroll still works in RTL (the rendered column window advances).
 *  3. `setLocale` re-locales a value-format mask (a formatted number changes).
 *  4. axe-core reports ZERO violations with the grid in RTL (`AC-AXE` under RTL).
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ page }) => {
  await page.goto("/demo/i18n.html");
  await page.waitForFunction(() => (window as any).__ready === true, null, {
    timeout: 60_000,
  });
  await page.waitForSelector("[role=gridcell]", { state: "attached" });
});

/** Client x-midpoint of a header cell by 1-based aria-colindex. */
function headerMid(page: import("@playwright/test").Page, colIndex: number): Promise<number> {
  return page.evaluate((ci) => {
    const cell = document.querySelector(
      `[role=columnheader][aria-colindex="${ci}"]`,
    ) as HTMLElement;
    const r = cell.getBoundingClientRect();
    return r.left + r.width / 2;
  }, colIndex);
}

test("AC-RTL: setDirection(rtl) mirrors column order + pins the frozen column to the right", async ({
  page,
}) => {
  await page.evaluate(() => (window as any).__setDirection("rtl"));

  const root = page.locator("[data-mini-grid]");
  await expect(root).toHaveAttribute("dir", "rtl");

  // Column order mirrors: the FIRST column (colindex 1) renders to the RIGHT of
  // a later column (colindex 3).
  const firstMid = await headerMid(page, 1);
  const laterMid = await headerMid(page, 3);
  expect(firstMid).toBeGreaterThan(laterMid);

  // The frozen leading column (colindex 1) pins to the RIGHT edge of the grid.
  const pin = await page.evaluate(() => {
    const rootEl = document.querySelector("[data-mini-grid]") as HTMLElement;
    const frozen = document.querySelector(
      '[role=columnheader][aria-colindex="1"]',
    ) as HTMLElement;
    const rr = rootEl.getBoundingClientRect();
    const fr = frozen.getBoundingClientRect();
    return { rootRight: rr.right, frozenRight: fr.right };
  });
  // Frozen column's right edge sits at (within a few px of) the grid's right edge.
  expect(Math.abs(pin.frozenRight - pin.rootRight)).toBeLessThan(6);
});

test("AC-RTL: horizontal scroll works in RTL (the rendered column window advances)", async ({
  page,
}) => {
  await page.evaluate(() => (window as any).__setDirection("rtl"));

  const maxColBefore = await page.evaluate(() => {
    const cells = [...document.querySelectorAll("[role=gridcell]")];
    return Math.max(...cells.map((c) => Number(c.getAttribute("aria-colindex"))));
  });

  // In RTL, scrolling toward later columns drives scrollLeft negative.
  await page.evaluate(() => {
    const s = (window as any).__scroller() as HTMLElement;
    s.scrollLeft = -400;
  });

  await expect
    .poll(() =>
      page.evaluate(() => {
        const cells = [...document.querySelectorAll("[role=gridcell]")];
        return Math.max(
          ...cells.map((c) => Number(c.getAttribute("aria-colindex"))),
        );
      }),
    )
    .toBeGreaterThan(maxColBefore);
});

test("LIB-LOCALE: setLocale re-locales a value-format mask (en-US → de-DE)", async ({
  page,
}) => {
  const amountText = () =>
    page.evaluate(
      () =>
        (
          document.querySelector(
            '[role=gridcell][aria-colindex="2"]',
          ) as HTMLElement
        ).textContent,
    );

  const en = await amountText();
  expect(en).toBe("1,234,567.89"); // en-US grouping + decimal

  await page.evaluate(() => (window as any).__setLocale("de-DE"));
  await expect.poll(amountText).toBe("1.234.567,89"); // de-DE grouping + decimal
});

test("AC-AXE (RTL): axe-core reports zero violations with the grid in RTL", async ({
  page,
}) => {
  await page.evaluate(() => (window as any).__setDirection("rtl"));
  await page.waitForSelector('[data-mini-grid][dir="rtl"]');
  // Seed a selection so the roving-focus tab stop lands on a cell (keyboard-
  // scrollable region), exercising aria-selected/focus under axe too.
  await page
    .locator('[role=gridcell][aria-rowindex="1"][aria-colindex="1"]')
    .click();
  const results = await new AxeBuilder({ page })
    .include("[data-mini-grid]")
    .analyze();
  expect(results.violations).toEqual([]);
});
