import { expect, test } from "@playwright/test";

test.describe("hero", () => {
  test("hands the static mark over to the particle field", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("canvas#field")).toHaveCount(1);
    await page.waitForTimeout(3000);
    await expect(page.locator(".mark-static")).toHaveCSS("opacity", "0");
  });

  test.describe("reduced motion", () => {
    test.use({ reducedMotion: "reduce" });

    test("keeps the static mark and leaves the words in place", async ({
      page,
    }) => {
      await page.goto("/");
      await page.waitForTimeout(3000);

      await expect(page.locator(".mark-static")).toBeVisible();
      await expect(page.locator(".mark-static")).toHaveCSS("opacity", "1");
      const words = page.locator(".hero-copy .w");
      expect(await words.count()).toBeGreaterThan(0);
      const transforms = await words.evaluateAll((elements) =>
        elements.map((element) => getComputedStyle(element).transform),
      );
      expect(new Set(transforms)).toEqual(new Set(["none"]));
    });
  });

  test.describe("install command", () => {
    test.use({ permissions: ["clipboard-read", "clipboard-write"] });

    test("copies the install command to the clipboard", async ({ page }) => {
      await page.goto("/");
      const button = page.locator(".hero-copy [data-copy]");
      const command = await button.getAttribute("data-copy");

      await button.click();

      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toBe(command);
    });
  });
});
