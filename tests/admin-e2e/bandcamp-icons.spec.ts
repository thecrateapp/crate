import { expect, test } from "./fixtures";
import fixture from "./fixtures/bandcamp-1ah.json";
for (const width of [1440, 768, 390]) {
  test.describe(`Bandcamp Admin ${width}`, () => {
    test.use({ viewport: { width, height: 1100 } });
    test("retains real route, data, busy action and request contracts", async ({
      page,
      adminApi,
      openAdminPage,
    }) => {
      for (const [path, value] of Object.entries(fixture))
        adminApi.respondTo(new URL(path, "http://sample.test").pathname, value);
      let release: (() => void) | undefined;
      await page.route("**/api/bandcamp/me/sync", async (route) => {
        expect(route.request().method()).toBe("POST");
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        await route.fulfill({ json: { task_id: "bandcamp-browser-task" } });
      });
      await openAdminPage("/bandcamp");
      const main = page.getByRole("main").last();
      await expect(main.getByRole("heading", { level: 1 })).toHaveText(
        "Support layer for the collection",
      );
      await expect(
        main.getByText("Diego de muestra", { exact: true }),
      ).toBeVisible();
      await expect(main.getByText("92%", { exact: true })).toBeVisible();
      await expect(main.locator("svg:not([data-admin-ux])")).toHaveCount(0);
      const button = main.getByRole("button", {
        name: "Sync collection",
        exact: true,
      });
      await button.focus();
      await page.keyboard.press("Enter");
      await expect(button).toHaveAttribute("aria-busy", "true");
      await expect(
        main.getByRole("button", { name: "Confirm", exact: true }).first(),
      ).toBeDisabled();
      await expect.poll(() => typeof release).toBe("function");
      release!();
      await expect(button).toBeEnabled();
      await expect(
        page.getByText("Bandcamp sync queued (bandcamp-browser-task)", {
          exact: true,
        }),
      ).toBeVisible();
      expect(
        await main
          .locator(".crate-form-field")
          .first()
          .evaluate((element) => {
            const [label, value] = Array.from(element.children);
            return (
              value!.getBoundingClientRect().top -
              label!.getBoundingClientRect().bottom
            );
          }),
      ).toBe(8);
      expect(
        await main
          .getByRole("heading", { level: 1 })
          .evaluate((element) => getComputedStyle(element).fontFamily),
      ).toContain("Bricolage");
      for (const control of await main.getByRole("button").all())
        expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(
          44,
        );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    });
  });
}
