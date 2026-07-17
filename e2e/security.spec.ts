/**
 * Security runtime battery (Slice 11b) — the **page-governed** `SEC-*` active
 * controls proven on the real demo surface in Chromium (never harness `eval`):
 *
 *  - `AC-XSS` (`SEC-ESCAPE-DEFAULT`) — a `<script>` / `<img onerror>` cell VALUE is
 *    rendered as literal text (`textContent`); nothing executes in the page and no
 *    HTML element is materialized inside the cell.
 *  - `AC-PASTE` (`SEC-PASTE-UNTRUSTED`) — pasting HTML-bearing clipboard content
 *    inserts only its plain-text projection; no HTML element is created, nothing runs.
 *  - `AC-EXPORT-GUARD` (`SEC-EXPORT-FORMULA-GUARD`) — a `=HYPERLINK(...)` value is
 *    neutralized (prefixed `'`) on CSV export by default; `sanitizeFormulas:false`
 *    exports it verbatim.
 *
 * The static half of the Security battery (`AC-STATIC-SCAN` — no egress/persist/eval)
 * lives in `packages/core/src/security.static.test.ts`.
 */
import { test, expect } from "@playwright/test";

/* eslint-disable @typescript-eslint/no-explicit-any */

// The paste case reads the system clipboard (text/plain is the only flavor read).
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test.beforeEach(async ({ page }) => {
  await page.goto("/demo/index.html");
  await page.waitForFunction(() => (window as any).__ready === true, null, {
    timeout: 60_000,
  });
  await page.waitForSelector("[role=gridcell]", { state: "attached" });
});

const cellSel = (row: number, col: number) =>
  `[role=gridcell][aria-rowindex="${row}"][aria-colindex="${col}"]`;

test("AC-XSS (SEC-ESCAPE-DEFAULT): a script/img cell value renders as text and never executes", async ({
  page,
}) => {
  // Write a script- and an onerror-bearing value into two editable text cells.
  await page.evaluate(async () => {
    const g = (window as any).__grid;
    await g.updateCell(0, "c1", '<img src=x onerror="window.__pwned=true">');
    await g.updateCell(1, "c1", '<script>window.__pwned2=true</' + "script>");
  });

  // The values are shown as LITERAL TEXT (through textContent).
  await expect(page.locator(cellSel(1, 2))).toContainText("<img");
  await expect(page.locator(cellSel(2, 2))).toContainText("<script>");

  // Nothing executed in the page…
  expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();
  expect(await page.evaluate(() => (window as any).__pwned2)).toBeUndefined();

  // …and no <img>/<script> element was materialized inside the grid (text only).
  const injected = await page.evaluate(
    () => document.querySelectorAll("[data-mini-grid] img, [data-mini-grid] script").length,
  );
  expect(injected).toBe(0);
});

test("AC-PASTE (SEC-PASTE-UNTRUSTED): pasting HTML inserts plain text only; nothing executes", async ({
  page,
}) => {
  // Seed the clipboard with HTML-bearing markup (as plain text — the only flavor the
  // grid ever reads). Anchor an editable text cell and paste.
  const payload = '<b>x</b><img src=x onerror="window.__pastePwned=true">';
  await page.evaluate(async (text) => {
    await navigator.clipboard.writeText(text);
    (window as any).__grid.setSelection({
      ranges: [{ top: 0, bottom: 0, left: 1, right: 1 }],
      anchor: { row: 0, col: 1 },
      activeCell: null,
    });
  }, payload);

  await page.evaluate(() => (window as any).__grid.paste());

  const cell = page.locator(cellSel(1, 2));
  // The literal markup is present as TEXT…
  await expect(cell).toContainText("<img");
  // …no HTML element materialized from the paste (the only element a cell may carry
  // is the grid's own fill handle), and nothing executed.
  const injected = await page.evaluate(
    () => document.querySelectorAll("[data-mini-grid] img, [data-mini-grid] b, [data-mini-grid] script").length,
  );
  expect(injected).toBe(0);
  expect(await page.evaluate(() => (window as any).__pastePwned)).toBeUndefined();
});

test("AC-EXPORT-GUARD (SEC-EXPORT-FORMULA-GUARD): =HYPERLINK is neutralized by default; opt-out exports verbatim", async ({
  page,
}) => {
  await page.evaluate(async () => {
    await (window as any).__grid.setData([
      { id: 1, c1: '=HYPERLINK("http://evil","click")', c2: "r-a", c3: 10 },
      { id: 2, c1: "safe", c2: "r-b", c3: 20 },
    ]);
  });

  // Default: the formula-leading value is prefixed with a single quote (inert text).
  const guarded = await page.evaluate(async () =>
    (await (window as any).__grid.exportCsv()).text(),
  );
  expect(guarded).toContain("'=HYPERLINK");
  expect(guarded).toContain("safe");

  // Opt-out: exported verbatim (developer-owned known-safe intent).
  const raw = await page.evaluate(async () =>
    (await (window as any).__grid.exportCsv({ sanitizeFormulas: false })).text(),
  );
  expect(raw).toContain("=HYPERLINK");
  expect(raw).not.toContain("'=HYPERLINK");
});
