import { expect, test } from "@playwright/test";

const article = "/blog/smart-mix-planned-on-the-server";
const topic = "/blog/tags/smart-mix";

test("header chips link to a topic containing the matching available posts", async ({ page, request }) => {
  const includesDrafts = (await request.get("/blog/from-crossfades-to-a-shared-mixing-engine")).status() === 200;
  await page.goto(article);
  const chips = page.locator(".post-head [data-blog-tags]");
  await expect(chips.getByRole("link")).toHaveText(["Smart Mix", "Android", "audio", "Python"]);
  const smartMix = chips.getByRole("link", { name: "Smart Mix", exact: true });
  await expect(smartMix).toHaveAttribute("href", topic);
  await expect(smartMix).not.toHaveAttribute("aria-pressed");
  await smartMix.click();
  await expect(page).toHaveURL(new RegExp(`${topic}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Smart Mix");
  await expect(page.getByRole("heading", { level: 1 })).toBeInViewport();
  await expect(page.locator("[data-tag-posts]>li")).toHaveCount(includesDrafts ? 6 : 2);
  await expect(page.locator(`[data-tag-posts] h2 a[href="${article}"]`)).toBeVisible();
  await expect(page.locator(`[data-tag-posts] [aria-current="page"]`)).toHaveCount(includesDrafts ? 6 : 2);
  await page.getByRole("link", { name: "All topics", exact: true }).click();
  await expect(page).toHaveURL(/\/blog\/tags$/);
  await expect(page.locator(`[data-blog-topics] a[href="${topic}"]`)).toContainText(includesDrafts ? "6" : "2");
});

test("the blog home exposes the topic directory", async ({ page }) => {
  await page.goto("/blog");
  await page.getByRole("navigation", { name: "Browse the blog" }).getByRole("link", { name: "Explore topics" }).click();
  await expect(page).toHaveURL(/\/blog\/tags$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Explore by topic");
});

test("topic routes and the directory share the draft publication boundary", async ({ request }) => {
  const includesDrafts = (await request.get("/blog/building-an-artist-page-when-the-providers-disagree")).status() === 200;
  expect((await request.get("/blog/tags/enrichment")).status()).toBe(includesDrafts ? 200 : 404);
  const html = await (await request.get("/blog/tags")).text();
  expect(html.includes('href="/blog/tags/enrichment"')).toBe(includesDrafts);
  expect((await request.get("/blog/tags/no-such-topic")).status()).toBe(404);
});

test("topic navigation and header chips work without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(article);
  const chip = page.locator('.post-head a[href="/blog/tags/python"]');
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page).toHaveURL(/\/blog\/tags\/python$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Python");
  await page.locator(`[data-tag-posts] h2 a[href="${article}"]`).click();
  await expect(page).toHaveURL(new RegExp(`${article}$`));
  await context.close();
});

for (const width of [1440, 390]) {
  test(`chips and topic lists fit at ${width}px and retain visible keyboard focus`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/blog/crate-started-as-a-librarian");
    const chip = page.locator('.post-head a[href="/blog/tags/how-to-dismantle-spotify"]');
    await chip.focus();
    await expect(chip).toBeFocused();
    expect(await chip.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none");
    expect(await chip.evaluate((element) => getComputedStyle(element).borderRadius)).toBe("9999px");
    await chip.press("Enter");
    await expect(page).toHaveURL(/\/blog\/tags\/how-to-dismantle-spotify$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("How to dismantle Spotify");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.getByRole("link", { name: "All topics", exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
