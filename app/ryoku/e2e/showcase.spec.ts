import { expect, test } from "@playwright/test";

// The hero shows screenshots in the Crate site's showcase until a fluid
// screencast exists: same component, same controls, Ryoku's own shots.
test("the hero shows its screenshots in a showcase, not a video", async ({
  page,
}) => {
  await page.goto("/");
  const showcase = page.locator("#hero [data-showcase]");
  await expect(showcase).toHaveCount(1);
  await expect(showcase.locator("video")).toHaveCount(0);
  await expect(showcase.locator("[data-slide]")).toHaveCount(16);
  await expect(showcase.locator("[data-counter]")).toHaveText("01 / 16");
  await expect(showcase.locator("[data-card-title]")).toHaveText(
    "The Crate desktop",
  );
});

test("the showcase steps through the shots", async ({ page }) => {
  await page.goto("/");
  const showcase = page.locator("#hero [data-showcase]");
  await showcase.locator("[data-next]").click();
  await expect(showcase.locator("[data-counter]")).toHaveText("02 / 16");
  await expect(showcase.locator("[data-card-title]")).toHaveText(
    "QS Bar and crate-mark",
  );
  await showcase.locator("[data-prev]").click();
  await showcase.locator("[data-prev]").click();
  await expect(showcase.locator("[data-counter]")).toHaveText("16 / 16");
});

test("every shot is served from the media mount", async ({ page }) => {
  await page.goto("/");
  const first = page.locator("#hero [data-slide] img").first();
  await expect(first).toHaveAttribute(
    "srcset",
    /\/media\/shots\/desktop-1280\.webp\?v=[\d.-]+ 1280w/,
  );
});

test("a blurred desktop loop plays behind the hero copy", async ({ page }) => {
  await page.goto("/");
  const video = page.locator("#hero [data-backdrop] video");
  await expect(video).toHaveCount(1);
  await expect(page.locator("#hero [data-backdrop]")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await expect(video).toHaveJSProperty("muted", true);
  await expect(video).toHaveJSProperty("loop", true);
  await expect(video).toHaveAttribute("poster", /\/media\/backdrop\//);
  await expect(video.locator("source")).toHaveCount(2);
  // The copy stays above the loop.
  await expect(
    page.getByRole("link", { name: "Install Crate for Ryoku" }),
  ).toBeVisible();
});

test("reduced motion keeps the backdrop on its poster", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/");
  const video = page.locator("#hero [data-backdrop] video");
  await page.waitForTimeout(500);
  await expect(video).toHaveJSProperty("paused", true);
  await context.close();
});

test("the backdrop stays put while the page scrolls over it", async ({
  page,
}) => {
  await page.goto("/");
  const backdrop = page.locator("[data-backdrop]");
  await page.locator("#install").scrollIntoViewIfNeeded();
  const box = await backdrop.boundingBox();
  expect(box?.y).toBe(0);
  expect(box?.height).toBe(page.viewportSize()?.height);
});
