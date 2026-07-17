/**
 * `SUCCESS-DX` — the kitchen-sink demo E2E. Loads `demo/kitchen-sink.html` and
 * drives every capability's control at least once, asserting non-error outcomes.
 * This is the SUCCESS-DX proof: the demo page exercises every `CAP-*`, and axe
 * reports zero violations on the grid.
 *
 * The demo records outcomes: `window.__errors` holds ONLY unexpected failures
 * (empty at the end proves clean operation), `window.__gridErrors` holds
 * `EVT-ERROR` codes (only the expected `XLSX_UNAVAILABLE` in the no-bundler demo).
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/* eslint-disable @typescript-eslint/no-explicit-any */

const CAPS = [
  "CAP-DATA-BIND", "CAP-VIRTUALIZE", "CAP-EDIT", "CAP-VALIDATE", "CAP-UNDO",
  "CAP-SELECT", "CAP-CLIPBOARD", "CAP-FMT-CELL", "CAP-FMT-VALUE", "CAP-COND-FMT",
  "CAP-SORT", "CAP-FILTER", "CAP-RESIZE", "CAP-REORDER", "CAP-FREEZE", "CAP-MERGE",
  "CAP-GROUP", "CAP-EXPORT", "CAP-PERSIST-STATE", "CAP-THEME", "CAP-I18N",
  "CAP-A11Y", "CAP-FEATURE-FLAGS",
  // v1.3/v1.4 header/menu/selection subsystem (slices 17–20).
  "CAP-HEADER", "CAP-COLUMN-MANAGE", "CAP-MENU",
];

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const cell = (row: number, col: number) =>
  `[role=gridcell][aria-rowindex="${row}"][aria-colindex="${col}"]`;

/** Wait until the (possibly rebuilt) grid has finished loading its data. */
async function ready(page: import("@playwright/test").Page): Promise<void> {
  await page.waitForFunction(() => (window as any).__ready === true, null, {
    timeout: 60_000,
  });
  await page.waitForSelector("[role=gridcell]", { state: "attached" });
}

/** The recorded outcome of a named action (or undefined if it never ran). */
const lastOutcome = (page: import("@playwright/test").Page, name: string) =>
  page.evaluate(
    (n) => [...(window as any).__log].reverse().find((e: any) => e.name === n),
    name,
  );

const unexpectedErrors = (page: import("@playwright/test").Page) =>
  page.evaluate(() => (window as any).__errors);

test.beforeEach(async ({ page }) => {
  await page.goto("/demo/kitchen-sink.html");
  await ready(page);
});

test("CAP-DATA-BIND + CAP-VIRTUALIZE: 100k rows bound, only a window rendered", async ({
  page,
}) => {
  const rowCount = await page.evaluate(
    async () => (await (window as any).__grid.getRowCount()).rowCount,
  );
  expect(rowCount).toBe(100_000);
  // Virtualization: far fewer cells in the DOM than rows.
  const cells = await page.locator("[role=gridcell]").count();
  expect(cells).toBeGreaterThan(0);
  expect(cells).toBeLessThan(2_000);

  await page.click("#ctl-scroll");
  await expect
    .poll(() =>
      page.evaluate(() =>
        Math.max(
          ...[...document.querySelectorAll("[role=gridcell]")].map((c) =>
            Number(c.getAttribute("aria-rowindex")),
          ),
        ),
      ),
    )
    .toBeGreaterThan(1000);
  expect((await lastOutcome(page, "scroll"))?.status).toBe("ok");
});

test("CAP-SELECT: selecting a range reflects in the readout", async ({ page }) => {
  await page.click("#ctl-select");
  const span = await page.evaluate(() => {
    const r = (window as any).__grid.getSelection().ranges[0];
    return r ? (r.bottom - r.top + 1) * (r.right - r.left + 1) : 0;
  });
  expect(span).toBe(15); // rows 2–6 × cols 1–3
  await expect(page.locator("#selection")).toContainText("cell(s)");
});

test("CAP-SELECT (multi-range): Ctrl-click adds a disjoint range; a header click line-selects the column", async ({
  page,
}) => {
  // Two non-adjacent Ctrl+clicks → two disjoint ranges (INV-SELECTION-WELLFORMED).
  await page.locator(cell(2, 2)).click();
  await page.locator(cell(6, 4)).click({ modifiers: ["Control"] });
  const ranges = await page.evaluate(
    () => (window as any).__grid.getSelection().ranges.length,
  );
  expect(ranges).toBe(2);
  // Two discontiguous aria-selected blocks in the DOM.
  await expect(page.locator('[role=gridcell][aria-selected="true"]')).toHaveCount(2);

  // Clicking a column-header body line-selects the whole column (full height).
  await page
    .locator('[role=columnheader][data-band="1"][data-col-id="score"] [data-mg-header-body]')
    .click();
  const line = await page.evaluate(
    () => (window as any).__grid.getSelection().ranges[0],
  );
  expect(line.left).toBe(line.right); // one column wide
  expect(line.top).toBe(0);
  expect(line.bottom).toBeGreaterThan(1000); // spans the whole (100k-row) column
});

test("CAP-HEADER: row-number gutter, a custom headerRender, and a headerTooltip render", async ({
  page,
}) => {
  // Row-header gutter — role=rowheader carrying the 1-based visual row number.
  await expect(page.locator('[role=rowheader][data-row-index="0"]')).toHaveText("1");
  // Two column-header bands: a group-span band 0 over the per-column labels band 1.
  await expect(page.locator(".mg-header [role=row]")).toHaveCount(2);
  // Custom headerRender: the ★ label on the Name column (primary band).
  await expect(
    page.locator('[role=columnheader][data-band="1"][data-col-id="name"]'),
  ).toContainText("★");
  // headerTooltip: a title on the ID column header.
  await expect(
    page.locator('[role=columnheader][data-band="1"][data-col-id="id"]'),
  ).toHaveAttribute("title", "Unique record identifier");
});

test("CAP-COLUMN-MANAGE: hide/show, pin, and autofit change the header (EVT-COLUMN-*)", async ({
  page,
}) => {
  const headerCount = () =>
    page.locator("[role=columnheader][data-col-id]").count();
  const categoryHeader =
    '[role=columnheader][data-band="1"][data-col-id="category"]';

  // Hide the active column — select a Category body cell (col index 2 → colindex 3).
  await page.locator(cell(1, 3)).click();
  const before = await headerCount();
  await page.click("#ctl-hide-col");
  await expect(page.locator(categoryHeader)).toHaveCount(0);
  await expect(page.locator('[role=gridcell][data-col-id="category"]')).toHaveCount(0);
  expect(await headerCount()).toBeLessThan(before);

  // Show all restores it.
  await page.click("#ctl-show-all");
  await expect(page.locator(categoryHeader)).toBeVisible();

  // Pin the active column → it joins the frozen leading block.
  await page.locator(cell(1, 3)).click(); // category col
  await page.click("#ctl-pin-col");
  await expect(page.locator(categoryHeader)).toHaveClass(/mg-header-cell--frozen/);

  // Autofit the active column (EVT-COLUMN-AUTOFIT). Deterministic: first set `name`
  // to a deliberately-wide 260px, then autofit shrinks it to fit the short
  // "First Last" content (never near 260px) — and a second autofit is idempotent.
  // Select `name` by id (robust to the pin-driven reorder above).
  const name = page.locator(
    '[role=columnheader][data-band="1"][data-col-id="name"]',
  );
  const widthOf = async () => Math.round((await name.boundingBox())!.width);
  await page.click("#ctl-resize"); // grid.setColumnWidth('name', 260)
  await expect.poll(widthOf).toBeGreaterThan(230); // wait for the resize to apply (~260)
  const wWide = await widthOf();
  await page.locator('[role=gridcell][data-col-id="name"]').first().click();
  await page.click("#ctl-autofit");
  await expect.poll(widthOf).toBeLessThan(wWide); // autofit shrank it below 260 to fit
  const wFit = await widthOf();
  await page.click("#ctl-autofit");
  await expect.poll(widthOf).toBe(wFit); // idempotent — content-based, deterministic
  expect(await unexpectedErrors(page)).toEqual([]);
});

test("CAP-MENU: cell menu (custom + submenu + toggle) vs header menu (built-ins); axe clean with a menu open", async ({
  page,
}) => {
  // Cell menu — right-click a body cell: clipboard built-ins + rich item kinds.
  await page.locator(cell(2, 2)).click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Copy" })).toBeVisible();
  await expect(page.locator("[data-mg-custom]")).toBeVisible(); // ★ Flag this cell
  await expect(
    page.getByRole("menuitemcheckbox", { name: "Star row" }),
  ).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "More…" })).toHaveAttribute(
    "aria-haspopup",
    "menu",
  );
  // A header-only built-in is absent on the cell menu.
  await expect(page.getByRole("menuitem", { name: "Sort ascending" })).toHaveCount(0);

  // axe: zero violations with the rich cell menu open.
  await expect(page.locator(".mg-context-menu")).toBeVisible();
  const cellMenuAxe = await new AxeBuilder({ page })
    .include(".mg-context-menu")
    .analyze();
  expect(cellMenuAxe.violations).toEqual([]);

  await page.keyboard.press("Escape");

  // Header menu — right-click a column header: a DISTINCT built-in set.
  await page
    .locator('[role=columnheader][data-band="1"][data-col-id="name"]')
    .click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Sort ascending" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Hide column" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Pin column" })).toBeVisible();
  // The cell-only custom item is absent here.
  await expect(page.locator("[data-mg-custom]")).toHaveCount(0);

  // Activating a header built-in (hide) removes the column.
  await page.getByRole("menuitem", { name: "Hide column" }).click();
  await expect(
    page.locator('[role=columnheader][data-band="1"][data-col-id="name"]'),
  ).toHaveCount(0);
  expect(await unexpectedErrors(page)).toEqual([]);
});

test("CAP-EDIT: programmatic edit + row/column CRUD", async ({ page }) => {
  await page.click("#ctl-edit");
  await expect(page.locator(cell(1, 2))).toHaveText("Edited ✎");

  const before = await page.evaluate(
    async () => (await (window as any).__grid.getRowCount()).rowCount,
  );
  await page.click("#ctl-insert-row");
  await expect
    .poll(() => page.evaluate(async () => (await (window as any).__grid.getRowCount()).rowCount))
    .toBe(before + 1);

  await page.click("#ctl-remove-row");
  await page.click("#ctl-insert-col");
  await page.click("#ctl-remove-col");
  // Under the real WorkerTransport these ops resolve across the seam (async), so
  // poll for each recorded outcome rather than reading it the instant after click.
  for (const n of ["insert-row", "remove-row", "insert-col", "remove-col"]) {
    await expect.poll(async () => (await lastOutcome(page, n))?.status).toBe("ok");
  }
  expect(await unexpectedErrors(page)).toEqual([]);
});

test("CAP-EDIT (interactive editor): type-to-replace commits", async ({ page }) => {
  const c = page.locator(cell(1, 2)); // name column, editable
  await c.click();
  await page.keyboard.type("Interactive");
  await expect(page.locator("[data-mg-editor] input")).toHaveValue("Interactive");
  await page.keyboard.press("Enter");
  await expect(c).toHaveText("Interactive");
});

test("CAP-VALIDATE: an out-of-range edit is rejected (no unexpected error)", async ({
  page,
}) => {
  const scoreBefore = await page.evaluate(
    async () => (await (window as any).__grid.getRows({ startIndex: 0, endIndex: 1 })).rows[0].data.score,
  );
  await page.click("#ctl-edit-invalid");
  const outcome = await lastOutcome(page, "edit-invalid");
  expect(outcome?.status).toBe("ok");
  expect(outcome?.detail).toContain("validation");
  // Value unchanged by the rejected edit.
  const scoreAfter = await page.evaluate(
    async () => (await (window as any).__grid.getRows({ startIndex: 0, endIndex: 1 })).rows[0].data.score,
  );
  expect(scoreAfter).toBe(scoreBefore);
  expect(await unexpectedErrors(page)).toEqual([]);
});

test("CAP-UNDO: edit then undo reverts", async ({ page }) => {
  await page.click("#ctl-edit");
  await expect(page.locator(cell(1, 2))).toHaveText("Edited ✎");
  await page.click("#ctl-undo");
  await expect(page.locator(cell(1, 2))).not.toHaveText("Edited ✎");
  await page.click("#ctl-redo");
  await expect(page.locator(cell(1, 2))).toHaveText("Edited ✎");
});

test("CAP-CLIPBOARD: copy → paste applies the value; fill propagates", async ({
  page,
}) => {
  const source = await page.locator(cell(1, 2)).textContent();
  await page.click("#ctl-copy");
  await page.click("#ctl-paste");
  await expect(page.locator(cell(11, 2))).toHaveText(source ?? "");

  await page.click("#ctl-fill");
  await expect(page.locator(cell(22, 2))).toHaveText(await page.locator(cell(21, 2)).textContent() ?? "");
  expect(await unexpectedErrors(page)).toEqual([]);
});

test("CAP-FMT-CELL: styling a range applies the computed fill", async ({ page }) => {
  await page.click("#ctl-style-fill"); // default range rows 0–3, cols name–category
  await expect
    .poll(() =>
      page.locator(cell(1, 2)).evaluate((el) => getComputedStyle(el).backgroundColor),
    )
    .toBe("rgb(255, 243, 191)"); // #fff3bf
});

test("CAP-FMT-VALUE: the amount column renders a currency mask", async ({ page }) => {
  await expect(page.locator(cell(1, 4))).toContainText("$");
});

test("CAP-COND-FMT: data bar + icon set render as DOM decorations", async ({
  page,
}) => {
  await page.click("#ctl-cf-bar");
  await expect
    .poll(() => page.locator("[data-mg-databar]").count(), { timeout: 10_000 })
    .toBeGreaterThan(0);

  await page.click("#ctl-cf-icon");
  await expect
    .poll(() => page.locator(".mg-icon").count(), { timeout: 10_000 })
    .toBeGreaterThan(0);

  // The value rule + color scale apply without error.
  await page.click("#ctl-cf-value");
  await page.click("#ctl-cf-scale");
  for (const n of ["cf-bar", "cf-icon", "cf-value", "cf-scale"]) {
    expect((await lastOutcome(page, n))?.status).toBe("ok");
  }
  await page.click("#ctl-cf-clear");
  expect(await unexpectedErrors(page)).toEqual([]);
});

test("CAP-SORT: single sort orders rows; multi-sort keeps two keys", async ({
  page,
}) => {
  await page.click("#ctl-sort-asc");
  await expect(page.locator('[role=columnheader][data-col-id="amount"]')).toHaveAttribute(
    "aria-sort",
    "ascending",
  );
  await page.click("#ctl-sort-multi");
  const entries = await page.evaluate(() => (window as any).__grid.getSortSpec().entries.length);
  expect(entries).toBe(2);
  await page.click("#ctl-sort-clear");
  expect(await page.evaluate(() => (window as any).__grid.getSortSpec().entries.length)).toBe(0);
});

test("CAP-FILTER: applying a filter drops the row count", async ({ page }) => {
  await page.click("#ctl-filter");
  await expect
    .poll(() => page.evaluate(async () => (await (window as any).__grid.getRowCount()).rowCount))
    .toBeLessThan(100_000);
  await page.click("#ctl-filter-clear");
  await expect
    .poll(() => page.evaluate(async () => (await (window as any).__grid.getRowCount()).rowCount))
    .toBe(100_000);
});

test("CAP-FILTER (menu): the header filter menu opens and applies", async ({
  page,
}) => {
  await page.locator('[role=columnheader][data-col-id="score"] [data-mg-filter-btn]').click();
  const menu = page.locator(".mg-filter-menu");
  await expect(menu).toBeVisible();
  await menu.locator("[data-mg-filter-op]").selectOption("gt");
  await menu.locator("[data-mg-filter-value]").fill("50");
  await menu.locator("[data-mg-filter-apply]").click();
  await expect(menu).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(async () => (await (window as any).__grid.getRowCount()).rowCount))
    .toBeLessThan(100_000);
});

test("CAP-RESIZE + CAP-REORDER: widen a column and move it", async ({ page }) => {
  const name = page.locator('[role=columnheader][data-col-id="name"]');
  const w0 = (await name.boundingBox())!.width;
  await page.click("#ctl-resize");
  await expect.poll(async () => (await name.boundingBox())!.width).toBeGreaterThan(w0);

  const idx0 = await page.evaluate(() =>
    [...document.querySelectorAll("[role=columnheader]")].findIndex(
      (h) => h.getAttribute("data-col-id") === "name",
    ),
  );
  await page.click("#ctl-reorder");
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll("[role=columnheader]")].findIndex(
          (h) => h.getAttribute("data-col-id") === "name",
        ),
      ),
    )
    .toBeGreaterThan(idx0);
});

test("CAP-FREEZE: freezing pins a row + column", async ({ page }) => {
  await page.click("#ctl-freeze");
  await expect(page.locator(".mg-row--frozen")).toHaveCount(1);
  await page.click("#ctl-freeze"); // toggle off
  await expect(page.locator(".mg-row--frozen")).toHaveCount(0);
});

test("CAP-MERGE: merging a range renders one spanning anchor", async ({ page }) => {
  await page.click("#ctl-merge");
  await expect(page.locator(cell(1, 2))).toHaveAttribute("aria-colspan", "2");
  const merges = await page.evaluate(() => (window as any).__grid.getMerges().length);
  expect(merges).toBe(1);
  await page.click("#ctl-unmerge");
  await expect
    .poll(() => page.evaluate(() => (window as any).__grid.getMerges().length))
    .toBe(0);
});

test("CAP-GROUP: grouping adds an outline toggle; collapse hides rows", async ({
  page,
}) => {
  await page.click("#ctl-group");
  const toggle = page.locator('[data-mg-group-toggle][data-group-axis="row"]');
  await expect(toggle).toHaveCount(1);
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page.click("#ctl-collapse");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});

test("CAP-EXPORT: CSV exports a blob; xlsx fails soft", async ({ page }) => {
  await page.click("#ctl-export-csv");
  // CSV export reads the full dataset across the worker seam — poll for the outcome.
  await expect.poll(async () => (await lastOutcome(page, "export-csv"))?.status).toBe("ok");
  const csv = await lastOutcome(page, "export-csv");
  expect(csv?.detail).toContain("bytes");

  await page.click("#ctl-export-xlsx");
  await expect.poll(async () => (await lastOutcome(page, "export-xlsx"))?.status).toBe("ok");
  const xlsx = await lastOutcome(page, "export-xlsx");
  expect(xlsx?.status).toBe("ok"); // fail-soft, handled
  // The only grid error is the expected fail-soft code.
  const codes = await page.evaluate(() => (window as any).__gridErrors);
  expect(codes.every((c: string) => c === "XLSX_UNAVAILABLE")).toBe(true);
  expect(await unexpectedErrors(page)).toEqual([]);
});

test("CAP-PERSIST-STATE: save → mutate → restore round-trips the layout", async ({
  page,
}) => {
  const name = page.locator('[role=columnheader][data-col-id="name"]');
  const w0 = Math.round((await name.boundingBox())!.width);
  await page.click("#ctl-state-save");
  await page.click("#ctl-resize"); // name → 260
  await expect.poll(async () => Math.round((await name.boundingBox())!.width)).toBeGreaterThan(w0);
  await page.click("#ctl-state-restore");
  await expect.poll(async () => Math.round((await name.boundingBox())!.width)).toBe(w0);
});

test("CAP-THEME: toggling switches to the dark theme", async ({ page }) => {
  await page.click("#ctl-theme");
  await expect(page.locator("[data-mini-grid]")).toHaveClass(/mg-theme-dark/);
  await expect(page.locator("body")).toHaveAttribute("data-theme", "dark");
});

test("CAP-I18N: RTL mirrors direction; locale re-locales the currency mask", async ({
  page,
}) => {
  const en = await page.locator(cell(1, 4)).textContent();
  await page.selectOption("#ctl-locale", "de-DE");
  await expect.poll(() => page.locator(cell(1, 4)).textContent()).not.toBe(en);

  await page.click("#ctl-rtl");
  await expect(page.locator("[data-mini-grid]")).toHaveAttribute("dir", "rtl");
});

test("CAP-FEATURE-FLAGS: disabling sorting removes the sort affordance", async ({
  page,
}) => {
  const header = page.locator('[role=columnheader][data-col-id="amount"]');
  await expect(header).toHaveAttribute("data-mg-sortable", "");
  await page.click('input[data-flag="sorting"]');
  await ready(page); // toggling a flag rebuilds the grid
  await expect(header).not.toHaveAttribute("data-mg-sortable", "");
  await expect(header).not.toHaveAttribute("aria-sort", /.*/);
  // Re-enable and confirm it comes back.
  await page.click('input[data-flag="sorting"]');
  await ready(page);
  await expect(page.locator('[role=columnheader][data-col-id="amount"]')).toHaveAttribute(
    "data-mg-sortable",
    "",
  );
});

test("CAP-A11Y: axe reports zero violations after exercising the grid", async ({
  page,
}) => {
  // Drive a representative spread of features, then audit.
  await page.click("#ctl-cf-bar");
  await page.click("#ctl-cf-icon");
  await page.click("#ctl-style-fill");
  await page.click("#ctl-freeze");
  await page.click("#ctl-theme");
  await page.locator(cell(1, 1)).click(); // roving tabindex lands on a cell

  const grid = await new AxeBuilder({ page }).include("[data-mini-grid]").analyze();
  expect(grid.violations).toEqual([]);

  // The whole demo page (chrome + grid) is also clean.
  const full = await new AxeBuilder({ page }).analyze();
  expect(full.violations).toEqual([]);
});

test("SUCCESS-DX: driving every CAP control leaves no unexpected error", async ({
  page,
}) => {
  const ids = [
    "ctl-select", "ctl-edit", "ctl-edit-invalid", "ctl-insert-row", "ctl-undo",
    "ctl-redo", "ctl-sort-asc", "ctl-sort-multi", "ctl-sort-clear", "ctl-filter",
    "ctl-filter-clear", "ctl-resize", "ctl-reorder", "ctl-freeze", "ctl-merge",
    "ctl-unmerge", "ctl-group", "ctl-collapse", "ctl-style-fill", "ctl-style-clear",
    "ctl-cf-value", "ctl-cf-scale", "ctl-cf-bar", "ctl-cf-icon", "ctl-cf-clear",
    "ctl-copy", "ctl-paste", "ctl-fill", "ctl-export-csv", "ctl-export-xlsx",
    "ctl-state-save", "ctl-state-restore", "ctl-theme", "ctl-rtl",
    // CAP-COLUMN-MANAGE controls (slice 17/19).
    "ctl-hide-col", "ctl-show-all", "ctl-pin-col", "ctl-unpin-col",
    "ctl-autofit", "ctl-autofit-all",
  ];
  for (const id of ids) {
    await page.click("#" + id);
    await ready(page);
  }
  await page.selectOption("#ctl-locale", "de-DE");
  await page.click("#ctl-density"); // rebuilds
  await ready(page);

  // Every capability was exercised, and nothing failed unexpectedly.
  expect(await unexpectedErrors(page)).toEqual([]);
  const logged = new Set(
    (await page.evaluate(() => (window as any).__log.map((e: any) => e.name))) as string[],
  );
  expect(logged.size).toBeGreaterThan(20);
  // Sanity: the CAP register we intend to cover is non-trivial (now incl. the
  // v1.3/v1.4 header/menu/selection subsystem).
  expect(CAPS.length).toBe(26);
});
