import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 375, height: 812 } });

test("fits a 375 px phone with no horizontal scroll", async ({ page }) => {
  await page.goto("/");
  for (const id of [
    "hero",
    "tour",
    "crate-ui",
    "what-is-crate",
    "install",
    "footer",
  ]) {
    await page.locator(`#${id}`).scrollIntoViewIfNeeded();
  }
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(375);
});

test("every install command keeps its copy button on screen", async ({
  page,
}) => {
  await page.goto("/");
  const buttons = page.locator("#install .copy");
  await expect(buttons).toHaveCount(3);
  for (const button of await buttons.all()) {
    await button.scrollIntoViewIfNeeded();
    const box = await button.boundingBox();
    expect(box && box.x + box.width).toBeLessThanOrEqual(375);
  }
});
