import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`blog utility links share the navbar label style and stay on one line at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/blog");
    const links = page.locator(".blog-actions a");
    await expect(links).toHaveText(["Explore topics", "RSS feed"]);
    await expect(links.locator("svg")).toHaveCount(0);
    const [topics, rss] = await Promise.all([
      links.nth(0).boundingBox(), links.nth(1).boundingBox(),
    ]);
    expect(Math.abs(topics!.y - rss!.y)).toBeLessThan(1);
    expect(topics!.x + topics!.width).toBeLessThan(rss!.x);
    expect(rss!.x + rss!.width).toBeLessThanOrEqual(width);
    const typography = await page.locator(".nav .links a").first().evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.fontFamily, style.fontSize, style.letterSpacing, style.textTransform];
    });
    for (const link of await links.all()) {
      expect(await link.evaluate((element) => {
        const style = getComputedStyle(element);
        return [style.fontFamily, style.fontSize, style.letterSpacing, style.textTransform];
      })).toEqual(typography);
      await expect(link).toHaveAttribute("data-hover-scramble", "");
      const underlineGap = await link.evaluate((element) => {
        const text = document.createRange();
        text.selectNodeContents(element);
        const underline = getComputedStyle(element, "::after");
        return element.getBoundingClientRect().bottom - parseFloat(underline.bottom)
          - parseFloat(underline.height) - text.getBoundingClientRect().bottom;
      });
      expect(underlineGap).toBeGreaterThanOrEqual(1);
      expect(underlineGap).toBeLessThanOrEqual(5);
    }
  });
}

test("utility and return links keep the navbar effect across blog navigation", async ({ page }) => {
  await page.goto("/blog");
  const topics = page.locator('.blog-actions a[href="/blog/tags"]');
  await topics.hover();
  await expect.poll(() => topics.evaluate((element) =>
    getComputedStyle(element, "::after").transform,
  )).toBe("matrix(1, 0, 0, 1, 0, 0)");
  await expect(topics).toHaveText("Explore topics");
  await topics.click();
  const directoryBack = page.locator('main a[href="/blog"].back');
  await expect(directoryBack).toHaveAttribute("data-hover-scramble", "");
  await expect(directoryBack.locator("svg")).toHaveCount(0);
  await page.locator('[data-blog-topics] a[href="/blog/tags/smart-mix"]').click();
  const indexLinks = page.locator(".back-links a");
  await expect(indexLinks).toHaveCount(2);
  await expect(indexLinks.locator("svg")).toHaveCount(0);
  for (const link of await indexLinks.all()) await expect(link).toHaveAttribute("data-hover-scramble", "");
  await page.locator('[data-tag-posts] h2 a[href="/blog/smart-mix-planned-on-the-server"]').click();
  const articleBack = page.locator(".post-head .back");
  await expect(articleBack).toHaveAttribute("data-hover-scramble", "");
  await expect(articleBack.locator("svg")).toHaveCount(0);
  await articleBack.click();
  await expect(page).toHaveURL(/\/blog$/);
});
