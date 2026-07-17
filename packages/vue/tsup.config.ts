import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  // Adapters ship ESM + d.ts only.
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: "es2022",
  // The core is a peer/dep of the adapter — do not inline it into the bundle.
  external: ["@mini-grid/core"],
});
