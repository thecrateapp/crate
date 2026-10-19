import { expect, test } from "@playwright/test";
for (const variant of ["artist", "editorial", "media"]) {
  test(`default ${variant} hero fills its minimum height before aligning content`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto(
      `/iframe.html?id=components-pagehero--${variant}&viewMode=story`,
    );
    const section = page.getByTestId("page-hero").locator("section");
    await expect(section).toBeVisible();
    const geometry = await section.evaluate((el) => {
      const content = el.lastElementChild!;
      return {
        bottom: el.getBoundingClientRect().bottom,
        contentBottom: content.getBoundingClientRect().bottom,
        top: el.getBoundingClientRect().top,
        headingTop: el.querySelector("h1")!.getBoundingClientRect().top,
      };
    });
    expect(geometry.contentBottom).toBeCloseTo(geometry.bottom, 0);
    expect(geometry.headingTop).toBeGreaterThan(geometry.top + 60);
  });
}

for (const kind of ["artist", "genre"])
  for (const width of [390, 1200])
    test(`Listen ${kind} identity clears the overlay header at ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(
        `http://127.0.0.1:5174/tests/hero-layout-contract.html?kind=${kind}`,
      );
      const title = page.getByRole("heading", { level: 1 });
      await expect(title).toBeVisible();
      const header = (await page.getByRole("banner").boundingBox())!;
      const box = (await title.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(header.y + header.height);
      const hero = page.getByTestId("page-hero").locator("section");
      const bounds = (await hero.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(bounds.y);
      expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height);
      await page.screenshot({
        path: `.artifacts/review/1ax-${kind}-${width}.png`,
        fullPage: true,
      });
    });
