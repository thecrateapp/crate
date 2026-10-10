import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/admin-e2e",
  outputDir: "./test-results/admin-e2e",
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report/admin-e2e", open: "never" }],
  ],
  timeout: 45_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://127.0.0.1:4175",
    browserName: "chromium",
    colorScheme: "dark",
    locale: "en-US",
    serviceWorkers: "block",
    timezoneId: "UTC",
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command:
      "npm run --workspace=app/ui build && npm run --workspace=app/ui preview -- --host 127.0.0.1 --port 4175 --strictPort",
    url: "http://127.0.0.1:4175",
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
