import { expect, test } from "@playwright/test";

// The hero shows screenshots in the Crate site's showcase until a fluid
// screencast exists: same component, same controls, Ryoku's own shots.
test("the hero is a screenshot showcase, not a video", async ({ page }) => {
  await page.goto("/");
  const showcase = page.locator("#hero [data-showcase]");
  await expect(showcase).toHaveCount(1);
  await expect(page.locator("#hero video")).toHaveCount(0);
  await expect(showcase.locator("[data-slide]")).toHaveCount(9);
  await expect(showcase.locator("[data-counter]")).toHaveText("01 / 09");
  await expect(showcase.locator("[data-card-title]")).toHaveText(
    "The Crate desktop",
  );
});

test("the showcase steps through the shots", async ({ page }) => {
  await page.goto("/");
  const showcase = page.locator("#hero [data-showcase]");
  await showcase.locator("[data-next]").click();
  await expect(showcase.locator("[data-counter]")).toHaveText("02 / 09");
  await expect(showcase.locator("[data-card-title]")).toHaveText(
    "QS Bar and crate-mark",
  );
  await showcase.locator("[data-prev]").click();
  await showcase.locator("[data-prev]").click();
  await expect(showcase.locator("[data-counter]")).toHaveText("09 / 09");
});

test("every shot is served from the media mount", async ({ page }) => {
  await page.goto("/");
  const first = page.locator("#hero [data-slide] img").first();
  await expect(first).toHaveAttribute(
    "srcset",
    /\/media\/shots\/desktop-1280\.webp\?v=[\d-]+ 1280w/,
  );
});
