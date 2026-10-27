import { emulateCoarsePointer, expect, test } from "./fixtures";
import fixture from "./fixtures/discovery-1ai.json";
for (const width of [1440, 768, 390]) {
  test.describe(`Discovery Admin ${width}`, () => {
    test.use({ viewport: { width, height: 1100 } });
    test("retains actual search and task polling contracts with bounded UX glyphs", async ({
      page,
      adminApi,
      openAdminPage,
    }) => {
      for (const [path, value] of Object.entries(fixture))
        adminApi.respondTo(new URL(path, "http://sample.test").pathname, value);
      await page.route("**/api/artists/*/photo", (route) =>
        route.fulfill({
          path: "tools/design-system-preview/discovery-sample-art.svg",
          contentType: "image/svg+xml",
        }),
      );
      await page.route("**/sample-discovery-cover.svg", (route) =>
        route.fulfill({
          path: "tools/design-system-preview/discovery-sample-art.svg",
          contentType: "image/svg+xml",
        }),
      );
      // The independent destination page receives an empty fixture; this test checks routing only.
      adminApi.respondTo("/api/acquisition/new-releases/snapshot", {
        releases: [],
      });
      let releasePost: (() => void) | undefined,
        releaseTask: (() => void) | undefined;
      await page.route(
        "**/api/discover/completeness/refresh",
        async (route) => {
          expect(route.request().method()).toBe("POST");
          await new Promise<void>((resolve) => {
            releasePost = resolve;
          });
          await route.fulfill({ json: { task_id: "discovery-browser-task" } });
        },
      );
      await page.route("**/api/tasks/discovery-browser-task", async (route) => {
        expect(route.request().method()).toBe("GET");
        await new Promise<void>((resolve) => {
          releaseTask = resolve;
        });
        await route.fulfill({
          json: {
            id: "discovery-browser-task",
            status: "completed",
            result: { partial: true, failed_artists: 2 },
          },
        });
      });
      await openAdminPage("/discover");
      const main = page.getByRole("main");
      await expect(
        main.getByRole("heading", { name: "Discovery", exact: true }),
      ).toBeVisible();
      await expect(
        main.getByRole("img", { name: "Costa Norte", exact: true }),
      ).toBeVisible();
      await expect(main.locator("svg:not([data-admin-ux])")).toHaveCount(1);
      await expect(main.locator("svg:not([data-admin-ux])")).toHaveClass(
        /solar-magnifier-outline/,
      );
      const search = main.getByRole("searchbox", {
        name: "Search discovery",
        exact: true,
      });
      await search.fill("MAR DE");
      await expect(
        main.getByRole("button", { name: "Open artist", exact: true }),
      ).toHaveCount(1);
      await search.fill("");
      const recompute = main.getByRole("button", {
        name: "Recompute gaps",
        exact: true,
      });
      await recompute.focus();
      await page.keyboard.press("Enter");
      await expect(
        main.getByRole("button", { name: "Recomputing...", exact: true }),
      ).toHaveAttribute("aria-busy", "true");
      await expect.poll(() => typeof releasePost).toBe("function");
      releasePost!();
      await expect.poll(() => typeof releaseTask).toBe("function");
      await expect(
        main.getByRole("button", { name: "Recomputing...", exact: true }),
      ).toBeDisabled();
      await expect(
        main.getByRole("button", { name: "Check releases", exact: true }),
      ).toBeEnabled();
      releaseTask!();
      await expect(recompute).toBeEnabled();
      await expect(
        page.getByText("Completeness refreshed with 2 artists skipped", {
          exact: true,
        }),
      ).toBeVisible();
      for (const field of await main.locator(".crate-form-field").all())
        expect(
          await field.evaluate((el) => {
            const [label, component] = Array.from(el.children);
            return (
              component!.getBoundingClientRect().top -
              label!.getBoundingClientRect().bottom
            );
          }),
        ).toBe(8);
      expect(
        await main
          .getByRole("heading", { level: 1 })
          .evaluate((el) => getComputedStyle(el).fontFamily),
      ).toContain("Bricolage");
      await emulateCoarsePointer(page);
      for (const button of await main.getByRole("button").all())
        expect(
          Number((await button.boundingBox())!.height.toFixed(2)),
        ).toBeGreaterThanOrEqual(44);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await main
        .getByRole("button", { name: "Open Release Radar", exact: true })
        .click();
      await expect(page).toHaveURL(/\/new-releases$/);
    });
  });
}
