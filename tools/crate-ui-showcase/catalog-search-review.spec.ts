import { expect, test } from "@playwright/test";
for (const host of ["storybook", "standalone"] as const)
  for (const width of [375, 1200]) {
    test(`${host} domain search kinds and retained playlist covers ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      const errors: string[] = [],
        requests: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (new URL(request.url()).pathname.startsWith("/api/"))
          requests.push(request.url());
      });
      await page.goto(
        host === "storybook"
          ? "http://127.0.0.1:6006/iframe.html?id=listen-catalog-search--all-kinds&viewMode=story"
          : "http://127.0.0.1:5186/review-1bb-catalog-search.html",
      );
      await expect(
        page.getByRole("heading", { name: "Catalog search", exact: true }),
      ).toBeVisible({ timeout: 30000 });
      await expect(
        page.locator('[data-slot="catalog-search"] [data-kind]'),
      ).toHaveCount(3);
      const result = page.getByRole("button", {
        name: "Talk For Hours",
        exact: true,
      });
      const src = await result.locator("img").getAttribute("src");
      await expect(result.locator('[data-slot="media-cover"]')).toHaveCSS(
        "width",
        "48px",
      );
      await result.click();
      const remove = page.getByRole("button", {
        name: "Remove Talk For Hours",
        exact: true,
      });
      const selected = page
        .locator('[data-slot="entity-row"]')
        .filter({ has: remove });
      await expect(selected.locator("img")).toHaveAttribute("src", src!);
      await expect(remove).toHaveCSS("width", "44px");
      await page
        .getByRole("checkbox", { name: "artist", exact: true })
        .uncheck();
      await page
        .getByRole("checkbox", { name: "album", exact: true })
        .uncheck();
      await expect(
        page.locator('[data-slot="catalog-search"] [data-kind]'),
      ).toHaveCount(1);
      await expect(
        page.locator('[data-slot="catalog-search"] [data-kind="track"]'),
      ).toBeVisible();
      await page.getByRole("checkbox", { name: "album", exact: true }).check();
      await expect(
        page.locator('[data-slot="catalog-search"] [data-kind]'),
      ).toHaveCount(2);
      const read = page.getByRole("combobox", {
        name: "Read state",
        exact: true,
      });
      await read.click();
      await page.getByRole("option", { name: "loading", exact: true }).click();
      await expect(page.getByTestId("loading-state")).toBeVisible();
      await expect(result).toBeVisible();
      await read.click();
      await page.getByRole("option", { name: "error", exact: true }).click();
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(result).toBeVisible();
      const gaps = await page
        .locator('[data-slot="form-field"][data-layout="stacked"]')
        .evaluateAll((fields) =>
          fields.map((field) => {
            const label = field.querySelector(
                '[data-slot="form-field-label"]',
              )!,
              control = Array.from(field.children).find(
                (child) => child !== label,
              )!;
            return (
              control.getBoundingClientRect().top -
              label.getBoundingClientRect().bottom
            );
          }),
        );
      for (const gap of gaps) expect(gap).toBeCloseTo(8, 1);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(requests).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
