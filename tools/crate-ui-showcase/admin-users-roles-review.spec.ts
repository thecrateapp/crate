import { expect, test } from "@playwright/test";

for (const width of [1440, 768, 390]) {
  test(`A5 Users and Roles stories render at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    const unexpectedRequests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/") || url.hostname !== "127.0.0.1")
        unexpectedRequests.push(request.url());
    });
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(
      "/iframe.html?id=reviews-admin-a5-users-roles--user-directory&viewMode=story",
    );
    await expect(
      page.getByRole("heading", { name: "Ada Costa" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);

    await page.goto(
      "/iframe.html?id=reviews-admin-a5-users-roles--permission-matrix&viewMode=story",
    );
    await expect(
      page.getByRole("table", { name: "library capabilities by role" }),
    ).toBeVisible();
    expect(errors).toEqual([]);
    expect(unexpectedRequests).toEqual([]);
  });
}
