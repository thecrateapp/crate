import { expect, test } from "./fixtures";

for (const width of [1440, 768, 390]) {
  test.describe(`Timeline retired ${width}`, () => {
    test.use({ viewport: { width, height: 1100 } });
    test("redirects old links to the real Browse without Timeline requests or navigation", async ({
      page,
      adminApi,
      openAdminPage,
    }) => {
      adminApi.respondTo("/api/browse/filters", {
        genres: [],
        countries: [],
        decades: [],
        formats: [],
      });
      adminApi.respondTo("/api/artists", {
        items: [],
        total: 0,
        page: 1,
        per_page: 60,
      });
      const timelineReads: string[] = [];
      page.on("request", (request) => {
        if (new URL(request.url()).pathname === "/api/timeline")
          timelineReads.push(request.url());
      });
      await openAdminPage("/timeline?year=2020#albums");
      await expect(page).toHaveURL(/\/browse$/);
      await expect(
        page.getByRole("main").getByRole("heading", {
          name: "No artists in the library yet",
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.locator('a[href="/timeline"]')).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: "Library Timeline", exact: true }),
      ).toHaveCount(0);
      await page.keyboard.press("Control+k");
      const palette = page.getByRole("dialog", {
        name: "Command palette",
        exact: true,
      });
      await expect(palette).toBeVisible();
      await palette
        .getByRole("combobox", { name: "Search commands", exact: true })
        .fill("Timeline");
      await expect(
        palette.getByRole("option", { name: "Timeline", exact: true }),
      ).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(palette).toHaveCount(0);
      expect(timelineReads).toEqual([]);
    });
  });
}
