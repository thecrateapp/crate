import { expect, test } from "@playwright/test";
for (const [host, url] of [
  [
    "storybook",
    "/iframe.html?id=reviews-1bc-radio-paths--complete&viewMode=story",
  ],
  ["standalone", "http://127.0.0.1:5186/review-1bc-radio-paths.html"],
])
  for (const width of [375, 1200]) {
    test(`${host} path identity starts the header at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(url!);
      const heading = page.getByRole("heading", {
        name: "Ambient → Costa Norte",
        exact: true,
      });
      await expect(heading).toBeVisible({ timeout: 20000 });
      const header = page.getByTestId("page-header").filter({ has: heading });
      await expect(header.locator(":scope > :first-child")).toHaveAttribute(
        "data-slot",
        "page-header-layout",
      );
      await expect(header.getByRole("link")).toHaveCount(0);
      await expect(
        header.getByRole("button", { name: "Regenerate", exact: true }),
      ).toBeVisible();
      await expect(
        header.getByRole("button", { name: "Delete", exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
  }
