import { expect, test } from "@playwright/test";

for (const width of [1440, 768, 390]) {
  test(`Admin taxonomy explorer preview works at ${width}px`, async ({
    page,
  }) => {
    const errors: string[] = [];
    const apiRequests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (request.url().includes("/api/")) apiRequests.push(request.url());
    });
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/review-admin-genre-wheel.html");

    const tree = page.getByLabel("Genre taxonomy tree");
    const wheel = page.locator('figure[aria-label^="Genre taxonomy wheel"]');
    await expect(tree).toBeVisible();
    await expect(wheel).toBeVisible();
    expect(await tree.locator("button").count()).toBeGreaterThan(10);

    await tree
      .locator("button[aria-pressed]")
      .filter({ hasText: /^rock/i })
      .click();
    const summary = page.getByLabel("Genre summary for rock");
    await expect(summary).toBeVisible();
    await expect(summary).toContainText("3,298");
    await expect(summary).toContainText("14.2%");
    await expect(wheel).toHaveAttribute("aria-label", /61 core genres/);
    await expect(wheel).toHaveAttribute("data-layout", "embedded");
    expect(await wheel.locator("svg [data-genre]").count()).toBe(61);
    expect(
      await wheel
        .locator('svg path[data-relation][data-active="true"]')
        .count(),
    ).toBeGreaterThan(0);
    const firstRelationStroke = await wheel
      .locator("svg path[data-relation]")
      .first()
      .evaluate((path) => getComputedStyle(path).stroke);
    expect(firstRelationStroke).not.toBe("none");
    expect(firstRelationStroke).not.toBe("");
    await expect(page.getByLabel("EQ inheritance detail")).toHaveCount(0);
    const management = page.getByLabel(/Genre management for rock/i);
    await expect(management).toContainText("Equalizer preset");
    await expect(management).toContainText("Edit cover");
    await expect(management).toContainText("Description");
    const wheelBox = await wheel.boundingBox();
    const summaryBox = await summary.boundingBox();
    expect(wheelBox).not.toBeNull();
    expect(summaryBox).not.toBeNull();
    if (width > 1200) {
      expect(summaryBox!.x).toBeGreaterThan(wheelBox!.x);
    } else {
      expect(summaryBox!.y).toBeGreaterThan(wheelBox!.y);
    }
    if (width <= 760) {
      await expect(
        wheel.locator('.genre-wheel-node[data-ring="2"] text').first(),
      ).toBeHidden();
    }
    await wheel.locator('[data-genre="rock"]').click();
    await expect(wheel.locator('[data-genre="rock"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    expect(apiRequests).toEqual([]);
  });
}
