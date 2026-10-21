import { expect, test } from "@playwright/test";
for (const host of ["storybook", "standalone"] as const)
  for (const width of [375, 1200])
    test(`${host} visualizer settings ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const forbidden: string[] = [];
      page.on("request", (request) => {
        if (
          new URL(request.url()).pathname.startsWith("/api/") ||
          request.method() !== "GET"
        )
          forbidden.push(request.url());
      });
      await page.goto(
        host === "storybook"
          ? "/iframe.html?id=reviews-1be-player-visualizer--complete&viewMode=story"
          : "http://127.0.0.1:5186/review-1be-player-visualizer.html",
      );
      await expect(
        page.getByRole("heading", {
          name: "Visualizer and analysis",
          exact: true,
        }),
      ).toBeVisible({ timeout: 4000 });
      const settings = page.getByRole("region", {
        name: "Visualizer settings",
        exact: true,
      });
      const separation = settings.getByRole("slider", {
        name: "Separation",
        exact: true,
      });
      await expect(separation).toHaveValue("0.15");
      const gap = await separation.evaluate((el) => {
        const label = document.getElementById(
          el.getAttribute("aria-labelledby")!,
        )!;
        return (
          el.getBoundingClientRect().top - label.getBoundingClientRect().bottom
        );
      });
      expect(gap).toBeCloseTo(8, 0);
      const caption = settings.getByRole("heading", {
        name: "Visualizer settings",
        exact: true,
      });
      expect(
        await caption.evaluate((el) => getComputedStyle(el).textTransform),
      ).toBe("uppercase");
      await separation.focus();
      await page.keyboard.press("ArrowRight");
      await expect(separation).toHaveValue("0.16");
      await settings
        .getByRole("button", { name: "Reset", exact: true })
        .click();
      await expect(separation).toHaveValue("0.15");
      const scenario = page.getByRole("combobox", {
        name: "Scenario",
        exact: true,
      });
      const choose = async (value: string) => {
        await scenario.click();
        await page.getByRole("option", { name: value, exact: true }).click();
      };
      await choose("adaptive");
      await expect(settings.getByText(/Using track analysis/)).toBeVisible();
      await separation.focus();
      await page.keyboard.press("ArrowRight");
      const adapted = separation.locator("..");
      await expect(adapted).toContainText("0.25");
      await settings
        .getByRole("switch", { name: "Track adaptive", exact: true })
        .click();
      await expect(adapted).not.toContainText("0.25");
      await choose("waiting");
      await expect(
        settings.getByText("Adaptive on, waiting for track analysis", {
          exact: true,
        }),
      ).toBeVisible();
      await choose("zero");
      await expect(settings.getByText(/Using track analysis/)).toBeVisible();
      const glow = settings.getByRole("slider", { name: "Glow", exact: true });
      await expect(glow).toHaveValue("0");
      await choose("long");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page
        .getByRole("radio", { name: "Cover mode", exact: true })
        .click();
      await expect(separation).toBeDisabled();
      await expect(
        settings.getByText("Cover mode active", { exact: true }),
      ).toBeVisible();
      await page.getByRole("radio", { name: "CD mode", exact: true }).click();
      await expect(
        settings.getByText("CD mode active", { exact: true }),
      ).toBeVisible();
      await choose("unavailable");
      await expect(
        page.getByRole("radio", { name: "Visualizer mode", exact: true }),
      ).toHaveCount(0);
      expect(forbidden).toEqual([]);
    });

test.describe("touch targets", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 375, height: 812 },
  });
  for (const host of ["storybook", "standalone"] as const)
    test(`${host} visualizer touch targets`, async ({ page }) => {
      await page.goto(
        host === "storybook"
          ? "/iframe.html?id=reviews-1be-player-visualizer--complete&viewMode=story"
          : "http://127.0.0.1:5186/review-1be-player-visualizer.html",
      );
      const slider = page.getByRole("slider", { name: "Glow", exact: true });
      await expect(slider).toBeVisible();
      expect((await slider.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(
        (await page
          .getByRole("button", { name: "Reset", exact: true })
          .boundingBox())!.height,
      ).toBeGreaterThanOrEqual(44);
      const modes = page.getByRole("radiogroup");
      for (const radio of await modes.getByRole("radio").all())
        expect((await radio.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    });
});

for (const host of ["storybook", "standalone"] as const)
  test(`${host} production popover fits a short player and scrolls to the last slider`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1200, height: 430 });
    await page.goto(
      host === "storybook"
        ? "/iframe.html?id=reviews-1be-player-visualizer--complete&viewMode=story"
        : "http://127.0.0.1:5186/review-1be-player-visualizer.html",
    );
    await page
      .getByRole("button", { name: "Open player settings", exact: true })
      .click();
    const hostRegion = page.getByRole("region", {
      name: "Production popover",
      exact: true,
    });
    const popup = hostRegion.getByRole("dialog", {
      name: "Visualizer settings",
      exact: true,
    });
    const outer = (await hostRegion.boundingBox())!;
    const box = (await popup.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(outer.y + outer.height - 8);
    await popup.getByRole("slider", { name: "Octaves", exact: true }).focus();
    const last = (await popup
      .getByRole("slider", { name: "Octaves", exact: true })
      .boundingBox())!;
    expect(last.y + last.height).toBeLessThanOrEqual(box.y + box.height);
    expect(await popup.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  });
