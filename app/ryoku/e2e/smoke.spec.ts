import { expect, test } from "@playwright/test";

const SECTIONS = [
  "hero",
  "tour",
  "crate-ui",
  "what-is-crate",
  "install",
  "footer",
];

test("the page loads with every section", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  for (const id of SECTIONS) {
    await expect(page.locator(`#${id}`)).toHaveCount(1);
  }
});

test("Crate web tokens resolve on :root", async ({ page }) => {
  await page.goto("/");
  const cyan = await page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--cyan")
      .trim(),
  );
  expect(cyan).toBe("#06b6d4");
});

test("the Crate web display font is served", async ({ request }) => {
  const response = await request.get(
    "/fonts/bricolage-grotesque-latin-opsz-normal.woff2",
  );
  expect(response.status()).toBe(200);
});

test("canonical metadata points at ryoku.cratemusic.app", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
    "content",
    /^https:\/\/ryoku\.cratemusic\.app\/?$/,
  );
});
