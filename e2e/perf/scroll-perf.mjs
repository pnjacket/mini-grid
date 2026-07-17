/**
 * Slice-0 perf-calibration harness (browser side) for mini-grid.
 *
 * Serves the repo root statically, loads demo/index.html (1,000,000-row grid,
 * perf:true) headless in Chromium and measures the on-page PERF-* targets:
 *
 *   - SEQ-MOUNT  -> PERF-MOUNT : navigation -> first gridcell painted, plus the
 *                  grid's own `mg:mount` measure and the demo gen/load split.
 *   - SEQ-SCROLL -> PERF-SCROLL: 5 fresh page contexts, each runs one scripted
 *                  scroll collecting rAF inter-frame deltas; per-run p95 over the
 *                  whole window; reported = median of the 5 p95 values. Long
 *                  (>33ms) frame count reported too.
 *   - SEQ-SCROLL -> PERF-NODES : max live `[role=gridcell]` DOM nodes sampled
 *                  during scroll (must stay ~viewport+overscan, not grow to 1M).
 *
 * Run (after `pnpm -r build`):
 *   node e2e/perf/scroll-perf.mjs
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
    // Prevent path escape.
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
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

function quantile(sorted, q) {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}
const median = (arr) => quantile([...arr].sort((a, b) => a - b), 0.5);

/** One SEQ-SCROLL run in a fresh page. Returns { p95, longFrames, maxNodes, maxVisible, frameCount }. */
async function runScroll(browser, url) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  await page.waitForSelector('[role=gridcell]', { state: 'attached' });
  const stepPx = Number(process.env.STEP ?? 240);
  await page.evaluate((s) => { window.__STEP = s; }, stepPx);

  const result = await page.evaluate(async () => {
    const scroller = window.__scroller();
    const frames = [];
    let maxNodes = 0;
    let maxVisible = 0;
    const sample = () => {
      const cells = document.querySelectorAll('[role=gridcell]');
      if (cells.length > maxNodes) maxNodes = cells.length;
      let vis = 0;
      for (const c of cells) if (c.style.display !== 'none') vis++;
      if (vis > maxVisible) maxVisible = vis;
    };

    // rAF inter-frame delta collector.
    let last = -1;
    let collecting = true;
    function collect(t) {
      if (last >= 0) frames.push(t - last);
      last = t;
      sample();
      if (collecting) requestAnimationFrame(collect);
    }
    requestAnimationFrame(collect);

    // Scripted scroll: step a fixed distance in page increments across frames.
    const STEP = Number(window.__STEP ?? 240); // px per frame (fast fling)
    const DISTANCE = 30000; // fixed scroll distance (px)
    const startTop = scroller.scrollTop;
    await new Promise((resolve) => {
      function stepOnce() {
        scroller.scrollTop += STEP;
        if (scroller.scrollTop - startTop < DISTANCE) {
          requestAnimationFrame(stepOnce);
        } else {
          // let a few trailing frames settle
          setTimeout(resolve, 250);
        }
      }
      requestAnimationFrame(stepOnce);
    });
    collecting = false;

    // Drop the first delta (warm-up from rAF start).
    const deltas = frames.slice(1);
    return { deltas, maxNodes, maxVisible };
  });

  await context.close();

  const deltas = result.deltas;
  const sorted = [...deltas].sort((a, b) => a - b);
  const p95 = quantile(sorted, 0.95);
  const p50 = quantile(sorted, 0.5);
  const longFrames = deltas.filter((d) => d > 33).length;
  return {
    p95,
    p50,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    longFrames,
    maxNodes: result.maxNodes,
    maxVisible: result.maxVisible,
    frameCount: deltas.length,
    deltas,
  };
}

async function measureMount(browser, url) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[role=gridcell]', { state: 'attached', timeout: 60000 });
  const wallToFirstCell = Date.now() - t0;
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  const perf = await page.evaluate(() => window.__perf);
  await context.close();
  return { wallToFirstCell, perf };
}

async function main() {
  const { server, port } = await startServer(REPO_ROOT);
  const url = `http://127.0.0.1:${port}/demo/index.html`;
  console.log('serving', REPO_ROOT, 'at', url);

  const browser = await chromium.launch({ headless: true });
  try {
    // --- SEQ-MOUNT (2 samples, report median wall + on-page marks) ---
    const mounts = [];
    for (let i = 0; i < 2; i++) mounts.push(await measureMount(browser, url));
    const mountWall = median(mounts.map((m) => m.wallToFirstCell));
    const mgMountMark = mounts[0].perf?.marks?.find((m) => m.name === 'mg:mount');
    const genMs = median(mounts.map((m) => m.perf?.genMs ?? NaN));
    const loadMs = median(mounts.map((m) => m.perf?.loadMs ?? NaN));

    // --- SEQ-SCROLL x5 fresh contexts ---
    const runs = [];
    for (let i = 0; i < 5; i++) {
      const r = await runScroll(browser, url);
      runs.push(r);
      console.log(
        `  scroll run ${i + 1}: p50=${r.p50.toFixed(2)} p95=${r.p95.toFixed(2)}ms  min/max=${r.min.toFixed(1)}/${r.max.toFixed(1)}` +
          `  long(>33ms)=${r.longFrames}  frames=${r.frameCount}  maxNodes=${r.maxNodes}`,
      );
    }
    const p95s = runs.map((r) => r.p95);
    const medianP95 = median(p95s);
    const longFramesMedian = median(runs.map((r) => r.longFrames));
    const maxNodes = Math.max(...runs.map((r) => r.maxNodes));
    const maxVisible = Math.max(...runs.map((r) => r.maxVisible));

    console.log('\n================ BROWSER PERF RESULTS ================');
    console.log('PERF-MOUNT:');
    console.log(`  wall nav->first gridcell (median of 2): ${mountWall.toFixed(0)} ms`);
    console.log(`  mg:mount measure (empty-grid construct): ${mgMountMark ? mgMountMark.duration.toFixed(2) + ' ms' : 'n/a'}`);
    console.log(`  demo split: rowgen=${genMs.toFixed(0)}ms  setData(load+firstpaint)=${loadMs.toFixed(0)}ms`);
    console.log('PERF-SCROLL:');
    console.log(`  per-run p95 (ms): [${p95s.map((v) => v.toFixed(2)).join(', ')}]`);
    console.log(`  MEDIAN of 5 p95: ${medianP95.toFixed(2)} ms`);
    console.log(`  long-frame(>33ms) counts per run: [${runs.map((r) => r.longFrames).join(', ')}]  median=${longFramesMedian}`);
    console.log('PERF-NODES:');
    console.log(`  max live [role=gridcell] DOM nodes during scroll: ${maxNodes}`);
    console.log(`  max visible (display!=none) cells: ${maxVisible}`);
    console.log('=====================================================');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => {
  console.error('perf harness failed:', e);
  process.exit(1);
});
