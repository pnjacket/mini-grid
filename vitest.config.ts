import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit tests run in Node by default.
    include: ["packages/*/src/**/*.{test,spec}.ts"],
    environment: "node",
    // Browser mode is stubbed here (disabled by default). Enable per-run with
    // `--browser.enabled` once real DOM-dependent unit tests exist. Requires
    // `@vitest/browser` + a provider (playwright) which are dev deps.
    browser: {
      enabled: false,
      provider: "playwright",
      headless: true,
      instances: [{ browser: "chromium" }],
    },
  },
});
