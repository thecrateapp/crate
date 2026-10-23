import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`Admin taxonomy explorer Storybook review works at ${width}px`, async ({
    page,
  }) => {
    const errors: string[] = [];
    const apiRequests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (request.url().includes("/api/")) apiRequests.push(request.url());
    });
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(
      "/?path=/story/reviews-admin-a3-genre-wheel--taxonomy-explorer",
    );

    const frame = page.frameLocator("#storybook-preview-iframe");
    const explorer = frame.getByLabel("Genre taxonomy tree");
    const wheel = frame.locator('figure[aria-label^="Genre taxonomy wheel"]');
    await expect(explorer).toBeVisible();
    await expect(wheel).toBeVisible();
    expect(await explorer.locator("button").count()).toBeGreaterThan(10);
    await explorer
      .locator("button[aria-pressed]")
      .filter({ hasText: /^rock/i })
      .click();
    await expect(wheel).toHaveAttribute("aria-label", /61 core genres/);
    await expect(wheel).toHaveAttribute("data-layout", "embedded");
    expect(await wheel.locator("svg [data-genre]").count()).toBe(61);
    expect(
      await wheel
        .locator('svg path[data-relation][data-active="true"]')
        .count(),
    ).toBeGreaterThan(0);
    await expect(frame.getByLabel("EQ inheritance detail")).toHaveCount(0);
    const management = frame.getByLabel(/Genre management for rock/i);
    await expect(management).toContainText("Equalizer preset");
    await expect(management).toContainText("Edit cover");
    await expect(management).toContainText("Description");
    await wheel.locator('[data-genre="rock"]').click();
    await expect(wheel.locator('[data-genre="rock"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      await frame.locator("body").evaluate((body) => {
        const doc = body.ownerDocument.documentElement;
        return doc.scrollWidth <= doc.clientWidth;
      }),
    ).toBe(true);
    expect(errors).toEqual([]);
    expect(apiRequests).toEqual([]);
  });
}
