import { expect, test } from "@playwright/test";
for (const host of ["storybook", "standalone"] as const)
  for (const width of [375, 760, 1200]) {
    test(`${host} Stats rows ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(
        host === "storybook"
          ? "/iframe.html?id=reviews-1be-stats-drift--complete&viewMode=story"
          : "http://127.0.0.1:5186/review-1be-stats-drift.html",
      );
      await expect(
        page.getByRole("heading", { name: "Stats row consistency" }),
      ).toBeVisible({ timeout: 15000 });
      const rows = page.locator(".track-row");
      await expect(rows).toHaveCount(3);
      await expect(
        rows.nth(0).getByRole("button", { name: "Play Darkness" }),
      ).toBeEnabled();
      await expect(rows.nth(2).getByRole("button")).toBeDisabled();
      if (width === 1200) {
        await expect(
          rows.first().locator('[data-track-slot="quality"]'),
        ).toHaveText("Hi-Res 24/96");
        for (const slot of [
          "quality",
          "analysis",
          "duration",
          "like",
          "actions",
        ]) {
          const x = await rows
            .locator(`[data-track-slot="${slot}"]`)
            .evaluateAll((els) =>
              els.map((e) => e.getBoundingClientRect().left),
            );
          expect(Math.max(...x) - Math.min(...x)).toBeLessThan(1);
        }
      }
      const meta = page.getByText("+6 plays", { exact: true });
      const type = await meta.evaluate((e) => ({
        font: getComputedStyle(e).fontFamily,
        transform: getComputedStyle(e).textTransform,
      }));
      expect(type.font).toContain("JetBrains");
      expect(type.transform).toBe("uppercase");
      await rows.first().getByRole("button").click();
      await expect(page.getByRole("status")).toHaveText("Play Darkness");
      await page.getByRole("radio", { name: "Older server" }).click();
      await expect(
        page.getByText("Detailed history isn't available on this server yet."),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await expect(page.getByRole("main").locator("[title]")).toHaveCount(0);
    });
  }
