import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { APPS, isApp } from "./apps";

const [app] = process.argv.slice(2);
if (!isApp(app)) {
  console.error(`Usage: tsx film/login.ts <${Object.keys(APPS).join("|")}>`);
  process.exit(1);
}
const { url, state } = APPS[app];

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
const signedIn = page.waitForResponse(
  (response) =>
    new URL(response.url()).pathname === "/api/auth/me" && response.ok(),
  { timeout: 10 * 60_000 },
);
await page.goto(url);
console.log(`Sign in to ${url} in the browser window.`);
await signedIn;
await page.waitForLoadState("networkidle").catch(() => undefined);

await mkdir(".auth", { recursive: true });
await context.storageState({ path: state });
console.log(`Saved the ${app} session to ${state}`);
await browser.close();
