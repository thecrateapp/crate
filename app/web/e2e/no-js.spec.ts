import { expect, test } from "@playwright/test";

const REVEALED = [
  "[data-enter]",
  ".features li",
  ".figure",
  ".endpoints li",
  ".dive-card",
];

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  for (const path of [
    "/",
    "/listen",
    "/architecture",
    "/developers",
    "/install",
  ]) {
    test(`${path} shows its copy without waiting for motion`, async ({
      page,
    }) => {
      await page.goto(path);

      await expect(page.locator("html")).not.toHaveClass(/\bjs\b/);
      const hidden = await page.evaluate(
        (selectors) =>
          [...document.querySelectorAll<HTMLElement>(selectors.join(","))]
            .filter((element) => getComputedStyle(element).opacity !== "1")
            .map((element) => element.textContent?.trim().slice(0, 40)),
        REVEALED,
      );
      expect(hidden).toEqual([]);
      await expect(page.locator("h1")).toBeVisible();
    });
  }

  test("the hero copy and statement are readable", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator(".hero-copy h1")).toHaveText(/\S/);
    await expect(page.locator(".hero-copy .sub")).toHaveText(/\S/);
    await expect(page.locator(".hero-copy [data-copy]")).toHaveCSS(
      "opacity",
      "1",
    );
    const statement = page.locator(".statement p:not(.eyebrow)").first();
    await statement.scrollIntoViewIfNeeded();
    await expect(statement).toHaveCSS("opacity", "1");
    await expect(statement).toHaveText(/\S/);
  });
});

test("marks the document once scripts run", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveClass(/\bjs\b/);
});
