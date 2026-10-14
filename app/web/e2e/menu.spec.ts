import { expect, test } from "@playwright/test";

test.describe("mobile menu", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("opens a panel with every primary link and moves focus into it", async ({
    page,
  }) => {
    await page.goto("/");
    const toggle = page.getByRole("button", { name: "Menu" });
    const menu = page.locator("#site-menu");

    await expect(page.locator(".nav .links")).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(menu).toBeHidden();

    await toggle.click();

    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(menu).toBeVisible();
    await expect(page.locator("[data-menu-close]")).toBeFocused();
    for (const name of [
      "Listen",
      "Admin",
      "Architecture",
      "Developers",
      "Docs",
      "GitHub",
    ])
      await expect(menu.getByRole("link", { name })).toBeInViewport();
    await expect(page.locator("html")).toHaveCSS("overflow", "hidden");
  });

  test("navigates from a menu link and closes the panel", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Menu" }).click();

    await page
      .locator("#site-menu")
      .getByRole("link", { name: "Architecture" })
      .click();

    await expect(page).toHaveURL(/\/architecture$/);
    await expect(page.locator("#site-menu")).toBeHidden();
    await expect(page.locator("html")).not.toHaveClass(/menu-open/);
    await expect(page.getByRole("button", { name: "Menu" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  test("Escape closes the panel and returns focus to the toggle", async ({
    page,
  }) => {
    await page.goto("/listen");
    const toggle = page.getByRole("button", { name: "Menu" });
    await toggle.click();
    await expect(page.locator("#site-menu")).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(page.locator("#site-menu")).toBeHidden();
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("the close button closes the panel and keeps focus inside while open", async ({
    page,
  }) => {
    await page.goto("/");
    const toggle = page.getByRole("button", { name: "Menu" });
    await toggle.click();

    await page.keyboard.press("Shift+Tab");
    await expect(page.locator("#site-menu .brand")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(
      page.locator("#site-menu").getByRole("link", { name: "GitHub" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator("#site-menu .brand")).toBeFocused();

    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.locator("#site-menu")).toBeHidden();
    await expect(toggle).toBeFocused();
  });
});

test("the menu toggle stays hidden on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Menu" })).toBeHidden();
  await expect(page.locator(".nav .links")).toBeVisible();
});
