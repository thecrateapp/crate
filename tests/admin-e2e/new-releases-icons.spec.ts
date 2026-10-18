import { expect, test } from "./fixtures";
import fixture from "./fixtures/new-releases-1aj.json";
for (const width of [1440, 768, 390]) {
  test.describe(`New Releases Admin ${width}`, () => {
    test.use({ viewport: { width, height: 1100 } });
    test("keeps actual task wiring, filters, view and release actions", async ({
      page,
      adminApi,
      openAdminPage,
    }) => {
      adminApi.respondTo("/api/acquisition/new-releases/snapshot", fixture);
      await page.route("**/sample-new-release-cover.svg", (route) =>
        route.fulfill({
          path: "tools/design-system-preview/discovery-sample-art.svg",
          contentType: "image/svg+xml",
        }),
      );
      let releasePost: (() => void) | undefined,
        releaseTask: (() => void) | undefined;
      await page.route(
        "**/api/acquisition/new-releases/check",
        async (route) => {
          expect(route.request().method()).toBe("POST");
          await new Promise<void>((resolve) => {
            releasePost = resolve;
          });
          await route.fulfill({
            json: { task_id: "new-release-browser-task" },
          });
        },
      );
      await page.route(
        "**/api/tasks/new-release-browser-task",
        async (route) => {
          expect(route.request().method()).toBe("GET");
          await new Promise<void>((resolve) => {
            releaseTask = resolve;
          });
          await route.fulfill({
            json: {
              id: "new-release-browser-task",
              status: "completed",
              result: {},
            },
          });
        },
      );
      await openAdminPage("/new-releases");
      const main = page.getByRole("main");
      await expect(
        main.getByRole("heading", { name: "New Releases", exact: true }),
      ).toBeVisible();
      await expect(
        main.getByRole("link", { name: "Luz de octubre", exact: true }),
      ).toHaveAttribute("href", "/artists/costa-norte/luz-de-octubre");
      expect(
        await main
          .locator("svg:not([data-admin-ux])")
          .evaluateAll(
            (nodes) =>
              nodes.filter((el) => !el.closest('[role="combobox"]')).length,
          ),
      ).toBe(0);
      const search = main.getByRole("textbox", {
        name: "Search releases",
        exact: true,
      });
      await search.fill("PUERTO");
      await expect(
        main.getByText("Puerto sin fecha", { exact: true }),
      ).toBeVisible();
      await expect(
        main.getByRole("button", { name: "Download", exact: true }),
      ).toHaveCount(0);
      await search.fill("");
      const select = main.getByRole("combobox", {
        name: "All types",
        exact: true,
      });
      await select.press("ArrowDown");
      await page.getByRole("option", { name: /Unknown type/ }).click();
      await expect(
        main.getByText("Puerto sin fecha", { exact: true }),
      ).toBeVisible();
      await select.click();
      await page
        .getByRole("option", { name: "All types", exact: true })
        .click();
      await main
        .getByRole("button", { name: "Grid", exact: true })
        .press("Enter");
      await expect(
        main.getByRole("button", { name: "Grid", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(
        main.locator('[data-admin-ux="releases-grid-dismiss"]'),
      ).toHaveCount(3);
      await main.getByRole("button", { name: "Timeline", exact: true }).click();
      await main
        .getByRole("button", { name: "Check now", exact: true })
        .press("Enter");
      const busy = main.getByRole("button", { name: "Checking…", exact: true });
      await expect(busy).toHaveAttribute("aria-busy", "true");
      await expect(busy).toBeDisabled();
      await expect.poll(() => typeof releasePost).toBe("function");
      releasePost!();
      await expect.poll(() => typeof releaseTask).toBe("function");
      await expect(busy).toBeDisabled();
      releaseTask!();
      await expect(
        main.getByRole("button", { name: "Check now", exact: true }),
      ).toBeEnabled();
      await expect(
        page.getByText("Release check complete", { exact: true }),
      ).toBeVisible();
      await main
        .getByRole("button", { name: "Download", exact: true })
        .last()
        .click();
      await expect
        .poll(() =>
          adminApi.calls.some(
            (call) =>
              call.method === "POST" &&
              call.path === "/api/acquisition/new-releases/101/download",
          ),
        )
        .toBe(true);
      await expect(
        main.getByRole("button", { name: "Download", exact: true }),
      ).toHaveCount(1);
      await main
        .getByRole("button", { name: "Dismiss release", exact: true })
        .first()
        .press("Enter");
      await expect(main.getByText("Mañana", { exact: true })).toHaveCount(0);
      expect(
        adminApi.calls.some(
          (call) =>
            call.method === "POST" &&
            call.path === "/api/acquisition/new-releases/105/dismiss",
        ),
      ).toBe(true);
      for (const field of await main.locator(".crate-form-field").all())
        expect(
          await field.evaluate((el) => {
            const [label, control] = Array.from(el.children);
            return (
              control!.getBoundingClientRect().top -
              label!.getBoundingClientRect().bottom
            );
          }),
        ).toBe(8);
      for (const control of await main.locator("button,input").all())
        expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(
          44,
        );
      expect(
        await main
          .getByRole("heading", { level: 1 })
          .evaluate((el) => getComputedStyle(el).fontFamily),
      ).toContain("Bricolage");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
  });
}
