import { expect, test } from "@playwright/test";

const articles = [
  {
    slug: "finding-the-one",
    title: "Finding the one: where every bar starts",
    diagram: "bar-phase.svg",
  },
  {
    slug: "lyrics-as-labels",
    title: "Lyrics as labels: calibrating a voice detector without listening",
    diagram: "voice-calibration.svg",
  },
];

for (const width of [1440, 390]) {
  test(`Smart Mix 3 drafts render their sources, diagrams and related reading at ${width}px`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    for (const article of articles) {
      const response = await page.goto(`/blog/${article.slug}`);
      test.skip(
        response?.status() === 404,
        "The article is not published in this build.",
      );
      await expect(page.locator("article h1")).toHaveText(article.title);
      expect((await page.locator(".prose").innerText()).length).toBeGreaterThan(
        4000,
      );
      await expect(page.locator("[data-post-series]")).toHaveCount(0);
      const image = page.locator(`.prose img[src$="/${article.diagram}"]`);
      await expect(image).toHaveAttribute("alt", /.+/);
      await expect
        .poll(() =>
          image.evaluate(
            (node: HTMLImageElement) => node.complete && node.naturalWidth > 0,
          ),
        )
        .toBe(true);
      expect(
        (await request.get(`/blog/${article.slug}/${article.diagram}`)).ok(),
      ).toBe(true);
      const references = page.locator('.prose a[data-blog-link="external"]');
      for (const link of await references.all()) {
        await expect(
          link.locator('svg[data-blog-icon="external-link"]'),
        ).toHaveCount(1);
      }
      const related = page.locator("[data-related-posts] a");
      expect(await related.count()).toBeGreaterThan(0);
      expect(await related.count()).toBeLessThanOrEqual(3);
      for (const link of await related.all()) {
        expect(
          (await request.get((await link.getAttribute("href"))!)).ok(),
        ).toBe(true);
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
    }
  });
}

test("the two Smart Mix 3 articles connect through the article footer", async ({
  page,
}) => {
  const response = await page.goto("/blog/finding-the-one");
  test.skip(
    response?.status() === 404,
    "The article is not published in this build.",
  );
  const next = page.locator("[data-next-post]");
  await expect(next).toHaveAttribute("href", "/blog/lyrics-as-labels");
  await next.click();
  await expect(page).toHaveURL(/\/blog\/lyrics-as-labels$/);
  const previous = page.locator("[data-previous-post]");
  await expect(previous).toHaveAttribute("href", "/blog/finding-the-one");
  await previous.click();
  await expect(page).toHaveURL(/\/blog\/finding-the-one$/);
});
