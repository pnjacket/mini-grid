/**
 * `SEQ-PASTE` -> `PERF-PASTE` calibration harness (browser side) for mini-grid.
 *
 * Loads demo/index.html (1,000,000-row grid, perf:true) headless in Chromium,
 * seeds the system clipboard with a ~10k-cell TSV block, selects an anchor cell,
 * and measures `grid.paste()` wall time — the full SEQ-PASTE path: clipboard read
 * -> TSV parse (SEC-PASTE-UNTRUSTED) -> per-cell validation -> one MSG-PASTE-APPLY
 * worker round-trip -> repaint. Reported = median of N runs.
 *
 * The demo has 12 columns; editable text columns from the anchor (c1) rightward
 * are c1,c2,c4,c5,c7,c8,c10,c11 = 8 writable per row. A 1250-row x 11-col block
 * therefore applies ~10,000 cells (non-editable/number columns are skipped).
 * (c2 carries a `^r` regex rule, so every seeded value starts with `r`.)
 *
 * Run (after `pnpm -r build`):
 *   node e2e/perf/paste-perf.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function startServer(root) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    let filePath = path.join(root, urlPath);
    if (urlPath.endsWith('/')) filePath = path.join(filePath, 'index.html');
    if (!filePath.startsWith(root)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404).end('not found: ' + urlPath);
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const ROWS = 1250; // 1250 rows x 11 cols, ~8 editable/row => ~10,000 applied cells
const COLS = 11; // c1..c11 from the anchor (col index 1) rightward

async function runPaste(page, anchorRow) {
  return page.evaluate(
    async ({ rows, cols, anchorRow }) => {
      const grid = window.__grid;
      // Build a ~10k-cell TSV; every value starts with 'r' so c2's ^r rule passes.
      const line = Array.from({ length: cols }, (_, j) => `rp${j}`).join('\t');
      const tsv = Array.from({ length: rows }, () => line).join('\n');
      await navigator.clipboard.writeText(tsv);

      // Anchor at (anchorRow, col index 1 = c1).
      grid.setSelection({
        ranges: [{ top: anchorRow, bottom: anchorRow, left: 1, right: 1 }],
        anchor: { row: anchorRow, col: 1 },
        activeCell: null,
      });

      const t0 = performance.now();
      const { targetRange } = await grid.paste();
      const dt = performance.now() - t0;
      const blockCells =
        (targetRange.bottom - targetRange.top + 1) * (targetRange.right - targetRange.left + 1);
      return { dt, blockCells, targetRange };
    },
    { rows: ROWS, cols: COLS, anchorRow },
  );
}

async function main() {
  const { server, port } = await startServer(REPO_ROOT);
  const url = `http://127.0.0.1:${port}/demo/index.html`;
  console.log('serving', REPO_ROOT, 'at', url);

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
    await page.waitForSelector('[role=gridcell]', { state: 'attached' });

    const runs = [];
    // 5 runs, each pasting into a fresh anchor row so no cell overlaps.
    for (let i = 0; i < 5; i++) {
      const r = await runPaste(page, i * (ROWS + 1));
      runs.push(r.dt);
      console.log(
        `  paste run ${i + 1}: ${r.dt.toFixed(1)} ms  block=${r.blockCells} cells ` +
          `(rows ${r.targetRange.top}..${r.targetRange.bottom}, ~${Math.round(r.blockCells * (8 / COLS))} applied)`,
      );
    }
    await context.close();

    console.log('\n================ SEQ-PASTE RESULT ================');
    console.log(`  block: ${ROWS} rows x ${COLS} cols = ${ROWS * COLS} cells; ~${ROWS * 8} applied (editable)`);
    console.log(`  per-run (ms): [${runs.map((v) => v.toFixed(1)).join(', ')}]`);
    console.log(`  MEDIAN grid.paste(): ${median(runs).toFixed(1)} ms  (PERF-PASTE target ≤ 300ms)`);
    console.log('==================================================');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => {
  console.error('paste perf harness failed:', e);
  process.exit(1);
});
