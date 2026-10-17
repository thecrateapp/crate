import { expect, test } from "./fixtures";
for (const width of [1440, 768]) {
  test(`Admin text navigation and retained UX glyphs at ${width}px`, async ({
    page,
    openAdminPage,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await openAdminPage("/?tab=albums#review");
    const skip = page.getByRole("link", { name: "Skip to main content" });
    await page.keyboard.press("Tab");
    await expect(skip).toBeFocused();
    const url = page.url();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();
    expect(page.url()).toBe(url);
    const collapse = page.getByRole("button", { name: "Collapse sidebar" });
    await expect(collapse.locator("svg")).toHaveCount(1);
    await collapse.click();
    const nav = page.getByRole("navigation", { name: "Admin navigation" });
    await expect(nav.locator("svg")).toHaveCount(0);
    const tasks = nav.getByRole("link", { name: /^Tasks/ });
    await expect(tasks).toContainText("Tasks");
    await tasks.click();
    await expect(page).toHaveURL(/\/tasks$/);
    const back = page.getByRole("button", { name: "Go back" });
    await expect(back.locator("svg")).toHaveCount(1);
    await back.click();
    await expect(page).toHaveURL(url);
    await page.getByRole("button", { name: "Go forward" }).click();
    await expect(page).toHaveURL(/\/tasks$/);
    const main = page.getByRole("main");
    await expect(main).toHaveCSS("margin-left", "144px");
    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await expect(main).toHaveCSS("margin-left", "240px");
    const searchBox = await page
      .getByPlaceholder("Search library…")
      .boundingBox();
    expect(searchBox!.x + searchBox!.width).toBeLessThanOrEqual(width);
    for (const label of [
      "Go back",
      "Go forward",
      "Collapse sidebar",
      "Logout",
    ]) {
      const box = await page.getByRole("button", { name: label }).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await expect(
      palette.getByRole("combobox", { name: "Search commands" }),
    ).toBeFocused();
    await expect(palette.getByRole("option").locator("svg")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(collapse).toBeFocused();
    const search = page.getByRole("textbox", { name: "Search library" });
    await search.fill("no-match");
    await expect(
      page.getByText("No library matches", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("No library matches", { exact: true }).locator("svg"),
    ).toHaveCount(0);
    const clear = page.getByRole("button", { name: "Clear search" });
    const clearBox = await clear.boundingBox();
    expect(clearBox!.width).toBeGreaterThanOrEqual(44);
    expect(clearBox!.height).toBeGreaterThanOrEqual(44);
    await clear.click();
    await expect(search).toBeFocused();
    await expect(search).toHaveValue("");
    await search.press("Escape");
    await page.route("**/api/search?*", (route) =>
      route.fulfill({
        json: {
          artists: [{ name: "Costa", slug: "costa" }],
          albums: [],
          tracks: [],
        },
      }),
    );
    await search.fill("costa");
    const result = page.getByRole("button", { name: "Costa Artist artist" });
    await expect(result).toBeVisible();
    await search.press("Tab");
    await expect(result).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(search).toBeFocused();
    await search.press("Tab");
    await result.press("Escape");
    await expect(search).toBeFocused();
    await expect(result).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await info.attach("checkpoint-1w-admin", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });
}
test("Admin mobile drawer keeps menu/close glyphs, complete destinations and focus return", async ({
  page,
  openAdminPage,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openAdminPage("/");
  const trigger = page.getByRole("button", { name: "Open navigation" });
  await expect(trigger.locator("svg")).toHaveCount(1);
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "Navigation", exact: true });
  await expect(drawer.getByRole("navigation").locator("svg")).toHaveCount(0);
  const close = drawer.getByRole("button", { name: "Close navigation" });
  await expect(close.locator("svg")).toHaveCount(1);
  const closeBox = await close.boundingBox();
  expect(closeBox!.height).toBeGreaterThanOrEqual(44);
  expect(closeBox!.width).toBeGreaterThanOrEqual(44);
  await close.click();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await drawer.getByRole("link", { name: /^Tasks/ }).click();
  await expect(drawer).not.toBeVisible();
  await expect(page).toHaveURL(/\/tasks$/);
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  const paletteClose = palette.getByRole("button", {
    name: "Close command palette",
  });
  await expect
    .poll(async () => {
      const box = await paletteClose.boundingBox();
      return box ? Math.min(box.width, box.height) : 0;
    })
    .toBeGreaterThanOrEqual(44);
  await paletteClose.click();
  await expect(trigger).toBeFocused();
  await page.keyboard.press("?");
  const helpClose = page
    .getByRole("dialog", { name: "Keyboard Shortcuts" })
    .getByRole("button", { name: "Close", exact: true });
  await expect
    .poll(async () => {
      const box = await helpClose.boundingBox();
      return box ? Math.min(box.width, box.height) : 0;
    })
    .toBeGreaterThanOrEqual(44);
  await helpClose.focus();
  await page.keyboard.press("?");
  await helpClose.click();
  await expect(trigger).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await info.attach("checkpoint-1w-admin-mobile", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});
