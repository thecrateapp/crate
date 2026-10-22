import { expect, test } from "@playwright/test";

for (const width of [1440, 768, 390]) {
  test(`A5 Contributions story works at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    const unexpectedRequests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/") || url.port === "5174")
        unexpectedRequests.push(request.url());
    });
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(
      "/iframe.html?id=reviews-admin-a5-contributions--complete&viewMode=story",
    );

    const review = page.getByRole("region", {
      name: "Contributions page",
      exact: true,
    });
    await expect(
      review.getByRole("heading", { name: "Contributions", level: 1 }),
    ).toBeVisible();
    await expect(review.getByRole("listitem")).toHaveCount(4);
    await expect(
      review.getByRole("link", { name: "Luz de octubre", exact: true }),
    ).toHaveAttribute("href", "/artists/costa-norte/luz-de-octubre");
    await expect(review.getByText("Bandcamp", { exact: true })).toBeVisible();
    await expect(review.getByText("8 tracks", { exact: true })).toBeVisible();
    await expect(review.getByText("curadora@example.test")).toBeVisible();
    await expect(
      review.getByText("Refresh failed · showing last results"),
    ).toHaveCount(0);

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const layout = await review.evaluate((element) => {
      const list = element.querySelector(
        '[aria-label="Community library contributions"]',
      )!;
      return {
        pageWidth: element.getBoundingClientRect().width,
        listWidth: list.getBoundingClientRect().width,
      };
    });
    expect(layout.listWidth).toBeLessThanOrEqual(layout.pageWidth + 1);

    await page.getByRole("radio", { name: "Loading", exact: true }).click();
    await expect(
      review.getByText("Loading contributions...", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Complete sample read" }).click();
    await expect(review.getByRole("listitem")).toHaveCount(4);

    await page.getByRole("radio", { name: "Empty", exact: true }).click();
    await expect(
      review.getByText("No contributions yet", { exact: true }),
    ).toBeVisible();
    await page.getByRole("radio", { name: "Error", exact: true }).click();
    await expect(review.getByRole("alert")).toContainText(
      "Contributions unavailable",
    );
    await expect(
      review.getByText("No contributions yet", { exact: true }),
    ).toHaveCount(0);
    expect(errors).toEqual([]);
    expect(unexpectedRequests).toEqual([]);
  });
}
