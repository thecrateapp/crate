import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const story =
  "/iframe.html?id=reviews-admin-shell-solid--solid-headers&viewMode=story";

for (const width of [1440, 768, 390]) {
  test(`A1a solid shell stays legible at ${width}px`, async ({ page }) => {
    const apiRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/")) apiRequests.push(request.url());
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto(story);
    await expect(
      page.getByRole("heading", { name: "Navegación de Admin" }),
    ).toBeVisible();

    const expectedHeader =
      width < 768 ? "mobile-shell-header" : "desktop-shell-header";
    const hiddenHeader =
      width < 768 ? "desktop-shell-header" : "mobile-shell-header";
    const header = page.locator(`[data-admin-ux="${expectedHeader}"]`);
    await expect(header).toBeVisible();
    await expect(header).toHaveClass(/bg-app-surface/);
    await expect(header).toHaveCSS("backdrop-filter", "none");
    await expect(
      page.locator(`[data-admin-ux="${hiddenHeader}"]`),
    ).toBeHidden();

    if (width < 768) {
      await page.getByRole("button", { name: "Open navigation" }).click();
      const drawer = page.getByRole("dialog", { name: "Navigation" });
      await expect(drawer).toBeVisible();
      await expect(
        drawer.getByRole("navigation", { name: "Admin navigation" }),
      ).toBeVisible();
      await page.waitForTimeout(550);
    }

    expect(apiRequests).toEqual([]);
    const artifactDirectory = resolve(process.cwd(), ".artifacts/review");
    await mkdir(artifactDirectory, { recursive: true });
    await test.info().attach(`a1a-shell-${width}`, {
      body: await page.screenshot({
        path: resolve(artifactDirectory, `admin-shell-${width}.png`),
      }),
      contentType: "image/png",
    });
  });
}
