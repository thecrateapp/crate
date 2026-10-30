import { expect, test } from "@playwright/test";

test("the home shows the record shop in full and dims it once the hero is behind", async ({
  page,
}) => {
  await page.goto("/");
  const backdrop = page.locator(".backdrop");
  await expect(backdrop).toHaveClass(/is-full/);
  await expect(backdrop.locator("img")).toHaveJSProperty("complete", true);
  expect(
    await backdrop.evaluate((el) => el.style.getPropertyValue("--shade")),
  ).toBe("0.000");

  await page.evaluate(() => scrollTo(0, innerHeight * 2));
  await expect
    .poll(() => backdrop.evaluate((el) => el.style.getPropertyValue("--shade")))
    .toBe("1.000");
});

test("content pages show the dimmed record shop", async ({ page }) => {
  await page.goto("/listen");
  await expect(page.locator(".backdrop")).toHaveClass(/is-dim/);
});

test("the hero particle field is transparent so the shop shows through", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("canvas#field")).toHaveCount(1);
  await expect
    .poll(() =>
      page
        .locator("canvas#field")
        .evaluate(
          (canvas: HTMLCanvasElement) =>
            canvas.getContext("webgl2")?.getContextAttributes()?.alpha,
        ),
    )
    .toBe(true);
});
