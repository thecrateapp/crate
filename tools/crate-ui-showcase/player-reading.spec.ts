import { expect, test } from "@playwright/test";
for (const host of ["storybook", "standalone"] as const)
  for (const width of [375, 1200]) {
    test(`${host} Lyrics and Info ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const requests: string[] = [];
      page.on("request", (request) => {
        if (
          new URL(request.url()).pathname.startsWith("/api/") ||
          request.method() !== "GET"
        )
          requests.push(request.url());
      });
      await page.goto(
        host === "storybook"
          ? "/iframe.html?id=reviews-1be-player-reading--complete&viewMode=story"
          : "http://127.0.0.1:5186/review-1be-player-reading.html",
      );
      await expect(
        page.getByRole("heading", { name: "Lyrics and track information" }),
      ).toBeVisible();
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      const choose = async (label: string, value: string) => {
        await page.getByRole("combobox", { name: label, exact: true }).click();
        await page.getByRole("option", { name: value, exact: true }).click();
      };
      const lyrics = page.getByRole("region", { name: "Lyrics preview" });
      const line = lyrics.getByRole("button", {
        name: "A little closer to the sea",
      });
      await line.click();
      await expect(line).toHaveAttribute("aria-current", "true");
      expect((await line.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      const info = page.getByRole("region", { name: "Info preview" });
      await expect(
        info.locator('[data-quality-tier="hi-res"]').first(),
      ).toContainText("24/96");
      await expect(
        info.getByRole("meter", { name: "Energy", exact: true }),
      ).toHaveAttribute("aria-valuenow", "0.8");
      await info
        .getByRole("button", { name: "Open artist Costa Norte" })
        .click();
      await expect(
        page.getByRole("status", { name: "Local fixture action" }),
      ).toContainText("Open artist");
      const panel = info.getByRole("region", {
        name: "Audio Profile",
        exact: true,
      });
      const alignment = await panel.evaluate((element) => {
        const title = element.querySelector("h3")!;
        const meter = element.querySelector('[role="meter"]')!;
        return {
          title: title.getBoundingClientRect().left,
          content: meter.getBoundingClientRect().left,
          color: getComputedStyle(title).color,
          accent: getComputedStyle(element)
            .getPropertyValue("--accent-action-hi")
            .trim(),
        };
      });
      expect(alignment.title).toBeCloseTo(alignment.content, 1);
      await expect(panel.getByRole("heading")).toHaveClass(
        /text-accent-action-hi/,
      );
      await expect(info.locator(".genre-pill").first()).toContainText("80%");
      await choose("Info state", "delivery");
      await expect(
        info.locator('[data-quality-origin="stream"]'),
      ).toContainText("AAC 192");
      await expect(
        info
          .getByRole("region", { name: "Source & Dynamics" })
          .locator('[data-quality-origin="source"]'),
      ).toContainText("24/96");
      await choose("Info state", "zero");
      await expect(
        info.getByRole("meter", { name: "Energy", exact: true }),
      ).toHaveAttribute("aria-valuenow", "0");
      await expect(
        info.getByRole("region", { name: "Reach", exact: true }),
      ).toContainText("0");
      await choose("Info state", "partial");
      await expect(info.locator("[data-quality-tier]")).toHaveCount(0);
      await expect(info.getByRole("meter")).toHaveCount(0);
      await choose("Info state", "long");
      await choose("Lyrics state", "plain");
      await expect(lyrics.locator("pre")).toContainText(
        "Keep the Original Case",
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await choose("Lyrics state", "loading");
      const beam = lyrics.locator(".crate-loading-section-full");
      await expect(beam).toBeVisible();
      const sizes = await beam.evaluate((element) => ({
        width: element.getBoundingClientRect().width,
        panel: element.parentElement!.getBoundingClientRect().width,
      }));
      expect(sizes.width).toBeCloseTo(sizes.panel, 0);
      await choose("Lyrics state", "error");
      await lyrics.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(
        lyrics.getByRole("button", { name: "A little closer to the sea" }),
      ).toBeVisible();
      await choose("Lyrics state", "empty");
      await expect(lyrics.getByRole("status")).toContainText("No lyrics found");
      await choose("Info state", "error");
      await expect(info.getByRole("alert")).toBeVisible();
      await info.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(
        info.getByRole("heading", { name: "Low Tide", exact: true }),
      ).toBeVisible();
      const gap = await page
        .getByRole("combobox", { name: "Info state", exact: true })
        .evaluate((el) => {
          const field = el.closest(".crate-form-field")!;
          return (
            el.getBoundingClientRect().top -
            field
              .querySelector('[data-slot="form-field-label"]')!
              .getBoundingClientRect().bottom
          );
        });
      expect(gap).toBeCloseTo(8, 1);
      expect(requests).toEqual([]);
    });
  }

for (const host of ["storybook", "standalone"] as const) {
  test(`${host} fullscreen reading states and unframed timed wrapping`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(
      host === "storybook"
        ? "/iframe.html?id=reviews-1be-player-reading--complete&viewMode=story"
        : "http://127.0.0.1:5186/review-1be-player-reading.html",
    );
    const choose = async (label: string, value: string) => {
      await page.getByRole("combobox", { name: label, exact: true }).click();
      await page.getByRole("option", { name: value, exact: true }).click();
    };
    await choose("Lyrics placement", "fullscreen");
    const surface = page
      .getByRole("region", { name: "Lyrics preview" })
      .locator('[data-slot="player-lyrics-surface"]');
    for (const state of ["plain", "loading", "error", "empty"]) {
      await choose("Lyrics state", state);
      await expect(surface).toHaveCSS("mask-image", "none");
    }
  });
  test(`${host} timed lyrics wrap without a Card ancestor`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto(
      host === "storybook"
        ? "/iframe.html?id=reviews-1be-player-reading--complete&viewMode=story"
        : "http://127.0.0.1:5186/review-1be-player-reading.html",
    );
    await page
      .getByRole("checkbox", {
        name: "Plain lyrics host (no Card)",
        exact: true,
      })
      .click();
    await page
      .getByRole("combobox", { name: "Lyrics state", exact: true })
      .click();
    await page
      .getByRole("option", { name: "long synced", exact: true })
      .click();
    const surface = page
      .getByRole("region", { name: "Lyrics preview" })
      .locator('[data-slot="player-lyrics-surface"]');
    const dimensions = await surface.evaluate((element) => ({
      scroll: element.scrollWidth,
      client: element.clientWidth,
      cards: !!element.closest('[data-slot="card"]'),
    }));
    expect(dimensions.cards).toBe(false);
    expect(dimensions.client).toBeLessThan(375);
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client);
    const row = surface.locator("button[data-lyric-line]");
    const rowDimensions = await row.evaluate((element) => ({
      scroll: element.scrollWidth,
      client: element.clientWidth,
    }));
    expect(rowDimensions.scroll).toBeLessThanOrEqual(rowDimensions.client);
  });
}
