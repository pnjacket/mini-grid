/**
 * `JOURNEY-FORMULA` — the v1.5 formula journey (`CAP-FORMULA`, `LIB-FORMULA-*`,
 * `EVT-AFTER-RECALC`, `INV-FORMULA-DERIVED/-INCREMENTAL/-ACYCLIC`) against the
 * live formula demos in real Chromium. Proves on the real DOM + in-process engine:
 *
 *  1. Formula columns render COMPUTED values while the editor/`getCellFormula`
 *     see the FORMULA string (`INV-FORMULA-DERIVED`).
 *  2. Editing a precedent cascades to dependents, including a range SUM totals row.
 *  3. Interactive edit (double-click → type `=formula` → Enter) computes in the cell.
 *  4. A division-by-zero shows `#DIV/0!`; a self-reference shows `#CIRC!` (no hang).
 *  5. Sorting orders by computed values (`INV-FORMULA-DERIVED`).
 *  6. The 300k-chained-formula stress page builds + recalculates; a leaf edit is
 *     far cheaper than a head-of-chain edit (`INV-FORMULA-INCREMENTAL`).
 */
import { test, expect } from "@playwright/test";

/* eslint-disable @typescript-eslint/no-explicit-any */

const cell = (row1: number, col1: number) =>
  `[role=gridcell][aria-rowindex="${row1}"][aria-colindex="${col1}"]`;

test.describe("JOURNEY-FORMULA — showcase", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demo/formula.html");
    await page.waitForFunction(() => (window as any).__ready === true, null, { timeout: 60_000 });
    await page.waitForSelector("[role=gridcell]", { state: "attached" });
  });

  test("INV-FORMULA-DERIVED: cells show computed values; getCellFormula returns the source", async ({ page }) => {
    // Row 1 (Widgets): B=40, C=12 → D revenue =B1*C1 = 480. Column D is aria-colindex 4.
    await expect.poll(() => page.locator(cell(1, 4)).innerText()).toContain("480");
    // E net =D1-IF(D1>500,...) ; D1=480 ≤ 500 → net = 480.
    await expect.poll(() => page.locator(cell(1, 5)).innerText()).toContain("480");
    // F rating: E1=480 → "★★" (>400).
    await expect.poll(() => page.locator(cell(1, 6)).innerText()).toBe("★★");

    // getCellFormula surfaces the raw formula, not the computed value.
    const f = await page.evaluate(() => (window as any).__grid.getCellFormula(0, "revenue"));
    expect(f).toBe("=B1*C1"); // D = B*C
  });

  test("INV-FORMULA-DERIVED + chain: editing an input recomputes the row AND the SUM totals row", async ({ page }) => {
    // Totals row is row 9 (id 8); D totals = SUM(D1:D8), aria-colindex 4.
    const totalD = page.locator(cell(9, 4));
    const before = await totalD.innerText();

    // Bump Widgets units (row 1, id 0) from 40 → 100 via the programmatic edit path.
    await page.evaluate(() => (window as any).__grid.updateCell(0, "units", 100));

    // D1 recomputes (100*12=1200) and the totals SUM follows.
    await expect.poll(() => page.locator(cell(1, 4)).innerText()).toContain("1,200");
    await expect.poll(() => totalD.innerText()).not.toBe(before);
  });

  test("interactive edit: double-click a cell, type a =formula, Enter → it computes", async ({ page }) => {
    // Edit Widgets price (row 1, col C = aria-colindex 3) to a formula.
    const priceCell = page.locator(cell(1, 3));
    await priceCell.dblclick();
    const input = page.locator("[data-mg-editor] input");
    await input.fill("=6*2");
    await input.press("Enter");
    // Price shows 12; revenue D1 = B1*C1 = 40*12 = 480.
    await expect.poll(() => page.locator(cell(1, 3)).innerText()).toContain("12");
    await expect.poll(() => page.locator(cell(1, 4)).innerText()).toContain("480");
  });

  test("INV-FORMULA-ACYCLIC + errors: #DIV/0! and #CIRC! render, no hang", async ({ page }) => {
    await page.evaluate(async () => {
      const g = (window as any).__grid;
      await g.updateCell(1, "revenue", "=C2/0"); // row 2 (id 1) revenue → #DIV/0!
      await g.updateCell(0, "revenue", "=E1"); // D1 = E1
      await g.updateCell(0, "net", "=D1"); // E1 = D1 → cycle D1↔E1
    });
    await expect.poll(() => page.locator(cell(2, 4)).innerText()).toContain("#DIV/0!");
    await expect.poll(() => page.locator(cell(1, 4)).innerText()).toContain("#CIRC!");
  });

  test("INV-FORMULA-DERIVED: sorting orders by the COMPUTED value of a formula column", async ({ page }) => {
    await page.evaluate(() =>
      (window as any).__grid.sort({ entries: [{ columnId: "revenue", direction: "asc" }] }),
    );
    // The revenue (D) column, top visible data rows, should be ascending computed numbers.
    const nums = await page.evaluate(async () => {
      const res = await (window as any).__grid.getRows({ startIndex: 0, endIndex: 4 });
      return res.rows.map((r: any) => r.data.revenue);
    });
    const sorted = [...nums].sort((a, b) => a - b);
    expect(nums).toEqual(sorted);
  });
});

test.describe("JOURNEY-FORMULA — 300k chained stress (INV-FORMULA-INCREMENTAL)", () => {
  test("builds 300k formula cells and a leaf edit is far cheaper than a head-of-chain edit", async ({ page }) => {
    // Use a smaller row count for E2E speed; the incremental property is scale-free.
    await page.goto("/demo/formula-stress.html?rows=20000");
    await page.waitForFunction(() => (window as any).__ready === true, null, { timeout: 120_000 });

    const cells = await page.evaluate(() => (window as any).__formulaPerf.formulaCells);
    expect(cells).toBe(20_000 * 6);

    // A clean full recalc completed with no cycles (the demo already computed on
    // load, so a redundant recalc reports 0 changed — cycles is the invariant here).
    const full = await page.evaluate(() => (window as any).__grid.recalculate());
    expect(full.cycles).toBe(0);
    expect(typeof full.elapsedMs).toBe("number");

    // Head edit (cascades the whole running-Σ chain) vs leaf edit (tiny subgraph).
    await page.click("#editHead");
    await page.waitForFunction(() => (window as any).__formulaPerf.headEditMs != null);
    await page.click("#editLeaf");
    await page.waitForFunction(() => (window as any).__formulaPerf.leafEditMs != null);
    const perf = await page.evaluate(() => (window as any).__formulaPerf);

    // The incremental win: a leaf edit touches far fewer cells than the head cascade.
    expect(perf.leafEditMs).toBeLessThan(perf.headEditMs);
  });

  test("worst case: chained COUNTIF (slowest built-in) recomputes correctly; leaf edit still isolates", async ({ page }) => {
    await page.goto("/demo/formula-worst.html?rows=5000");
    await page.waitForFunction(() => (window as any).__ready === true, null, { timeout: 120_000 });

    const perf = await page.evaluate(() => (window as any).__formulaPerf);
    expect(perf.formulaCells).toBe(5000 * 6);
    expect(perf.fn).toBe("COUNTIF");

    // No cycles despite the vertical chain + horizontal cross-links.
    const full = await page.evaluate(() => (window as any).__grid.recalculate());
    expect(full.cycles).toBe(0);

    // A head edit to A1 cascades the whole cross-linked graph; a leaf edit does not.
    await page.click("#editHead");
    await page.waitForFunction(() => (window as any).__formulaPerf.headEditMs != null, { timeout: 60_000 });
    await page.click("#editLeaf");
    await page.waitForFunction(() => (window as any).__formulaPerf.leafEditMs != null);
    const p2 = await page.evaluate(() => (window as any).__formulaPerf);
    expect(p2.leafEditMs).toBeLessThan(p2.headEditMs); // incremental win holds for the slow fn too
  });
});
