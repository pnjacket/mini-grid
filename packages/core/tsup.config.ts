import { defineConfig } from "tsup";

export default defineConfig([
  // Main library bundle: ESM (bundlers/Node) + IIFE (UMD-style global for <script>).
  {
    entry: { index: "src/index.ts" },
    // Use a non-composite tsconfig for the .d.ts rollup; the composite
    // tsconfig.json is reserved for `tsc -b` (typecheck / project references).
    tsconfig: "tsconfig.build.json",
    format: ["esm", "iife"],
    globalName: "MiniGrid",
    // DEP-XLSX is lazy-loaded via a runtime dynamic import; keep exceljs out of the
    // bundle so core stays zero-required-runtime-deps (only xlsx users install it).
    external: ["exceljs"],
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    target: "es2022",
    outExtension({ format }) {
      // ESM -> .js (package is "type": "module"); IIFE -> .global.js
      return { js: format === "iife" ? ".global.js" : ".js" };
    },
  },
  // `ADR-WORKER-OPS` / `ADR-SORT-FILTER-SEAM` — the data engine's MODULE WORKER,
  // emitted as its own `dist/worker.js` chunk. The ESM build loads it as a
  // real off-thread worker via `new Worker(new URL('./worker.js', import.meta.url),
  // { type: 'module' })`; built-in sort/filter run here off the main thread.
  {
    entry: { worker: "src/worker/worker.ts" },
    tsconfig: "tsconfig.build.json",
    format: ["esm"],
    // Do NOT `clean` — this second build would otherwise wipe the main bundle.
    clean: false,
    dts: false,
    sourcemap: true,
    treeshake: true,
    target: "es2022",
  },
]);
