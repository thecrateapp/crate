import { defineConfig } from "@playwright/test";
import process from "node:process";
import { URL } from "node:url";
import { fileURLToPath } from "node:url";
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  workers: 1,
  reporter: "line",
  outputDir: "../../.artifacts/crate-ui-showcase",
  use: {
    baseURL: "http://127.0.0.1:6006",
    viewport: { width: 1200, height: 900 },
  },
  webServer: {
    command: "npm run design-system:storybook",
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    url: "http://127.0.0.1:6006",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
