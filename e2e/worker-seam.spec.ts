/**
 * `CE-WORKER-SEAM` (v1.1) — proves the real `WorkerTransport` default runs
 * built-in sort/filter OFF the main thread (`ADR-SORT-FILTER-SEAM`,
 * `ADR-WORKER-OPS`). Against the live 1,000,000-row demo in real Chromium:
 *
 *  1. A real module `Worker` was created (`window.__workerCount >= 1`).
 *  2. A built-in sort runs and updates the grid (correctness), AND the main
 *     thread stays RESPONSIVE while the worker rebuilds the 1M-row index: rAF
 *     keeps firing (many frames, no long block) during the in-flight sort — the
 *     off-thread proof. On the old in-process transport a 1M sort blocks the main
 *     thread (~one long frame); off-thread it does not.
 *  3. A built-in filter runs off-thread and drops the row count (correctness).
 *  4. The `mg:sort` / `mg:filter` User-Timing marks capture the worker-seam
 *     round-trip (transfer + rebuild) so the perf re-baseline can be read off.
 *  5. axe reports ZERO violations (`AC-AXE`).
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

const cellText = (
  page: import("@playwright/test").Page,
  rowIndex: number,
  colIndex: number,
) =>
  page
    .locator(`[role=gridcell][aria-rowindex="${rowIndex}"][aria-colindex="${colIndex}"]`)
    .textContent();
const cellNum = async (
  page: import("@playwright/test").Page,
  rowIndex: number,
  colIndex: number,
): Promise<number> =>
  Number(((await cellText(page, rowIndex, colIndex)) ?? "").replace(/[^0-9.-]/g, ""));

test("a real module Worker backs the grid by default (ADR-WORKER-OPS)", async ({ page }) => {
  const workerCount = await page.evaluate(() => (window as any).__workerCount);
  expect(workerCount).toBeGreaterThanOrEqual(1);
});

test("built-in sort runs OFF the main thread — the main thread stays responsive during a 1M sort", async ({
  page,
}) => {
  // Drive a built-in (declarative) sort over 1M rows while sampling rAF frames on
  // the main thread. Off-thread → rAF keeps firing (many frames, no long block).
  const res = await page.evaluate(async () => {
    const grid = (window as any).__grid;
    let frames = 0;
    let maxGap = 0;
    let last = performance.now();
    let sorting = true;
    const tick = (): void => {
      const now = performance.now();
      const gap = now - last;
      last = now;
      if (gap > maxGap) maxGap = gap;
      frames++;
      if (sorting) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const t0 = performance.now();
    // c3 is a numeric, non-monotonic column — a real reordering of 1M rows.
    await grid.sort({ entries: [{ columnId: "c3", direction: "desc" }] });
    const durMs = performance.now() - t0;
    sorting = false;
    const marks = grid.getPerfMarks().filter((m: any) => m.name === "mg:sort");
    return {
      frames,
      maxGap,
      durMs,
      seamMs: marks.length ? marks[marks.length - 1].duration : null,
      workerCount: (window as any).__workerCount,
    };
  });

  // eslint-disable-next-line no-console
  console.log(
    `[PERF-SORT worker-seam] end-to-end=${res.durMs.toFixed(1)}ms mg:sort=${
      res.seamMs != null ? res.seamMs.toFixed(1) : "n/a"
    }ms · frames-during-sort=${res.frames} maxGap=${res.maxGap.toFixed(1)}ms`,
  );

  // A real worker is in play.
  expect(res.workerCount).toBeGreaterThanOrEqual(1);
  // Off-thread proof: the main thread kept painting frames throughout the sort and
  // never suffered a single multi-hundred-ms block (which an on-thread 1M sort is).
  expect(res.frames).toBeGreaterThanOrEqual(3);
  expect(res.maxGap).toBeLessThan(150);

  // Correctness: the first visible rows are now descending on c3, and the natural
  // top row (id 0) is no longer first.
  await expect
    .poll(async () => cellNum(page, 1, 4))
    .toBeGreaterThanOrEqual(await cellNum(page, 2, 4));
  expect(await cellText(page, 1, 1)).not.toBe("0");
});

test("built-in filter runs off-thread and drops the 1M row count (correctness)", async ({
  page,
}) => {
  const before = await page.evaluate(
    async () => (await (window as any).__grid.getRowCount()).rowCount,
  );
  expect(before).toBe(1_000_000);

  const res = await page.evaluate(async () => {
    const grid = (window as any).__grid;
    const t0 = performance.now();
    const out = await grid.filter({ perColumn: { id: { op: "gt", value: 500000 } } });
    const durMs = performance.now() - t0;
    const marks = grid.getPerfMarks().filter((m: any) => m.name === "mg:filter");
    return {
      rowCount: out.rowCount,
      durMs,
      seamMs: marks.length ? marks[marks.length - 1].duration : null,
    };
  });

  // eslint-disable-next-line no-console
  console.log(
    `[PERF-FILTER worker-seam] end-to-end=${res.durMs.toFixed(1)}ms mg:filter=${
      res.seamMs != null ? res.seamMs.toFixed(1) : "n/a"
    }ms · rowCount=${res.rowCount}`,
  );

  expect(res.rowCount).toBeGreaterThan(0);
  expect(res.rowCount).toBeLessThan(1_000_000);
  // The grid reflects the filtered extent.
  await expect
    .poll(async () =>
      page.evaluate(async () => (await (window as any).__grid.getRowCount()).rowCount),
    )
    .toBeLessThan(1_000_000);
});

test("a11y: axe reports ZERO violations after an off-thread sort (AC-AXE)", async ({ page }) => {
  await page.evaluate(async () => {
    await (window as any).__grid.sort({ entries: [{ columnId: "c3", direction: "asc" }] });
  });
  await page.locator('[role=gridcell][aria-rowindex="1"][aria-colindex="1"]').click();
  const results = await new AxeBuilder({ page }).include("[data-mini-grid]").analyze();
  expect(results.violations).toEqual([]);
});
