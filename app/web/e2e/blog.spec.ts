import { expect, test, type APIRequestContext } from "@playwright/test";

import { blogPosts, historicalChapters, draftHrefs } from "./blog-content";

const POST = "/blog/reads-from-snapshots";
const CHAPTERS = historicalChapters.map((post) => post.href);
const DRAFTS = draftHrefs;
const PUBLISHED = blogPosts.filter((post) => !post.draft).map((post) => post.href);
const PUBLISHED_CHAPTERS = historicalChapters
  .filter((post) => !post.draft)
  .map((post) => post.href);

// Drafts render only in development; with none left, preview and production match.
async function includesDrafts(request: APIRequestContext): Promise<boolean> {
  if (!DRAFTS.length) return false;
  const response = await request.get(DRAFTS[0]!);
  expect([200, 404]).toContain(response.status());
  return response.status() === 200;
}

test("the navigation links to the blog", async ({ page }) => {
  await page.goto("/");
  await page.locator("nav a[href='/blog']").first().click();
  await expect(page).toHaveURL(/\/blog$/);
  await expect(
    page.getByRole("heading", {
      name: "How Crate is built",
      level: 1,
      exact: true,
    }),
  ).toBeVisible();
});

test("the index header, series and articles become visible once motion runs", async ({
  page,
}) => {
  await page.goto("/blog");
  for (const selector of [
    ".page-header .eyebrow",
    ".page-header h1",
    "[data-start-series]",
    "[data-blog-articles] li",
  ]) {
    const element = page.locator(selector).first();
    await element.scrollIntoViewIfNeeded();
    await expect
      .poll(() => element.evaluate((node) => getComputedStyle(node).opacity))
      .toBe("1");
  }
});

test("technical articles are newest first and open the selected article", async ({
  page,
}) => {
  await page.goto("/blog");
  const articles = page.locator("[data-blog-articles] li");
  const dates = await articles
    .locator("time")
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("datetime")!),
    );
  expect(dates.length).toBeGreaterThan(0);
  expect(dates).toEqual([...dates].sort().reverse());
  const first = articles.first().locator("a").first();
  const href = (await first.getAttribute("href"))!;
  const title = (await first.locator("h2, h3").first().innerText()).trim();
  await first.click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  await expect(page.locator("article h1")).toHaveText(title);
});

for (const width of [1440, 390]) {
  test(`the homepage separates the series and technical reading at ${width}px`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const preview = await includesDrafts(request);
    await page.goto("/blog");
    await expect(page.locator("[data-blog-home]")).toHaveCount(1);
    await expect(page.locator("[data-blog-series]")).toContainText(
      "How to dismantle Spotify. Building Crate from the ground.",
    );
    const start = page.locator("[data-start-series]");
    await expect(start).toHaveAttribute("href", CHAPTERS[0]!);
    await start.focus();
    await expect(start).toBeFocused();
    expect(
      await start.evaluate((element) => getComputedStyle(element).outlineStyle),
    ).not.toBe("none");
    expect((await start.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    const chapters = page.locator("[data-blog-chapters] li a");
    const articles = page.locator("[data-blog-articles] li a");
    const chapterHrefs = await chapters.evaluateAll((links) =>
      links.map((link) => link.getAttribute("href")!),
    );
    const articleHrefs = await articles.evaluateAll((links) =>
      links.map((link) => link.getAttribute("href")!),
    );
    expect(chapterHrefs).toEqual(preview ? CHAPTERS : PUBLISHED_CHAPTERS);
    const visibleArticles = blogPosts.filter(
      (post) => post.part === null && (preview || !post.draft),
    );
    expect(new Set(articleHrefs)).toEqual(
      new Set(visibleArticles.map((post) => post.href)),
    );
    const readingLinks = [...chapterHrefs, ...articleHrefs];
    expect(new Set(readingLinks).size).toBe(readingLinks.length);
    for (const href of readingLinks) {
      expect((await request.get(href)).status(), href).toBe(200);
    }
    for (const href of DRAFTS) {
      const link = page.locator(`[data-blog-home] a[href="${href}"]`);
      if (preview) await expect(link).toContainText(/draft/i);
      else await expect(link).toHaveCount(0);
    }
    if (!DRAFTS.length)
      await expect(page.locator("[data-blog-home] .draft")).toHaveCount(0);
    for (const link of await chapters.all()) {
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await page.locator("#technical-articles").scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  });
}

test("the homepage timeline opens on demand and remounts once after article navigation", async ({
  page,
}) => {
  await page.goto("/blog");
  const details = page.locator(
    "details#development-timeline, #development-timeline details",
  );
  const track = details.locator('[data-timeline-proposal="signal-track"]');
  for (let visit = 0; visit < 2; visit++) {
    await expect(details).not.toHaveAttribute("open");
    await details.locator("summary").click();
    await expect(details).toHaveAttribute("open", "");
    await expect(track).toHaveCount(1);
    await expect(track.locator("[data-track-count]")).toHaveText("01");
    await track.locator("[data-track-next]").click();
    await expect(track.locator("[data-track-count]")).toHaveText("02");
    if (visit === 0) {
      await page.locator("[data-start-series]").click();
      await expect(page).toHaveURL(new RegExp(`${CHAPTERS[0]}$`));
      await page.getByRole("link", { name: "All posts", exact: true }).click();
      await expect(page).toHaveURL(/\/blog$/);
    }
  }
});

test("the series entry and article lists work without JavaScript", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    baseURL,
  });
  try {
    const page = await context.newPage();
    await page.goto("/blog");
    const start = page.locator("[data-start-series]");
    await expect(start).toBeVisible();
    await expect(start).toHaveAttribute("href", CHAPTERS[0]!);
    await expect(
      page.locator("[data-blog-chapters] li a").first(),
    ).toBeVisible();
    await expect(
      page.locator("[data-blog-articles] li a").first(),
    ).toBeVisible();
    await start.click();
    await expect(page).toHaveURL(new RegExp(`${CHAPTERS[0]}$`));
    await expect(page.locator("article h1")).toHaveText(
      "Crate started as a librarian",
    );
  } finally {
    await context.close();
  }
});

test("published prose links only to available reading and keeps the next chapter as copy", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const preview = await includesDrafts(request);
  for (const href of PUBLISHED) {
    const response = await page.goto(href);
    expect(response?.status()).toBe(200);
    const prose = page.locator(".prose");
    if (href === CHAPTERS[0]) {
      await expect(prose).toContainText("The next chapter");
      await expect(prose.locator(`a[href="${CHAPTERS[1]}"]`)).toHaveCount(0);
    }
    const destinations = await prose
      .locator('a[href^="/blog/"]')
      .evaluateAll((links) => [
        ...new Set(links.map((link) => link.getAttribute("href")!)),
      ]);
    for (const destination of destinations)
      expect((await request.get(destination)).status(), destination).toBe(200);
    if (!preview) {
      for (const draft of DRAFTS)
        await expect(prose.locator(`a[href="${draft}"]`)).toHaveCount(0);
    }
  }
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

for (const width of [1440, 390]) {
  test(`the acquisition chapter renders its handoff diagram and source links at ${width}px`, async ({
    page,
    request,
  }) => {
    const href = "/blog/when-retries-repeat-a-download";
    await page.setViewportSize({ width, height: 1100 });
    const response = await page.goto(href);
    test.skip(
      response?.status() === 404,
      "The acquisition chapter remains a development draft.",
    );
    expect(response?.status()).toBe(200);
    await expect(page.locator("article h1")).toHaveText(
      "When retries repeat a finished download",
    );
    const diagram = page.locator(
      `.prose img[src="${href}/ingestion-handoff.svg"]`,
    );
    await expect(diagram).toHaveAttribute("alt", /.{20,}/);
    await diagram.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        diagram.evaluate(
          (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
        ),
      )
      .toBe(true);
    expect((await request.get(`${href}/ingestion-handoff.svg`)).ok()).toBe(
      true,
    );

    const sourceLinks = page.locator(".expressive-code .source-link");
    expect(await sourceLinks.count()).toBeGreaterThan(0);
    for (const link of await sourceLinks.all()) {
      await expect(link).toHaveAttribute(
        "href",
        /^https:\/\/github\.com\/thecrateapp\/crate\/blob\/[0-9a-f]{40}\/.+#L\d+(-L\d+)?$/,
      );
      await expect(link.locator('svg[data-blog-icon="github"]')).toHaveCount(1);
    }
    const externalReferences = page.locator(
      '.prose a[data-blog-link="external"]',
    );
    expect(await externalReferences.count()).toBeGreaterThan(0);
    for (const link of await externalReferences.all())
      await expect(
        link.locator('svg[data-blog-icon="external-link"]'),
      ).toHaveCount(1);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  });
}

test("the RSS feed contains every published post and excludes every draft", async ({
  request,
}) => {
  const response = await request.get("/blog/rss.xml");
  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toContain("<rss");
  expect(body.match(/<item>/g)).toHaveLength(PUBLISHED.length);
  for (const href of PUBLISHED)
    expect(body).toContain(`https://cratemusic.app${href}`);
  for (const href of DRAFTS)
    expect(body).not.toContain(`https://cratemusic.app${href}`);
});
