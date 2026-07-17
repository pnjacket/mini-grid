/**
 * `A11Y-*` hardening battery (Slice 11a) against the live 1,000,000-row demo:
 *
 *  - `AC-ANNOUNCE`     — a sort announces once on the POLITE live region with no
 *    focus stolen to the region (the accessible-announcement contract).
 *  - `AC-FOCUS-RESTORE`— Esc from an open editor restores focus to the origin
 *    cell (re-assert; the menu variant lives in crud.spec).
 *  - `AC-FORCED-COLORS`— under `forced-colors: active`, borders + focus remain
 *    visible (system colors) and axe stays clean.
 *  - `AC-CSP` (`SEC-CSP-COMPAT`) — the ESM build loads + functions under a strict
 *    CSP (no `unsafe-eval`, no inline script), and a script-bearing cell value
 *    does NOT execute in the page.
 *  - `AC-AXE` (RTL) — axe reports ZERO violations on the grid + an open filter
 *    menu under `dir=rtl`.
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function waitReady(page: import("@playwright/test").Page): Promise<void> {
  await page.waitForFunction(() => (window as any).__ready === true, null, {
    timeout: 60_000,
  });
  await page.waitForSelector("[role=gridcell]", { state: "attached" });
}

const politeRegion = '[data-mg-live="polite"]';

test.describe("A11Y-GRID live region + focus", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demo/index.html");
    await waitReady(page);
  });

  test("AC-ANNOUNCE: a sort announces politely without stealing focus", async ({
    page,
  }) => {
    // The visually-hidden polite region exists (sibling of role=grid).
    await expect(page.locator(politeRegion)).toHaveCount(1);

    // Sort by clicking the ID header label.
    await page
      .locator('[role=columnheader][data-col-id="id"] .mg-header-label')
      .click();

    // The polite region receives the settle announcement.
    await expect
      .poll(
        () =>
          page.evaluate(
            (sel) => document.querySelector(sel)?.textContent ?? "",
            politeRegion,
          ),
        { timeout: 10_000 },
      )
      .toContain("Sorted by");

    // Announcing never moves focus into the live region.
    const focusIsLiveRegion = await page.evaluate(
      () => document.activeElement?.getAttribute("data-mg-live") != null,
    );
    expect(focusIsLiveRegion).toBe(false);
  });

  test("AC-FOCUS-RESTORE: Esc from an open editor restores focus to the cell", async ({
    page,
  }) => {
    const cell = page.locator(
      '[role=gridcell][aria-rowindex="1"][aria-colindex="2"]',
    );
    await cell.click();
    await expect(cell).toBeFocused();

    // Type-to-replace opens the editor; Esc discards + restores focus.
    await page.keyboard.type("X");
    await expect(page.locator("[data-mg-editor] input")).toBeFocused();
    await page.keyboard.press("Escape");

    await expect(page.locator("[data-mg-editor]")).toHaveCount(0);
    await expect(cell).toBeFocused();
  });
});

test.describe("AC-FORCED-COLORS", () => {
  test("borders + focus stay visible under forced-colors; axe clean", async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await page.goto("/demo/index.html");
    await waitReady(page);

    const cell = page.locator(
      '[role=gridcell][aria-rowindex="1"][aria-colindex="1"]',
    );
    await cell.click();

    // The active/focused cell keeps a visible outline (system Highlight).
    const outline = await cell.evaluate((el) => {
      const s = getComputedStyle(el);
      return { style: s.outlineStyle, width: s.outlineWidth };
    });
    expect(outline.style).not.toBe("none");
    expect(outline.width).not.toBe("0px");

    // Cell borders stay visible (never dropped to 0).
    const borderWidth = await cell.evaluate(
      (el) => getComputedStyle(el).borderBottomWidth,
    );
    expect(borderWidth).not.toBe("0px");

    // No information conveyed by color alone → axe stays clean.
    const results = await new AxeBuilder({ page })
      .include("[data-mini-grid]")
      .analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("AC-CSP (SEC-CSP-COMPAT)", () => {
  test("ESM build loads + functions under a strict CSP; injected script stays inert", async ({
    page,
  }) => {
    // Add a strict CSP header to the demo document: no unsafe-eval, no inline
    // script. (`style-src 'unsafe-inline'` is allowed — the grid legitimately
    // injects a <style> + inline styles; the contract is about script/eval.)
    await page.route("**/demo/index.html", async (route) => {
      const response = await route.fetch();
      const headers = {
        ...response.headers(),
        "content-security-policy":
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self'; connect-src 'self'",
      };
      await route.fulfill({ response, headers });
    });

    const violations: string[] = [];
    page.on("console", (msg) => {
      if (/content security policy/i.test(msg.text())) violations.push(msg.text());
    });

    await page.goto("/demo/index.html");
    await waitReady(page);

    // The grid rendered under the strict CSP (no eval/inline-script needed).
    expect(
      await page.locator("[role=gridcell]").count(),
    ).toBeGreaterThan(0);

    // It still functions: sorting works.
    await page
      .locator('[role=columnheader][data-col-id="id"] .mg-header-label')
      .click();
    await expect(
      page.locator('[role=columnheader][data-col-id="id"]'),
    ).toHaveAttribute("aria-sort", /ascending|descending/);

    // A script-bearing cell value is rendered as TEXT and does NOT execute.
    await page.evaluate(async () => {
      await (window as any).__grid.updateCell(
        0,
        "c1",
        '<img src=x onerror="window.__pwned=true">',
      );
    });
    const cell = page.locator(
      '[role=gridcell][data-row-key="0"][data-col-id="c1"]',
    );
    await expect(cell).toContainText("<img");
    expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();

    // No CSP violation from an eval/inline-script sink in the grid itself.
    expect(violations.filter((v) => /eval|inline/i.test(v))).toEqual([]);
  });
});

test.describe("AC-AXE (RTL)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demo/index.html");
    await waitReady(page);
  });

  test("axe ZERO violations on the grid + open filter menu under dir=rtl", async ({
    page,
  }) => {
    await page.evaluate(() => (window as any).__grid.setDirection("rtl"));
    await expect(page.locator('[data-mini-grid][dir="rtl"]')).toBeVisible();

    // Seed a selection so aria-selected/roving-focus is exercised.
    await page
      .locator('[role=gridcell][aria-rowindex="1"][aria-colindex="1"]')
      .click();

    const grid = await new AxeBuilder({ page })
      .include("[data-mini-grid]")
      .analyze();
    expect(grid.violations).toEqual([]);

    // Open the filter menu (an open layer) and axe it too, still RTL.
    await page
      .locator('[role=columnheader][data-col-id="id"] [data-mg-filter-btn]')
      .click();
    await expect(page.locator(".mg-filter-menu")).toBeVisible();
    const menu = await new AxeBuilder({ page })
      .include(".mg-filter-menu")
      .analyze();
    expect(menu.violations).toEqual([]);
  });
});
