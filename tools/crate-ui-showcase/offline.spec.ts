import { expect, test, type Page } from "@playwright/test";
async function choose(page: Page, label: string, value: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: value, exact: true }).click();
}
for (const host of ["storybook", "standalone"] as const)
  for (const width of [375, 1200]) {
    test(`${host} offline ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 950 });
      const writes: string[] = [],
        errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("request", (r) => {
        if (
          r.method() !== "GET" ||
          new URL(r.url()).pathname.startsWith("/api/")
        )
          writes.push(r.url());
      });
      await page.goto(
        host === "storybook"
          ? "/iframe.html?id=reviews-1bd-offline--complete&viewMode=story"
          : "http://127.0.0.1:5186/review-1bd-offline.html",
      );
      await expect(
        page.getByRole("heading", { name: "Offline listening", exact: true }),
      ).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const storage = await page.evaluate(() =>
        JSON.stringify({ ...localStorage }),
      );
      const library = page.getByRole("group", {
        name: "Actual offline library",
        exact: true,
      });
      const rows = library.getByRole("listitem");
      await expect(rows).toHaveCount(3);
      for (const cover of await library
        .locator('[data-slot="media-cover"]')
        .all()) {
        const box = (await cover.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(48);
        expect(box.height).toBeGreaterThanOrEqual(48);
      }
      for (const row of [rows.nth(0), rows.nth(1)]) {
        const image = row.locator('[data-slot="media-cover"] img');
        await expect(image).toBeVisible();
        expect(
          await image.evaluate(
            (node: HTMLImageElement) => node.complete && node.naturalWidth > 0,
          ),
        ).toBe(true);
      }
      await expect(
        rows.last().locator('[data-slot="media-cover"]'),
      ).toHaveAttribute("data-state", "fallback");
      await expect(
        rows.first().locator('[data-track-slot="quality"]'),
      ).toContainText("FLAC 16/44.1");
      await expect(
        rows.first().locator('[data-track-slot="duration"]'),
      ).toHaveText("3:15");
      await expect(
        rows.last().locator('[data-track-slot="quality"]'),
      ).toBeEmpty();
      await expect(
        rows.last().locator('[data-track-slot="duration"]'),
      ).toBeEmpty();
      await rows
        .first()
        .getByRole("button", { name: "Play Marea — Costa Norte", exact: true })
        .click();
      await expect(rows.first()).toHaveAttribute("aria-current", "true");
      await expect(page.getByLabel("Offline playback event")).toHaveText(
        "Track played locally",
      );
      await rows
        .first()
        .getByRole("button", {
          name: "Pause: Marea — Costa Norte",
          exact: true,
        })
        .click();
      await expect(page.getByLabel("Offline playback event")).toHaveText(
        "Paused locally",
      );
      await choose(page, "Offline library state", "partial");
      await expect(rows).toHaveCount(1);
      await choose(page, "Offline library state", "empty");
      await expect(rows).toHaveCount(0);
      await expect(
        library.getByText("No playable downloads are available."),
      ).toBeVisible();
      await page
        .getByRole("tab", { name: "Downloads and storage", exact: true })
        .click();
      const management = page.getByRole("group", {
        name: "Actual offline management",
        exact: true,
      });
      const downloads = management.getByRole("group", {
        name: "Downloads on this device",
        exact: true,
      });
      await expect(downloads.locator('[data-slot="entity-row"]')).toHaveCount(
        5,
      );
      const value = management
        .getByRole("meter", { name: "Storage", exact: true })
        .locator(".crate-meter-value");
      const valueGeometry = await value.evaluate((node) => ({
        height: node.getBoundingClientRect().height,
        line: Number.parseFloat(getComputedStyle(node).lineHeight),
      }));
      expect(valueGeometry.height).toBeLessThanOrEqual(valueGeometry.line + 1);
      if (width === 1200) {
        const tracksBox = await management
          .getByRole("meter", { name: "Tracks", exact: true })
          .boundingBox();
        const storageBox = await management
          .getByRole("meter", { name: "Storage", exact: true })
          .boundingBox();
        expect(storageBox!.height).toBeCloseTo(tracksBox!.height, 0);
      }
      const progress = downloads.getByRole("progressbar").first();
      await expect(progress).toHaveAttribute("aria-valuenow", "60");
      await expect(progress).toHaveAttribute(
        "aria-valuetext",
        "6 / 10 tracks available",
      );
      await expect(
        downloads.getByText("Needs attention", { exact: true }),
      ).toBeVisible();
      await expect(
        downloads.getByText("Available offline", { exact: true }),
      ).toBeVisible();
      await management
        .getByRole("button", { name: "Sync offline copy now", exact: true })
        .click();
      await expect(page.getByLabel("Offline storage event")).toHaveText(
        "Sync requested locally",
      );
      await management
        .getByRole("button", { name: "Remove offline copies", exact: true })
        .click();
      await expect(page.getByLabel("Offline storage event")).toHaveText(
        "Local copies removal requested",
      );
      await choose(page, "Offline storage state", "unknown total");
      await expect(downloads.getByText("Total size 0 B")).toHaveCount(0);
      await expect(downloads.getByRole("progressbar")).not.toHaveAttribute(
        "aria-valuenow",
      );
      await choose(page, "Offline storage state", "read-only");
      await expect(
        management.getByRole("button", { name: "Sync offline copy now" }),
      ).toBeDisabled();
      await expect(
        management.getByRole("button", { name: "Remove offline copies" }),
      ).toBeDisabled();
      await choose(page, "Offline storage state", "unsupported");
      await expect(
        management.getByText(
          "Offline mirror is not available in this environment.",
        ),
      ).toBeVisible();
      await expect(
        management.getByRole("button", { name: "Remove offline copies" }),
      ).toBeDisabled();
      await choose(page, "Offline storage state", "mixed");
      await page
        .getByRole("checkbox", { name: "Known browser quota" })
        .uncheck();
      await expect(
        management.getByRole("meter", { name: "Storage", exact: true }),
      ).toHaveCount(0);
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
      expect(
        await page.evaluate(() => JSON.stringify({ ...localStorage })),
      ).toBe(storage);
      expect(writes).toEqual([]);
      expect(errors).toEqual([]);
      await page.screenshot({
        path: `.artifacts/review/1bd-offline-${host}-${width}.png`,
      });
    });
  }

for (const host of ["storybook", "standalone"] as const)
  test(`${host} localized meters keep rails and alignment at704px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 704, height: 950 });
    await page.goto(
      host === "storybook"
        ? "/iframe.html?id=reviews-1bd-offline--complete&viewMode=story&args=locale:eu"
        : "http://127.0.0.1:5186/review-1bd-offline.html?locale=eu",
    );
    await page
      .getByRole("tab", { name: "Downloads and storage", exact: true })
      .click();
    await page.evaluate(() => document.fonts.ready);
    const management = page.getByRole("group", {
      name: "Actual offline management",
    });
    const meters = management.getByRole("meter");
    await expect(meters).toHaveCount(2);
    await expect(
      management.getByText("Biltegiratzea", { exact: true }),
    ).toBeVisible();
    const geometry = await meters.evaluateAll((nodes) =>
      nodes.map((node) => ({
        height: node.getBoundingClientRect().height,
        rail: node.querySelector(".crate-meter-track")!.getBoundingClientRect()
          .width,
        value: node.querySelector(".crate-meter-value")!.getBoundingClientRect()
          .height,
        line: Number.parseFloat(
          getComputedStyle(node.querySelector(".crate-meter-value")!)
            .lineHeight,
        ),
      })),
    );
    expect(geometry[1]!.height).toBeCloseTo(geometry[0]!.height, 0);
    for (const meter of geometry) {
      expect(meter.rail).toBeGreaterThanOrEqual(40);
      expect(meter.value).toBeLessThanOrEqual(meter.line + 1);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
