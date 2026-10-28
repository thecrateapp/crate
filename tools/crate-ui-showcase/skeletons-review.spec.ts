import { expect, test } from "@playwright/test";
for (const host of ["storybook", "standalone"] as const)
  for (const width of [375, 1200]) {
    test(`${host} meaningful skeletons ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const writes: string[] = [];
      page.on("request", (request) => {
        if (
          new URL(request.url()).pathname.startsWith("/api/") ||
          request.method() !== "GET"
        )
          writes.push(request.url());
      });
      await page.goto(
        host === "storybook"
          ? "/iframe.html?id=reviews-1be-stats--complete&viewMode=story"
          : "http://127.0.0.1:5186/review-1be-stats.html",
      );
      await expect(
        page.getByRole("heading", { name: "Stats, Crate Digging and loading" }),
      ).toBeVisible();
      const searches = page.getByRole("region", {
        name: "Search loading review",
      });
      for (const label of [
        "Finding your music...",
        "Finding albums...",
        "Finding artists...",
        "Finding tracks...",
      ]) {
        const loading = searches.getByRole("status", {
          name: label,
          exact: true,
        });
        await expect(loading).toBeVisible();
        const outer = await loading.boundingBox();
        const beam = await loading
          .locator(".crate-progress-hairline")
          .boundingBox();
        expect(beam!.width).toBeCloseTo(outer!.width, 0);
      }
      await searches
        .getByRole("button", { name: "Toggle global search loading" })
        .click();
      const global = page
        .locator(".crate-overlay-surface")
        .getByRole("status", { name: "Finding your music..." });
      await expect(global).toBeVisible();
      const globalWidths = await global.evaluate((element) => ({
        content:
          element.clientWidth -
          parseFloat(getComputedStyle(element).paddingLeft) -
          parseFloat(getComputedStyle(element).paddingRight),
        beam: parseFloat(
          getComputedStyle(element.querySelector(".crate-progress-hairline")!)
            .width,
        ),
      }));
      expect(globalWidths.beam).toBeCloseTo(globalWidths.content, 0);
      await searches
        .getByRole("button", { name: "Toggle global search loading" })
        .click();
      const settings = page.getByRole("group", {
        name: "Actual connection settings while loading",
        exact: true,
      });
      await expect(
        settings.locator('[data-slot="skeleton-table"]'),
      ).toHaveCount(0);
      await expect(
        settings.getByText("Loading...", { exact: true }).first(),
      ).toBeVisible();
      const table = page.getByRole("group", {
        name: "Known table layout",
        exact: true,
      });
      await expect(table.locator('tbody [data-slot="skeleton"]')).toHaveCount(
        9,
      );
      expect(await table.locator("table").textContent()).toBe("");
      for (const block of await table.locator('[data-slot="skeleton"]').all()) {
        expect((await block.boundingBox())!.height).toBeGreaterThanOrEqual(12);
        await expect(block).not.toHaveCSS(
          "background-color",
          "rgba(0, 0, 0, 0)",
        );
      }
      await expect(table.getByRole("status")).toHaveCount(1);
      const generic = page.getByRole("group", {
        name: "Generic section loading",
        exact: true,
      });
      await expect(generic.locator("table")).toHaveCount(0);
      await expect(generic.getByRole("status")).toHaveCount(1);
      const gaps = await page
        .locator('[data-slot="form-field"][data-layout="stacked"]')
        .evaluateAll((fields) =>
          fields.map((field) => {
            const label = field.querySelector(
              '[data-slot="form-field-label"]',
            )!;
            return (
              label.nextElementSibling!.getBoundingClientRect().top -
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
      expect(writes).toEqual([]);
    });
  }
