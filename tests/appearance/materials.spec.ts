import { expect, test } from "@playwright/test";
import { openAppearanceHarness } from "./fixtures";

test("keeps solid surfaces when functional effects change", async ({
  page,
}) => {
  await openAppearanceHarness(page);
  const card = page.getByTestId("appearance-card");
  const before = await card.boundingBox();
  for (const effects of ["off", "expressive", "subtle"]) {
    await page.getByTestId("effects-select").selectOption(effects);
    await page.getByTestId("apply-button").click();
    await expect(card).toHaveCSS("background-color", "rgb(13, 14, 20)");
    await expect(card).toHaveCSS("color", "rgb(241, 245, 249)");
    const after = await card.boundingBox();
    expect(after?.width).toBe(before?.width);
    expect(after?.height).toBe(before?.height);
  }
  await expect(page.getByTestId("material-select")).toHaveCount(0);
});
