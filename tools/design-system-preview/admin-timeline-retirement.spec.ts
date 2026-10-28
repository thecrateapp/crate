import { expect, test } from "@playwright/test";

for (const width of [1440, 768, 390]) {
  test.describe(`Timeline preview retired ${width}`, () => {
    test.use({ viewport: { width, height: 1100 } });
    test("replaces the old specimen with a retirement record and no dead navigation", async ({
      page,
    }) => {
      const errors: string[] = [],
        timelineRequests: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (request.url().includes("/api/timeline"))
          timelineRequests.push(request.url());
      });
      await page.goto("/admin-timeline-demo.html");
      await expect(page).toHaveURL(/\/#cronologia-admin$/);
      const section = page.getByRole("region", {
        name: "Checkpoint 1AG, retirada de Timeline de Admin",
        exact: true,
      });
      await expect(
        section.getByRole("heading", {
          name: "Timeline retirada.",
          exact: true,
        }),
      ).toBeVisible();
      await expect(section.locator("iframe")).toHaveCount(0);
      await expect(page.locator('iframe[src*="admin-timeline"]')).toHaveCount(
        0,
      );
      await expect(
        page.getByRole("heading", { name: "Library Timeline", exact: true }),
      ).toHaveCount(0);
      await expect(page.locator("footer")).toContainText("1AF publicado");
      await expect(page.locator("footer")).toContainText("1AG publicado");
      await page.goto("/admin-navigation-demo.html");
      if (width < 768)
        await page
          .getByRole("button", { name: "Open navigation", exact: true })
          .click();
      await expect(page.locator('a[href="/timeline"]')).toHaveCount(0);
      await expect(
        page.getByRole("link", { name: "Browse", exact: true }),
      ).toBeVisible();
      expect(errors).toEqual([]);
      expect(timelineRequests).toEqual([]);
    });
  });
}
