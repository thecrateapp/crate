import { expect, test } from "@playwright/test";

test.use({ reducedMotion: "reduce" });

test("nothing autoplays and revealed content is visible at once", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("video[autoplay]")).toHaveCount(0);
  const playing = await page
    .locator("video")
    .evaluateAll(
      (videos) =>
        videos.filter((video) => !(video as HTMLVideoElement).paused).length,
    );
  expect(playing).toBe(0);
  for (const element of await page.locator("[data-reveal]").all()) {
    await element.scrollIntoViewIfNeeded();
    await expect(element).toHaveCSS("opacity", "1");
    await expect(element).toHaveCSS("transform", "none");
  }
});
