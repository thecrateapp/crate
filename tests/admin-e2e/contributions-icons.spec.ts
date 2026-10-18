import { expect, test } from "./fixtures";
import fixture from "./fixtures/contributions-1af.json";

for (const width of [1440, 768, 390]) {
  test.describe(`Contributions built ${width}`, () => {
    test.use({ viewport: { width, height: 1100 } });
    test("keeps real request, attribution, route and keyboard refresh", async ({
      page,
      openAdminPage,
      adminApi,
    }) => {
      adminApi.respondTo("/api/manage/contributions", fixture);
      const reads: string[] = [];
      page.on("request", (request) => {
        if (new URL(request.url()).pathname === "/api/manage/contributions")
          reads.push(request.url());
      });
      await openAdminPage("/contributions");
      const main = page.getByRole("main"),
        refresh = main.getByRole("button", { name: "Refresh", exact: true });
      await expect(
        main.getByRole("heading", { name: "Contributions", exact: true }),
      ).toHaveCSS("font-family", /Bricolage Grotesque/);
      await expect(
        main.getByRole("link", { name: "Luz de octubre", exact: true }),
      ).toHaveAttribute("href", "/artists/costa-norte/luz-de-octubre");
      await expect(
        main.getByRole("link", { name: "Mareas", exact: true }),
      ).toHaveCount(0);
      await expect(
        main.getByText("Lucía de muestra", { exact: true }),
      ).toBeVisible();
      await expect(
        main.getByText("Unknown user", { exact: true }),
      ).toBeVisible();
      await expect(main.getByText("withdrawn", { exact: true })).toBeVisible();
      await expect(main.locator("svg")).toHaveCount(0);
      await expect(main.locator("button button,button a,a a")).toHaveCount(0);
      for (const control of await main.locator("button,a").all()) {
        const box = (await control.boundingBox())!;
        expect(
          Number(Math.min(box.width, box.height).toFixed(2)),
        ).toBeGreaterThanOrEqual(44);
      }
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route(
        "**/api/manage/contributions?limit=150",
        async (route) => {
          await held;
          await route.fulfill({
            json: { items: fixture.items.slice(2), count: 2 },
          });
        },
      );
      await refresh.focus();
      await page.keyboard.press("Enter");
      await expect(refresh).toBeDisabled();
      await expect(refresh).toHaveAttribute("aria-busy", "true");
      await expect(main.locator("svg[data-admin-ux]")).toHaveCount(2);
      release();
      await expect(refresh).toBeEnabled();
      await expect(
        main.getByText("Luz de octubre", { exact: true }),
      ).toHaveCount(0);
      await expect(main.getByText("Mareas", { exact: true })).toBeVisible();
      // Native disabled buttons release focus during a held read, as before 1AF.
      // Verify the enabled control and following album remain keyboard accessible.
      await refresh.focus();
      await page.keyboard.press("Tab");
      await expect(
        main.getByRole("link", { name: "Puerto", exact: true }),
      ).toBeFocused();
      expect(reads).toHaveLength(2);
      expect(reads.every((url) => new URL(url).search === "?limit=150")).toBe(
        true,
      );
      expect(
        adminApi.calls.filter((call) => call.path.includes("contributions")),
      ).toEqual([]);
    });
  });
}
