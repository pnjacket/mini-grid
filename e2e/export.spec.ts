/**
 * `CAP-EXPORT` + `CAP-PERSIST-STATE` (slice 8) — export + state persistence
 * against the live demo grid in Chromium. Proves on the real surface:
 *
 *  1. `exportCsv()` serializes the current view to a `text/csv` Blob; a
 *     formula-leading value is neutralized by `SEC-EXPORT-FORMULA-GUARD`.
 *  2. `exportXlsx()` is fail-soft: exceljs is not resolvable in the browser, so
 *     it rejects `XLSX_UNAVAILABLE` (+ `EVT-ERROR`) while `exportCsv()` keeps
 *     working (`AC-XLSX-FAILSOFT`).
 *  3. `serializeState()` → mutate layout → `restoreState()` restores widths /
 *     order / freeze (`AC-STATE-VERSION`).
 *  4. axe-core reports ZERO violations after the export/persist flow (`AC-AXE`).
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

test("CAP-EXPORT: exportCsv serializes the view + neutralizes a formula value", async ({
  page,
}) => {
  // Rebind to a small dataset carrying a formula-injection value in a text column.
  await page.evaluate(async () => {
    await (window as any).__grid.setData([
      { id: 1, c1: '=HYPERLINK("http://evil")', c2: "r-a", c3: 10 },
      { id: 2, c1: "safe", c2: "r-b", c3: 20 },
    ]);
  });

  const { type, csv } = await page.evaluate(async () => {
    const blob: Blob = await (window as any).__grid.exportCsv();
    return { type: blob.type, csv: await blob.text() };
  });

  expect(type).toContain("text/csv");
  const lines = csv.split("\r\n");
  expect(lines[0]).toContain("ID"); // header row
  // SEC-EXPORT-FORMULA-GUARD prefixed the =HYPERLINK value.
  expect(csv).toContain("'=HYPERLINK");
  expect(csv).toContain("safe");
  expect(lines.length).toBeGreaterThanOrEqual(3); // header + 2 rows
});

test("AC-XLSX-FAILSOFT: exportXlsx rejects XLSX_UNAVAILABLE; exportCsv still works", async ({
  page,
}) => {
  const res = await page.evaluate(async () => {
    const g = (window as any).__grid;
    let evt: string | null = null;
    g.on("error", ({ error }: any) => {
      if (error.code === "XLSX_UNAVAILABLE") evt = error.code;
    });
    let code: string | null = null;
    try {
      await g.exportXlsx();
    } catch (e: any) {
      code = e.code;
    }
    const csv: string = await (await g.exportCsv()).text();
    return { code, evt, csvOk: csv.length > 0 };
  });

  expect(res.code).toBe("XLSX_UNAVAILABLE");
  expect(res.evt).toBe("XLSX_UNAVAILABLE");
  expect(res.csvOk).toBe(true);
});

test("CAP-PERSIST-STATE: serialize → mutate → restore restores the layout", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const g = (window as any).__grid;
    const before = g.serializeState();
    const c1 = (s: any) => s.columns.find((c: any) => c.id === "c1");
    const widthBefore = c1(before).width;
    const orderBefore = before.columns.map((c: any) => c.id);

    // Mutate the layout away from the snapshot.
    g.setColumnWidth("c1", 400);
    g.setFrozen({ cols: 2 });
    g.moveColumn("c1", 4);
    await new Promise((r) => setTimeout(r, 150));

    // Restore.
    g.restoreState(before);
    await new Promise((r) => setTimeout(r, 250));

    const after = g.serializeState();
    return {
      widthBefore,
      widthAfter: c1(after).width,
      orderBefore,
      orderAfter: after.columns.map((c: any) => c.id),
      frozenAfter: after.frozen,
    };
  });

  expect(result.widthAfter).toBe(result.widthBefore);
  expect(result.orderAfter).toEqual(result.orderBefore);
  expect(result.frozenAfter.cols).toBe(0);
});

test("AC-AXE: zero accessibility violations after the export/persist flow", async ({
  page,
}) => {
  await page.evaluate(async () => {
    const g = (window as any).__grid;
    const s = g.serializeState();
    g.setColumnWidth("c1", 300);
    g.restoreState(s);
    await (await g.exportCsv()).text();
  });
  // Seed a selection so roving-focus gives the scroll region focusable content.
  await page
    .locator('[role=gridcell][aria-rowindex="1"][aria-colindex="1"]')
    .click();

  const results = await new AxeBuilder({ page })
    .include("[data-mini-grid]")
    .analyze();
  expect(results.violations).toEqual([]);
});
