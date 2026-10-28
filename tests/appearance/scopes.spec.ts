import { expect, test } from "@playwright/test";
import { openAppearanceHarness } from "./fixtures";

test("keeps the fixed identity in portal content and sibling surfaces as preferences change", async ({
  page,
}) => {
  await openAppearanceHarness(page);
  const secondary = page
    .getByTestId("secondary-scope")
    .locator(".appearance-card");
  const primary = page.getByTestId("appearance-card");
  const initial = await secondary.evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    color: getComputedStyle(element).color,
  }));
  expect(initial).toEqual({
    background: "rgb(13, 14, 20)",
    color: "rgb(241, 245, 249)",
  });
  await page.getByTestId("effects-select").selectOption("off");
  await page.getByTestId("density-select").selectOption("compact");
  await page.getByTestId("apply-button").click();
  await expect(page.getByTestId("portal-content")).toHaveCSS(
    "color",
    initial.color,
  );
  await expect(secondary).toHaveCSS("background-color", initial.background);
  await expect(secondary).toHaveCSS("color", initial.color);
  await expect(primary).toHaveCSS("background-color", initial.background);
  await expect(primary).toHaveCSS("color", initial.color);
});
