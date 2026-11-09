import { expect, test, type Page } from "@playwright/test";

const chapter = "/blog/when-retries-repeat-a-download?milestone=acquisition-retries";
const publishedChapter = "/blog/crate-started-as-a-librarian";

async function expectReadableHeader(page: Page) {
  const header = page.locator(".post-head");
  await expect(header.locator(".post-series")).not.toBeEmpty();
  await expect(header.locator(".meta")).toContainText(/min read/i);
  await expect(header.locator("[data-blog-tags] a").first()).toBeVisible();
  for (const selector of [".back", ".post-meta-group", ".lede", ".post-topics"]) {
    await expect(header.locator(selector)).toHaveCSS("opacity", "1");
    await expect(header.locator(selector)).toHaveCSS("visibility", "visible");
  }
  await expect(header.locator("h1")).toHaveCSS("visibility", "visible");
}

for (const width of [1440, 390]) {
  test(`the full header mounts even when Astro's initial event is lost at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 1100 });
    await page.addInitScript(() => {
      const dispatch = document.dispatchEvent.bind(document);
      let skipped = false;
      document.dispatchEvent = (event) => {
        if (event.type === "astro:page-load" && !skipped) {
          skipped = true;
          return true;
        }
        return dispatch(event);
      };
    });
    const href = (await request.get(chapter)).status() === 200 ? chapter : publishedChapter;
    await page.goto(href);
    await expectReadableHeader(page);
    // A static CSS fallback alone must not hide a missing controller.
    await expect(page.locator(".post-head")).toHaveClass(/is-in/);
    expect(await page.locator(".post-head h1 .w").count()).toBeGreaterThan(0);
    await page.locator(".post-head .back").click();
    await expect(page.locator(".blog-header h1")).toHaveCSS("opacity", "1");
    await page.locator(`[data-blog-series] a[href="${publishedChapter}"]`).first().click();
    await expectReadableHeader(page);
    await expect(page.locator(".post-head")).toHaveClass(/is-in/);
    await page.goBack();
    await expect(page.locator(".blog-header h1")).toHaveCSS("opacity", "1");
    await page.goForward();
    await expectReadableHeader(page);
  });
}

test("article identity remains readable if motion modules fail to load", async ({ page }) => {
  await page.route("**/*", (route) => route.request().resourceType() === "script"
    ? route.abort()
    : route.continue());
  await page.goto(publishedChapter);
  // The inline js class still exists, which used to hide data-enter permanently.
  await expect(page.locator("html")).toHaveClass(/js/);
  await expectReadableHeader(page);
  await page.locator(".post-head .back").click();
  for (const selector of [".eyebrow", "h1", ".intro"]) {
    await expect(page.locator(`.blog-header ${selector}`)).toHaveCSS("opacity", "1");
  }
});
