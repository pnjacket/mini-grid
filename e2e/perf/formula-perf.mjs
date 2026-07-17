/**
 * `PERF-RECALC-FULL` / `PERF-RECALC-INCR` harness (browser side). Serves the repo
 * root statically, loads demo/formula-stress.html (300,000 chained formula cells,
 * `features: { formula: true }`) headless in Chromium, and reports:
 *
 *   - setData (load scan + first full recalc), a clean full recalc (PERF-RECALC-FULL),
 *   - a HEAD edit that cascades the whole deep chain (incremental worst case),
 *   - a LEAF edit that touches a tiny subgraph (PERF-RECALC-INCR win).
 *
 * Run (after `pnpm -r build`):
 *   node e2e/perf/formula-perf.mjs                              # 300k arithmetic cells
 *   node e2e/perf/formula-perf.mjs 50000 formula-worst.html     # 300k COUNTIF (worst case)
 *   node e2e/perf/formula-perf.mjs 100000                       # override row count
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ROWS = Number(process.argv[2] || 50_000);
const PAGE = process.argv[3] || 'formula-stress.html';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
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

const { server, port } = await startServer(REPO_ROOT);
const base = `http://127.0.0.1:${port}`;
console.log(`serving ${REPO_ROOT} at ${base}/demo/${PAGE}?rows=${ROWS}`);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${base}/demo/${PAGE}?rows=${ROWS}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, { timeout: 240_000 });

  // Trigger the head + leaf edits and wait for their timings to land.
  await page.click('#editHead');
  await page.waitForFunction(() => window.__formulaPerf.headEditMs != null, { timeout: 120_000 });
  await page.click('#editLeaf');
  await page.waitForFunction(() => window.__formulaPerf.leafEditMs != null, { timeout: 60_000 });

  const perf = await page.evaluate(() => window.__formulaPerf);
  const label = perf.fn ? `${perf.fn}${perf.heavy ? ' ×2/cell' : ''} (window ${perf.window})` : 'arithmetic chain';

  console.log('\n================ PERF-RECALC RESULTS ================');
  console.log(`  page: ${PAGE}   formula: ${label}`);
  console.log(`  rows: ${perf.rows.toLocaleString()}  formula cells: ${perf.formulaCells.toLocaleString()}`);
  console.log(`  row generation:                 ${perf.genMs.toFixed(1)} ms`);
  console.log(`  setData (scan + first recalc):  ${perf.loadMs.toFixed(1)} ms`);
  console.log(`  full recalc (clean):            ${perf.fullRecalcMs.toFixed(1)} ms`);
  console.log(`  head edit (cascade):            ${perf.headEditMs.toFixed(1)} ms`);
  console.log(`  leaf edit (tiny subgraph):      ${perf.leafEditMs.toFixed(2)} ms`);
  console.log('====================================================');
} finally {
  await browser.close();
  server.close();
}
