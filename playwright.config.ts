import { defineConfig, devices } from "@playwright/test";

/**
 * E2E + accessibility (via @axe-core/playwright) test configuration.
 * Specs live under `e2e/` (`*.spec.ts`). The `webServer` serves the repo root
 * statically so `demo/index.html` (the 1M-row grid) loads its built ESM from
 * `packages/core/dist/` — no bundler. Run `pnpm -r build` first.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "html" : "list",
  webServer: {
    command: "python3 -m http.server 5173 --bind 127.0.0.1",
    url: "http://127.0.0.1:5173/demo/index.html",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
