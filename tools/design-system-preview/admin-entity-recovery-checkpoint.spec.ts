import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`artist and album recovery states fit at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/review-admin-entity-recovery.html");

    await expect(
      page.getByRole("heading", { name: "Artist unavailable" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Album not found" }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("group", { name: "Album not found" })
        .getByRole("link", { name: "Browse artists" }),
    ).toHaveAttribute("href", "/browse");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

test("retry returns a recoverable artist request to the caller", async ({
  page,
}) => {
  await page.goto("/review-admin-entity-recovery.html");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(
    page.getByRole("heading", { name: "Artist unavailable" }),
  ).toBeVisible();
});
