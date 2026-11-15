import { expect, test } from "@playwright/test";

// The kit controls reproduce @crate/ui's form recipes
// (app/shared/ui/tokens/recipes.css: crate-form-slider, -switch, -chip).

const CYAN_HI = "rgb(103, 232, 249)";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.locator("[data-kit]").scrollIntoViewIfNeeded();
});

test("the slider is Crate's hairline range", async ({ page }) => {
  const slider = page.locator("[data-beam-leg]");
  await expect(slider).toHaveCSS("appearance", "none");
  await expect(slider).toHaveCSS("height", "40px");
  await expect(slider).toHaveClass(/crate-form-slider/);
});

test("the switch is Crate's 32 x 18 switch, filled cyan when on", async ({
  page,
}) => {
  const toggle = page.getByRole("switch", { name: "Beam" });
  await expect(toggle).toHaveCSS("width", "32px");
  await expect(toggle).toHaveCSS("height", "18px");
  await expect(toggle).toHaveCSS("background-color", CYAN_HI);
  const thumb = toggle.locator("span");
  await expect(thumb).toHaveCSS("width", "14px");
  await toggle.click();
  await expect(toggle).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
});

test("chips are Crate's mono chips, the active one filled cyan", async ({
  page,
}) => {
  const manual = page.getByRole("radio", { name: "Manual" });
  await expect(manual).toHaveCSS("text-transform", "none");
  await expect(manual).toHaveCSS("font-size", "12px");
  await expect(manual).toHaveCSS("min-height", "32px");
  await expect(manual).toHaveCSS("background-color", CYAN_HI);
  await expect(manual).toHaveCSS("color", "rgb(10, 10, 15)");
  const flat = page.getByRole("radio", { name: "Flat" });
  await expect(flat).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(flat).toHaveCSS("color", "rgba(241, 245, 249, 0.62)");
});
