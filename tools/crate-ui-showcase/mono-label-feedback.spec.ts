import { expect, test } from "@playwright/test";

for (const host of ["storybook", "standalone"] as const) {
  test(`${host} MonoLabel link foreground feedback`, async ({ page }) => {
    await page.goto(
      host === "storybook"
        ? "/iframe.html?id=reviews-1bd-action-labels--complete&viewMode=story"
        : "http://127.0.0.1:5186/review-1bd-action-labels.html",
    );
    const accent = await page
      .getByRole("button", { name: "View All", exact: true })
      .getByText("View All")
      .evaluate((el) => getComputedStyle(el).color);
    const link = page.getByRole("link", {
      name: "Discover artists",
      exact: true,
    });
    const label = link.getByText("Discover artists");
    const readonly = page.getByText("Read-only metadata", { exact: true });
    const disabled = page.getByRole("link", {
      name: "Unavailable destination",
      exact: true,
    });
    const gray = await readonly.evaluate((el) => getComputedStyle(el).color);
    await expect(label).toHaveCSS("color", gray);
    await link.hover();
    await expect(label).toHaveCSS("color", accent);
    await readonly.hover();
    await expect(label).toHaveCSS("color", gray);
    await disabled.hover();
    await expect(disabled.getByText("Unavailable destination")).toHaveCSS(
      "color",
      gray,
    );
    await expect(readonly).toHaveCSS("color", gray);
    await page
      .getByRole("button", { name: "View All", exact: true })
      .press("Tab");
    await expect(link).toBeFocused();
    await expect(label).toHaveCSS("color", accent);
  });

  test(`${host} MonoLabel menu foreground feedback`, async ({ page }) => {
    await page.goto(
      host === "storybook"
        ? "/iframe.html?id=reviews-1bd-action-labels--complete&viewMode=story"
        : "http://127.0.0.1:5186/review-1bd-action-labels.html",
    );
    const accent = await page
      .getByRole("button", { name: "View All", exact: true })
      .getByText("View All")
      .evaluate((el) => getComputedStyle(el).color);

    const trigger = page.getByRole("button", {
      name: "Open menu",
      exact: true,
    });
    await trigger.click();
    const item = page.getByRole("menuitem", {
      name: "Add to queue",
      exact: true,
    });
    const disclosure = page.getByRole("menuitem", {
      name: "Add to playlist",
      exact: true,
    });
    const itemLabel = item.locator('[data-slot="context-menu-item-label"]');
    await disclosure.focus();
    await item.hover();
    await expect(itemLabel).toHaveCSS("color", accent);
    await expect(item).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    const unavailable = page.getByRole("menuitem", {
      name: "Unavailable action",
      exact: true,
    });
    const unavailableLabel = unavailable.locator(
      '[data-slot="context-menu-item-label"]',
    );
    const disabledColor = await unavailableLabel.evaluate(
      (el) => getComputedStyle(el).color,
    );
    await unavailable.hover({ force: true });
    await expect(unavailableLabel).toHaveCSS("color", disabledColor);
    await expect(unavailable).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    const remove = page.getByRole("menuitem", { name: "Remove", exact: true });
    const removeLabel = remove.locator('[data-slot="context-menu-item-label"]');
    await remove.hover();
    await expect(removeLabel).toHaveCSS("color", accent);
    await expect(remove).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await page
      .getByRole("heading", { name: "Recent albums", exact: true })
      .hover();
    await disclosure.press("Home");
    await expect(item).toBeFocused();
    await expect(itemLabel).toHaveCSS("color", accent);
    await expect(item).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await disclosure.press("ArrowRight");
    const nested = page.getByRole("menuitem", {
      name: "Night music",
      exact: true,
    });
    await nested.hover();
    await expect(
      nested.locator('[data-slot="context-menu-item-label"]'),
    ).toHaveCSS("color", accent);
    await expect(nested).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  });
}
