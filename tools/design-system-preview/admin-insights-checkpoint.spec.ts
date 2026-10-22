import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`Insights retain real charts and snapshot status at ${width}px`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 1100 });
    await page.goto("/admin-insights-demo.html");

    await expect(
      page.getByRole("heading", { name: "Insights", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toContainText(
      "Insights could not refresh. Showing the last successful snapshot.",
    );
    await expect(
      page.getByText("post-metal", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Genre Footprint" }),
    ).toBeVisible();
    await expect(page.getByText("Signal Brief", { exact: true })).toHaveCount(
      0,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
}
