import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { chromium } from "@playwright/test";

const url = process.env.SCREENCAST_URL;
if (!url) {
  console.error("Set SCREENCAST_URL to the Listen instance to record.");
  process.exit(1);
}
const statePath = ".auth/state.json";

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
await page.goto(url);

const prompt = createInterface({
  input: process.stdin,
  output: process.stdout,
});
await prompt.question(
  `Sign in to ${url} in the browser window, then press Enter here. `,
);
prompt.close();

await mkdir(".auth", { recursive: true });
await context.storageState({ path: statePath });
console.log(`Saved the session to ${statePath}`);
await browser.close();
