import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/listen-visual",
  outputDir: "./test-results/listen-visual",
  reporter: [
    ["list"],
    [
      "html",
      { outputFolder: "playwright-report/listen-visual", open: "never" },
    ],
  ],
  snapshotPathTemplate:
    "{testDir}/{testFilePath}-snapshots/{arg}-{projectName}-{platform}{ext}",
  timeout: 45_000,
  expect: {
    timeout: 15_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixels: 250,
    },
  },
  use: {
    baseURL: "http://127.0.0.1:4174",
    colorScheme: "dark",
    deviceScaleFactor: 1,
    locale: "en-US",
    serviceWorkers: "block",
    timezoneId: "UTC",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: {
        browserName: "chromium",
        viewport: { width: 1480, height: 900 },
      },
    },
    {
      name: "mobile",
      use: {
        browserName: "chromium",
        hasTouch: true,
        isMobile: true,
        viewport: { width: 375, height: 812 },
      },
    },
  ],
  webServer: {
    command:
      "npm run --workspace=app/listen dev -- --host 127.0.0.1 --port 4174 --strictPort",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
