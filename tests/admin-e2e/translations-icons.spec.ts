import { expect, test } from "./fixtures";
import fixture from "./fixtures/translations-1an.json";
const root = "/api/admin/i18n/listen";
for (const width of [1440, 768, 390])
  test.describe(`Translations built Admin ${width}`, () => {
    test.use({ viewport: { width, height: 1100 } });
    test("retains real route, filters, editor, save and publish payloads", async ({
      page,
      adminApi,
      openAdminPage,
    }) => {
      for (const [path, body] of Object.entries(fixture))
        adminApi.respondTo(path.split("?")[0]!, body);
      adminApi.respondTo(
        root + "/quality",
        fixture[
          "/api/admin/i18n/listen/quality?locale=es&source_version=sha256%3Atest"
        ],
      );
      const detail = fixture["/api/admin/i18n/listen/bundles/bundle-es"];
      adminApi.respondTo(root + "/bundles/bundle-es/messages/player.play", {
        ...detail,
        messages: { ...detail.messages, "player.play": "Dale" },
      });
      adminApi.respondTo(root + "/bundles/bundle-es/publish", {
        ...detail,
        status: "published",
      });
      await openAdminPage("/i18n");
      const main = page.getByRole("main");
      await expect(
        main.getByRole("article", { name: "es locale health" }),
      ).toBeVisible();
      await expect(main.locator("svg")).toHaveCount(0);
      await main.getByRole("tab", { name: "Bundles", exact: true }).click();
      await main
        .getByRole("combobox", { name: "Locale", exact: true })
        .selectOption("es");
      await expect(
        main.getByRole("button", { name: "Review fr", exact: true }),
      ).toHaveCount(0);
      await main
        .getByRole("button", { name: "Review es", exact: true })
        .click();
      await expect(
        main.getByRole("textbox", { name: "Translation for player.play" }),
      ).toBeVisible();
      await expect(
        main.getByRole("button", {
          name: "Save player.play to workspace JSON",
          exact: true,
        }),
      ).toHaveCount(0);
      for (const field of await main.locator(".crate-form-field").all())
        expect(
          await field.evaluate((e) => {
            const [l, v] = Array.from(e.children);
            return (
              v!.getBoundingClientRect().top - l!.getBoundingClientRect().bottom
            );
          }),
        ).toBe(8);
      await main
        .getByRole("textbox", { name: "Translation for player.play" })
        .fill("Dale");
      await main
        .getByRole("button", { name: "Save player.play", exact: true })
        .click();
      await expect
        .poll(() =>
          adminApi.calls.find((c) => c.path.endsWith("/messages/player.play")),
        )
        .toEqual({
          method: "PATCH",
          path: root + "/bundles/bundle-es/messages/player.play",
          body: { value: "Dale" },
        });
      await expect(
        main.getByRole("button", { name: "Save player.play", exact: true }),
      ).toBeEnabled();
      await main
        .getByRole("button", { name: "Publish bundle", exact: true })
        .click();
      await expect
        .poll(() => adminApi.calls.find((c) => c.path.endsWith("/publish")))
        .toEqual({
          method: "POST",
          path: root + "/bundles/bundle-es/publish",
          body: null,
        });
      await expect(
        main.getByRole("button", { name: "Publish bundle", exact: true }),
      ).toBeDisabled();
      await expect(main.locator("svg")).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
  });
