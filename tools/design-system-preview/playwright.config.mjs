import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "preview.spec.ts",
  outputDir: "../../.artifacts/design-system-preview",
  reporter: "line",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5186",
    channel: process.env.PLAYWRIGHT_CHANNEL,
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: "npm run design-system:preview",
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    url: "http://127.0.0.1:5186",
    reuseExistingServer: !process.env.CI,
  },
});
