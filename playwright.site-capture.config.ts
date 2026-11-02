import { defineConfig } from "@playwright/test";

import admin from "./playwright.admin.config";

export default defineConfig({
  ...admin,
  testDir: "./tests/site-capture",
  outputDir: "./test-results/site-capture-runs",
  globalSetup: undefined,
  reporter: [["list"]],
  workers: 1,
});
