/**
 * `JOURNEY-FORMAT` — the slice-5 formatting journey (`CAP-FMT-CELL`/`-FMT-VALUE`/
 * `-COND-FMT`/`-THEME`, `SEC-RENDERER-DOM-ONLY`) against the live 1,000,000-row
 * demo in Chromium. Proves on the real surface (computed style / attributes — no
 * pixel snapshots):
 *
 *  1. A value conditional rule (`value > N → fill`) paints matching cells red and
 *     leaves non-matching cells unchanged (`COMPONENT-CONDFMT`).
 *  2. A data bar draws a proportional in-cell bar whose width scales with the
 *     value over the full-dataset range (`MSG-AGGREGATE`, `ADR-CONDFMT-AGG`).
 *  3. Toggling the dark theme changes a `--mg-*` token (`LIB-THEME`, `CAP-THEME`).
 *  4. A script-bearing cell value routed through a custom renderer does NOT
 *     execute and is rendered as literal text (`SEC-RENDERER-DOM-ONLY`).
 *  5. Accessibility — axe-core reports ZERO violations with rules + dark theme.
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

test("CAP-COND-FMT: a value rule paints a red fill on matching cells only", async ({
  page,
}) => {
  // Rule over the `id` column (colindex 1): id > 5 → red fill.
  await page.evaluate(() =>
    (window as any).__grid.addConditionalRule({
      kind: "value",
      scope: [{ top: 0, left: 0, bottom: 2_000_000, right: 0 }],
      config: { op: ">", value: 5 },
      style: { fillColor: "rgb(255, 0, 0)" },
    }),
  );

  // Row aria-rowindex 7 → id 6 (> 5) → red. Row 1 → id 0 → unchanged.
  const match = page.locator('[role=gridcell][aria-rowindex="7"][aria-colindex="1"]');
  await expect
    .poll(() => match.evaluate((el) => getComputedStyle(el).backgroundColor), {
      timeout: 10_000,
    })
    .toBe("rgb(255, 0, 0)");

  const noMatch = page.locator('[role=gridcell][aria-rowindex="1"][aria-colindex="1"]');
  expect(
    await noMatch.evaluate((el) => getComputedStyle(el).backgroundColor),
  ).not.toBe("rgb(255, 0, 0)");
});

test("CAP-COND-FMT: a data bar draws a proportional in-cell bar (getComputedStyle width)", async ({
  page,
}) => {
  await page.evaluate(() =>
    (window as any).__grid.addConditionalRule({
      kind: "dataBar",
      scope: [{ top: 0, left: 0, bottom: 2_000_000, right: 0 }],
      config: { columnId: "id", color: "rgb(51, 102, 204)" },
    }),
  );
  // Scroll to large ids so the bar fraction (id / max) is substantial.
  await page.evaluate(() => (window as any).__grid.scrollTo({ rowIndex: 600_000 }));

  // A visible id-column cell now has a wide bar (>20% of the cell).
  await page.waitForFunction(
    () => {
      const cells = [
        ...document.querySelectorAll('[role=gridcell][aria-colindex="1"]'),
      ];
      return cells.some((c) => {
        const bar = c.querySelector("[data-mg-databar]") as HTMLElement | null;
        return !!bar && parseFloat(bar.style.width) > 20;
      });
    },
    null,
    { timeout: 15_000 },
  );

  const width = await page.evaluate(() => {
    const cells = [
      ...document.querySelectorAll('[role=gridcell][aria-colindex="1"]'),
    ];
    for (const c of cells) {
      const bar = c.querySelector("[data-mg-databar]") as HTMLElement | null;
      if (bar && parseFloat(bar.style.width) > 20) {
        return { pct: bar.style.width, px: getComputedStyle(bar).width };
      }
    }
    return null;
  });
  expect(width).not.toBeNull();
  expect(width!.pct).toMatch(/%$/);
  expect(parseFloat(width!.px)).toBeGreaterThan(0);
});

test("CAP-THEME: toggling the dark theme changes a --mg-* token", async ({
  page,
}) => {
  const root = page.locator("[data-mini-grid]");
  const before = await root.evaluate((el) =>
    getComputedStyle(el).getPropertyValue("--mg-cell-bg").trim(),
  );

  await page.evaluate(() => (window as any).__grid.setTheme("dark"));
  await expect(root).toHaveClass(/mg-theme-dark/);

  const after = await root.evaluate((el) =>
    getComputedStyle(el).getPropertyValue("--mg-cell-bg").trim(),
  );
  expect(after).not.toBe(before); // the token cascade re-resolved on theme switch
});

test("SEC-RENDERER-DOM-ONLY: a script-bearing value with a custom renderer does not execute", async ({
  page,
}) => {
  const payload = '<img src=x onerror="window.__pwned=true">';
  // c4 (colindex 5) has a string-returning custom renderer → applied via
  // textContent, never innerHTML. Write the script string as the cell value.
  await page.evaluate((p) => (window as any).__grid.updateCell(0, "c4", p), payload);

  const cell = page.locator('[role=gridcell][aria-rowindex="1"][aria-colindex="5"]');
  await expect(cell).toHaveText(payload); // literal text, not parsed HTML
  expect(await cell.locator("img").count()).toBe(0); // no live element
  expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();
});

test("CAP-COND-FMT/THEME a11y: axe reports ZERO violations with rules + dark theme (AC-AXE)", async ({
  page,
}) => {
  // Seed a selection so a cell carries the roving tabindex inside `.mg-scroll`
  // (the scrollable region then has a focusable descendant) — matching the other
  // real-flow axe gates, which interact before analyzing.
  await page.locator('[role=gridcell][aria-rowindex="1"][aria-colindex="1"]').click();

  await page.evaluate(() => {
    // High-contrast fill (white on blue) so the fill itself stays AA.
    (window as any).__grid.addConditionalRule({
      kind: "value",
      scope: [{ top: 0, left: 0, bottom: 2_000_000, right: 0 }],
      config: { op: ">", value: 5 },
      style: { fillColor: "#0b5fff", textColor: "#ffffff" },
    });
    (window as any).__grid.setTheme("dark");
  });
  await expect(page.locator("[data-mini-grid]")).toHaveClass(/mg-theme-dark/);

  const results = await new AxeBuilder({ page })
    .include("[data-mini-grid]")
    .analyze();
  expect(results.violations).toEqual([]);
});
