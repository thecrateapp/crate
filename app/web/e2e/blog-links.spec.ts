import { expect, test } from "@playwright/test";

const chapter = "/blog/filesystem-to-indexed-catalogue";

for (const width of [1440, 390]) {
  test(`external references and repository sources stay distinct at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1100 });
    const response = await page.goto(chapter);
    test.skip(
      response?.status() === 404,
      "Draft chapters only render in development.",
    );
    await expect(page.locator(".prose")).toContainText(
      "We moved the library inventory into SQLite",
    );

    const external = page.getByRole("link", {
      name: "beets Item API",
      exact: true,
    });
    await expect(external).toHaveAttribute(
      "href",
      "https://beets.readthedocs.io/en/stable/api/generated/beets.library.Item.html",
    );
    await expect(external).toHaveAttribute("data-blog-link", "external");
    await expect(external).not.toHaveAttribute("target");
    await expect(external.locator(":scope > svg:first-child")).toHaveAttribute(
      "data-blog-icon",
      "external-link",
    );
    await external.scrollIntoViewIfNeeded();
    expect(await external.evaluate((el) => getComputedStyle(el).color)).toBe(
      "rgb(251, 191, 36)",
    );
    await external.focus();
    expect(
      await external.evaluate((el) => getComputedStyle(el).outlineStyle),
    ).toBe("solid");

    const repository = page.getByRole("link", {
      name: "Original cache and browse handler",
      exact: true,
    });
    await expect(repository).toHaveAttribute("data-blog-link", "github");
    await expect(
      repository.locator(":scope > svg:first-child"),
    ).toHaveAttribute("data-blog-icon", "github");
    expect(await repository.evaluate((el) => getComputedStyle(el).color)).toBe(
      "rgb(103, 232, 249)",
    );

    for (const selector of [
      ".expressive-code .source-link",
      ".sources a",
      ".track-source",
    ]) {
      for (const link of await page.locator(selector).all()) {
        await expect(link.locator(":scope > svg:first-child")).toHaveAttribute(
          "data-blog-icon",
          "github",
        );
        await expect(link.locator("svg")).toHaveCount(1);
      }
    }
    for (const icon of await page
      .locator(".prose a[data-blog-link] > svg")
      .all()) {
      await expect(icon).toHaveAttribute("aria-hidden", "true");
      await expect(icon).toHaveAttribute("focusable", "false");
      expect((await icon.boundingBox())!.width).toBe(16);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    const internal = page.getByRole("link", {
      name: "first chapter",
      exact: true,
    });
    await expect(internal).not.toHaveAttribute("data-blog-link");
    await expect(internal.locator("svg")).toHaveCount(0);
    await internal.click();
    await expect(page).toHaveURL(/\/blog\/crate-started-as-a-librarian$/);
    await page.locator("[data-next-post]").click();
    await expect(page).toHaveURL(new RegExp(`${chapter}$`));
    await expect(external.locator("svg")).toHaveCount(1);
  });
}

test("source icons are present in rendered HTML without JavaScript", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto(
      "http://localhost:4321/blog/smart-mix-planned-on-the-server",
    );
    await expect(page.locator(".prose .expressive-code")).toHaveCount(3);
    await expect(
      page.locator('.prose .source-link > svg[data-blog-icon="github"]'),
    ).toHaveCount(3);
    await expect(
      page.locator('.sources a > svg[data-blog-icon="github"]'),
    ).toHaveCount(5);
  } finally {
    await context.close();
  }
});
