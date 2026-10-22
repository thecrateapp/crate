import { expect, test } from "@playwright/test";

for (const width of [1440, 768, 390]) {
  test(`Staged imports remain usable at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    const apiRequests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/"))
        apiRequests.push(request.url());
    });
    await page.setViewportSize({ width, height: 1100 });
    await page.goto("/admin-imports-demo.html");

    const real = page.getByRole("region", {
      name: "Página real de Staged Imports",
    });
    await expect(
      real.getByRole("heading", { level: 1, name: "Staged Imports" }),
    ).toBeVisible();
    await expect(real.getByText("Elsewhere", { exact: true })).toBeVisible();
    await expect(
      real.getByText("Quiet Passage", { exact: true }),
    ).toBeVisible();
    await real.getByRole("button", { name: /Importing/ }).click();
    await expect(real.getByText("Slow Bloom", { exact: true })).toBeVisible();
    await expect(
      real.getByRole("tree", { name: "Catalog file map" }),
    ).toContainText(".crate/album.json");
    await expect(real.getByTestId("portable-json-viewer")).toContainText(
      '"schema_version": 1',
    );

    await real.getByRole("button", { name: /Pending/ }).click();
    const pending = real.locator("article").filter({ hasText: "Elsewhere" });
    await pending.getByRole("button", { name: "Import album" }).click();
    await expect(page.getByText("Import queued for Elsewhere")).toBeVisible();
    await expect(page.getByText("sample-import-1")).toHaveCount(0);

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    expect(apiRequests).toEqual([]);
  });
}
