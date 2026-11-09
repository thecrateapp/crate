import { expect, test } from "@playwright/test";

import { historicalChapters } from "./blog-content";

const first = historicalChapters[0]!.href;
const second = historicalChapters[1]!.href;

for (const { part, href, date } of historicalChapters) {
  test(`part ${part} keeps its series identity with reading metadata on desktop and mobile`, async ({
    page,
  }) => {
    const seriesTitle =
      "How to dismantle Spotify. Building Crate from the ground.";
    for (const viewport of [
      { width: 1440, height: 1100 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      const response = await page.goto(href);
      test.skip(
        href !== first && response?.status() === 404,
        "Draft chapters are only rendered in development.",
      );
      expect(response?.status()).toBe(200);
      const identity = page.locator(".post-head [data-post-series]");
      await expect(identity).toBeVisible();
      await expect(identity).toContainText(seriesTitle);
      await expect(
        page.locator(".post-meta-group [data-series-part]"),
      ).toHaveText(`Part ${part}`);
      const metadata = page.locator(".post-meta-group .meta");
      await expect(metadata.locator("time").first()).toHaveAttribute(
        "datetime",
        date,
      );
      await expect(metadata).toContainText(/\d+\s+min read/i);
      await expect(page.locator(".prose")).not.toContainText(seriesTitle);
      await expect
        .poll(() =>
          page
            .locator(".post-meta-group")
            .evaluate((element) => getComputedStyle(element).opacity),
        )
        .toBe("1");
      const [label, dateBounds, title] = await Promise.all([
        identity.boundingBox(),
        metadata.boundingBox(),
        page.locator("article h1").boundingBox(),
      ]);
      expect(label!.y + label!.height).toBeLessThanOrEqual(dateBounds!.y + 1);
      expect(dateBounds!.y + dateBounds!.height).toBeLessThanOrEqual(
        title!.y + 1,
      );
      const outside = await page
        .locator(".post-meta-group")
        .evaluate((element) =>
          [element, ...element.querySelectorAll("*")].some((node) => {
            const bounds = node.getBoundingClientRect();
            return (
              bounds.left < 0 ||
              bounds.right > document.documentElement.clientWidth + 1
            );
          }),
        );
      expect(
        outside,
        "The full series title and part number must fit the viewport",
      ).toBe(false);
    }
  });
}

test("series footer connects visible chapters and respects its publication boundaries", async ({
  page,
  request,
}) => {
  const secondResponse = await request.get(second);
  expect([200, 404]).toContain(secondResponse.status());
  const preview = secondResponse.status() === 200;
  const response = await page.goto(first);
  expect(response?.status()).toBe(200);
  const next = page.locator("[data-next-post]");
  await expect(page.locator("[data-previous-post]")).toHaveCount(0);
  const related = page.locator("[data-related-posts] a");
  expect(await related.count()).toBeGreaterThan(0);
  expect(await related.count()).toBeLessThanOrEqual(3);
  for (const link of await related.all()) {
    expect(await link.getAttribute("href")).not.toBe(second);
    expect(
      (await request.get((await link.getAttribute("href"))!)).status(),
    ).toBe(200);
  }
  if (!preview) {
    await expect(next).toHaveCount(0);
    return;
  }
  // Walks every chapter forward and back: allow a few seconds per navigation.
  test.setTimeout(30_000 + historicalChapters.length * 2 * 4_000);
  for (let index = 1; index < historicalChapters.length; index++) {
    const current = historicalChapters[index]!;
    const previous = historicalChapters[index - 1]!;
    await expect(page.locator("[data-next-post]")).toHaveAttribute(
      "href",
      current.href,
    );
    await expect(page.locator("[data-next-post]")).toContainText(
      `Part ${current.part}`,
    );
    await page.locator("[data-next-post]").click();
    await expect(page).toHaveURL(new RegExp(`${current.href}$`), {
      timeout: 15_000,
    });
    await expect(page.locator("[data-previous-post]")).toHaveAttribute(
      "href",
      previous.href,
    );
  }
  await expect(page.locator("[data-next-post]")).toHaveCount(0);
  for (const previous of historicalChapters.slice(0, -1).reverse()) {
    await page.locator("[data-previous-post]").click();
    await expect(page).toHaveURL(new RegExp(`${previous.href}$`), {
      timeout: 15_000,
    });
  }
  await expect(page.locator("[data-previous-post]")).toHaveCount(0);
});

test("standalone articles do not display a series identity", async ({
  page,
}) => {
  await page.goto("/blog/reads-from-snapshots");
  await expect(page.locator("[data-post-series]")).toHaveCount(0);
});

test("related reading is a desktop side column with real article links", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/blog/reads-from-snapshots");
  const related = page.locator("[data-related-posts]");
  const prose = page.locator(".prose");
  const [side, text] = await Promise.all([
    related.boundingBox(),
    prose.boundingBox(),
  ]);
  expect(side!.x).toBeGreaterThanOrEqual(text!.x + text!.width);
  expect(side!.y).toBeLessThan(text!.y + 20);
  const excluded = await page
    .locator("[data-post-navigation] a")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  for (const link of await related.locator("a").all()) {
    const href = (await link.getAttribute("href"))!;
    expect(excluded).not.toContain(href);
    expect(href).not.toBe("/blog/reads-from-snapshots");
    expect((await request.get(href)).status()).toBe(200);
  }
  await related.locator("a").first().focus();
  await expect(related.locator("a").first()).toBeFocused();
  expect(
    await related
      .locator("a")
      .first()
      .evaluate((element) => getComputedStyle(element).outlineStyle),
  ).not.toBe("none");
});

test("related reading follows the article on mobile without overflowing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/blog/reads-from-snapshots");
  const related = page.locator("[data-related-posts]");
  const [side, article] = await Promise.all([
    related.boundingBox(),
    page.locator(".post-reading").boundingBox(),
  ]);
  expect(side!.y).toBeGreaterThanOrEqual(article!.y + article!.height);
  await related.scrollIntoViewIfNeeded();
  const bounds = await related.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  for (const link of await related.locator("a").all()) {
    const box = await link.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
});
