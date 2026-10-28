import { expect, test } from "@playwright/test";

for (const width of [1440, 768, 390]) {
  test(`Browse and Genres stay usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1100 });
    await page.goto("/review-admin-catalog.html");

    await expect(
      page.getByRole("heading", { level: 1, name: "Browse Artists" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Artist catalog" }),
    ).toBeVisible();
    await expect(page.getByText("Converge", { exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);

    await page.getByRole("link", { name: "Genres" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Genres" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Explore Taxonomy" }),
    ).toBeVisible();
    await page.getByPlaceholder("Filter genres...").fill("ambient");
    await expect(
      page.getByRole("heading", { name: "No genres match this search" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(page.getByText("Mathcore", { exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

test("the catalog review scene makes no API calls or browser errors", async ({
  page,
}) => {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.url().includes("/api/")) requests.push(request.url());
  });
  await page.goto("/review-admin-catalog.html");
  await expect(
    page.getByRole("heading", { level: 1, name: "Browse Artists" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  expect(requests).toEqual([]);
});
