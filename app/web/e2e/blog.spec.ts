import { expect, test } from "@playwright/test";

const POST = "/blog/reads-from-snapshots";

test("the navigation links to the blog", async ({ page }) => {
  await page.goto("/");
  await page.locator("nav a[href='/blog']").first().click();
  await expect(page).toHaveURL(/\/blog$/);
  await expect(page.locator("h1")).toBeVisible();
});

test("the index header and posts become visible once motion runs", async ({
  page,
}) => {
  await page.goto("/blog");
  for (const selector of [
    ".page-header .eyebrow",
    ".page-header h1",
    ".posts li",
  ]) {
    await expect
      .poll(() =>
        page
          .locator(selector)
          .first()
          .evaluate((element) => getComputedStyle(element).opacity),
      )
      .toBe("1");
  }
});

test("the index lists posts newest first and opens them", async ({ page }) => {
  await page.goto("/blog");
  const first = page.locator(".posts li a").first();
  await expect(first).toHaveAttribute("href", POST);
  await first.click();
  await expect(page).toHaveURL(new RegExp(`${POST}$`));
  await expect(page.locator("h1")).toContainText("snapshots");
});

test("a post links its sources on GitHub and loads its diagram", async ({
  page,
}) => {
  await page.goto(POST);
  const sources = page.locator(".sources a");
  await expect(sources.first()).toHaveAttribute(
    "href",
    /^https:\/\/github\.com\/thecrateapp\/crate\/(blob|tree)\/main\//,
  );
  const diagram = page.locator(".prose img").first();
  await expect(diagram).toHaveAttribute("alt", /.{20,}/);
  await diagram.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      diagram.evaluate(
        (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
      ),
    )
    .toBe(true);
});

test("code blocks link their source pinned to a commit", async ({ page }) => {
  await page.goto(POST);
  const link = page.locator(".expressive-code .source-link").first();
  await expect(link).toHaveAttribute(
    "href",
    /^https:\/\/github\.com\/thecrateapp\/crate\/blob\/[0-9a-f]{40}\/.+#L\d+(-L\d+)?$/,
  );
  await expect(
    page
      .locator(".expressive-code")
      .first()
      .locator("button.copy, .copy button"),
  ).toHaveCount(1);
});

test("the RSS feed lists published posts", async ({ request }) => {
  const response = await request.get("/blog/rss.xml");
  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toContain("<rss");
  expect(body).toContain(`https://cratemusic.app${POST}`);
});
