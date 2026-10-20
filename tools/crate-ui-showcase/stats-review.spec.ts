import { expect, test } from "@playwright/test";
for (const host of ["storybook", "standalone"] as const)
  for (const width of [375, 1200]) {
    test(`${host} Stats states and real Digging ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const api: string[] = [];
      page.on("request", (request) => {
        if (
          new URL(request.url()).pathname.startsWith("/api/") ||
          request.method() !== "GET"
        )
          api.push(request.url());
      });
      await page.goto(
        host === "storybook"
          ? "/iframe.html?id=reviews-1be-stats--complete&viewMode=story"
          : "http://127.0.0.1:5186/review-1be-stats.html",
      );
      const review = page.getByRole("region", {
        name: "Stats presentation review",
      });
      await expect(
        review.getByRole("heading", { name: "30 days of signal" }),
      ).toBeVisible();
      const editorialGap = await review
        .locator(".stats-artist-of-period")
        .evaluate((element) => {
          const label = Array.from(
            document.querySelectorAll(".crate-mono-label"),
          ).find((node) => node.textContent === "Longest streak")!;
          return (
            label.closest('[data-slot="card"]')!.getBoundingClientRect().top -
            element.getBoundingClientRect().bottom
          );
        });
      expect(editorialGap).toBeCloseTo(16, 1);
      const readings = await review
        .locator("dl")
        .first()
        .locator(":scope > div")
        .evaluateAll((items) =>
          items.map((item) => {
            const value = item.querySelector("dd")!.getBoundingClientRect(),
              label = item.querySelector("dt")!.getBoundingClientRect();
            return {
              value: value.top,
              label: label.top,
              left: value.left,
              width: item.getBoundingClientRect().width,
            };
          }),
        );
      expect(readings).toHaveLength(5);
      for (const reading of readings)
        expect(reading.label).toBeGreaterThan(reading.value);
      expect(readings[1]!.left - readings[0]!.left).toBeGreaterThanOrEqual(
        readings[0]!.width + 35,
      );
      const launcher = review.getByRole("button", {
        name: "Open the story",
      });
      await launcher.click();
      const dialog = page.getByRole("dialog", { name: "Your Crate Digging" });
      await expect(dialog).toBeVisible();
      await expect(dialog.locator(".crate-mono-label").first()).toHaveCSS(
        "text-transform",
        "uppercase",
      );
      await dialog.press("ArrowRight");
      await expect(
        dialog.getByRole("heading", { name: "Converge" }),
      ).toBeVisible();
      for (let step = 0; step < 6; step++) await dialog.press("ArrowRight");
      await dialog.getByRole("button", { name: "Share to Instagram" }).click();
      await dialog.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(launcher).toBeFocused();
      await expect(
        review.getByRole("status", { name: "Stats fixture action" }),
      ).toContainText("Share prepared");
      const choose = async (label: string, value: string) => {
        await review
          .getByRole("combobox", { name: label, exact: true })
          .click();
        await page.getByRole("option", { name: value, exact: true }).click();
      };
      await choose("Stats scope", "global");
      await expect(launcher).toHaveCount(0);
      await expect(
        review.getByRole("link", { name: "Crate Pulse", exact: true }),
      ).toHaveAttribute("aria-current", "page");
      await choose("Stats scope", "user");
      await expect(
        review.getByRole("link", { name: "Back to profile" }),
      ).toBeVisible();
      await choose("Dashboard state", "pending");
      await expect(review.getByTestId("loading-state")).toBeVisible();
      await expect(review.getByTestId("empty-state")).toHaveCount(0);
      await choose("Dashboard state", "loading");
      await expect(review.getByTestId("loading-state")).toBeVisible();
      await expect(review.locator("dl")).toHaveCount(0);
      await choose("Dashboard state", "error");
      await review.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(review.getByRole("alert")).toHaveCount(0);
      await choose("Dashboard state", "empty");
      await expect(review.getByTestId("empty-state")).toBeVisible();
      await choose("Dashboard state", "legacy");
      await expect(review.locator(".stats-signal-svg")).toHaveCount(0);
      await expect(review.getByRole("meter")).toHaveCount(0);
      await choose("Dashboard state", "long and zero");
      await expect(
        review.getByRole("meter", { name: "Energy", exact: true }),
      ).toHaveAttribute("aria-valuenow", "0");
      const longName = review.getByRole("link", {
        name: /A very long artist name/,
      });
      expect(
        await longName.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(api).toEqual([]);
    });
  }
