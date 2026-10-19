import { expect, test } from "@playwright/test";
for (const host of ["storybook", "standalone"] as const) {
  for (const width of [375, 1200]) {
    test(`${host} Home/Library roles and read/action states ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      const apiRequests: string[] = [];
      const errors: string[] = [];
      page.on("request", (request) => {
        if (new URL(request.url()).pathname.startsWith("/api/"))
          apiRequests.push(request.url());
      });
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(
        host === "storybook"
          ? "/iframe.html?id=reviews-1bb-home-library--complete&viewMode=story"
          : "http://127.0.0.1:5186/review-1bb-home-library.html",
      );
      await expect(
        page.getByRole("heading", { name: "Good evening, Alex" }),
      ).toHaveCSS("font-family", /Bricolage/);
      for (const text of [
        "84 plays",
        "2 albums · 0 tracks",
        "12 tracks · 52m",
        "Purchases",
      ]) {
        await expect(page.getByText(text, { exact: true })).toHaveCSS(
          "text-transform",
          "uppercase",
        );
        await expect(page.getByText(text, { exact: true })).toHaveCSS(
          "font-family",
          /JetBrains/,
        );
        await expect(page.getByText(text, { exact: true })).toHaveCSS(
          "font-size",
          "11px",
        );
      }
      const labelGaps = await page
        .locator('[data-slot="form-field"]')
        .evaluateAll((fields) =>
          fields.map((field) => {
            const label = field.querySelector(
              '[data-slot="form-field-label"]',
            )!;
            const group = field.querySelector(
              '[role="group"], [role="combobox"]',
            )!;
            return (
              group.getBoundingClientRect().top -
              label.getBoundingClientRect().bottom
            );
          }),
        );
      for (const gap of labelGaps) expect(gap).toBe(8);
      const follow = page.getByRole("button", { name: "Follow Chelsea Wolfe" });
      await follow.focus();
      await expect(page.getByRole("tooltip")).toHaveText("Follow");
      const exports = page.getByRole("button", {
        name: "Export: Night music",
        exact: true,
      });
      const exportSize = await exports.boundingBox();
      expect(exportSize?.height).toBe(44);
      expect(exportSize?.width).toBe(44);
      await expect(
        page.getByRole("button", {
          name: "Export: Pending record",
          exact: true,
        }),
      ).toBeDisabled();
      for (const cover of await page
        .locator('[data-slot="entity-row"] [data-slot="media-cover"]')
        .all()) {
        const size = await cover.boundingBox();
        expect(size?.height).toBe(56);
        expect(size?.width).toBe(56);
      }
      await exports.click();
      await expect(page.getByLabel("Fixture action")).toHaveText(
        "Export Night music requested",
      );
      await page
        .getByRole("button", { name: "Remove contribution: Night music" })
        .click();
      const dialog = page.getByRole("alertdialog", {
        name: "Remove contribution?",
      });
      await expect(dialog).toBeVisible();
      await page.getByRole("button", { name: "Keep it" }).click();
      await expect(dialog).not.toBeVisible();
      await expect(
        page.getByRole("button", { name: "Remove contribution: Night music" }),
      ).toBeFocused();
      const state = page.getByRole("combobox", { name: "Read state" });
      await state.click();
      await page.getByRole("option", { name: "loading", exact: true }).click();
      await expect(page.getByTestId("loading-state")).toBeVisible();
      await state.click();
      await page.getByRole("option", { name: "error", exact: true }).click();
      await expect(page.getByRole("alert")).toBeVisible();
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(page.getByLabel("Fixture action")).toHaveText(
        "Read retried",
      );
      await page
        .getByRole("button", { name: "Remove contribution: Night music" })
        .click();
      await page
        .getByRole("button", { name: "Remove contribution", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Remove contribution", exact: true }),
      ).toBeDisabled();
      await expect(page.getByLabel("Fixture action")).toHaveText(
        "Contribution removed in fixture",
      );
      await expect(
        page.getByText("No contributions", { exact: true }),
      ).toBeVisible();
      const columns = await page
        .locator('[data-slot="crate-index-grid"]')
        .evaluate(
          (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
        );
      expect(columns).toBe(width < 640 ? 2 : 6);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(apiRequests).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}
