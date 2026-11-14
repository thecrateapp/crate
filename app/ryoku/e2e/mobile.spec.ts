import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 375, height: 812 } });

test("fits a 375 px phone with no horizontal scroll", async ({ page }) => {
  await page.goto("/");
  for (const id of ["hero", "surfaces", "install"]) {
    await page.locator(`#${id}`).scrollIntoViewIfNeeded();
  }
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(375);
});
