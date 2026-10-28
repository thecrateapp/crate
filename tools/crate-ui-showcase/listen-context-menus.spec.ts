import { expect, test, type Locator } from "@playwright/test";

async function solid(surface: Locator) {
  await expect(surface).toHaveCSS("background-image", "none");
  await expect(surface).toHaveCSS("backdrop-filter", "none");
  expect(await surface.getAttribute("class")).not.toContain(
    "listen-glass-panel",
  );
  return surface.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      background: s.backgroundColor,
      border: s.borderColor,
      radius: s.borderRadius,
      shadow: s.boxShadow,
    };
  });
}

for (const host of ["storybook", "standalone"] as const) {
  const url =
    host === "storybook"
      ? "/iframe.html?id=reviews-1be-context-menus--complete&viewMode=story"
      : "http://127.0.0.1:5186/review-1be-context-menus.html";
  test(`${host}: all row/hero menus share solid chrome, keyboard and nested menus`, async ({
    page,
  }) => {
    await page.goto(url);
    const rowTrigger = page.getByRole("button", {
      name: "Open menu",
      exact: true,
    });
    await rowTrigger.click();
    const rowMenu = page.getByRole("menu");
    const reference = await solid(rowMenu);
    expect(reference.background).not.toBe("rgba(0, 0, 0, 0)");
    await expect(
      page.getByRole("menuitem", { name: "Unavailable action" }),
    ).toBeDisabled();
    const label = page
      .getByRole("menuitem", { name: "Add to queue", exact: true })
      .locator('[data-slot="context-menu-item-label"]');
    await expect(label).toHaveCSS("text-transform", "uppercase");
    await expect(label).toHaveCSS("font-family", /JetBrains Mono/);
    await page
      .getByRole("menuitem", { name: "Add to playlist", exact: true })
      .press("ArrowRight");
    const nested = page.getByRole("menuitem", {
      name: "Night music",
      exact: true,
    });
    await expect(nested).toBeVisible();
    await solid(
      nested.locator(
        "xpath=ancestor::*[contains(@class,'crate-overlay-surface')][1]",
      ),
    );
    await nested.press("ArrowLeft");
    await page.keyboard.press("Escape");
    await expect(rowTrigger).toBeFocused();
    for (const family of ["Artist", "Album", "Playlist", "Crate", "Genre"]) {
      await page.getByRole("tab", { name: family, exact: true }).click();
      const trigger = page.getByRole("button", { name: "More", exact: true });
      await trigger.click();
      expect(await solid(page.getByRole("menu"))).toEqual(reference);
      await expect(
        page.getByRole("menuitem", {
          name: "Make available offline",
          exact: true,
        }),
      ).toBeDisabled();
      await expect(
        page.getByRole("menuitem", {
          name: `Remove ${family.toLowerCase()}`,
          exact: true,
        }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
    }
  });

  test(`${host}: mobile heroes and rows retain solid sheets and local actions`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url);
    for (const family of [
      "Tracks",
      "Artist",
      "Album",
      "Playlist",
      "Crate",
      "Genre",
    ]) {
      await page.getByRole("tab", { name: family, exact: true }).click();
      const trigger = page.getByRole("button", {
        name: family === "Tracks" ? "Open menu" : "More",
        exact: true,
      });
      await trigger.click();
      await expect(page.getByRole("dialog")).toBeVisible();
      const surface = page
        .getByRole("menu")
        .locator(
          "xpath=ancestor::*[contains(@class,'crate-overlay-surface')][1]",
        );
      await solid(surface);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toBeHidden();
    }
    await page.getByRole("tab", { name: "Tracks", exact: true }).click();
    await page.getByRole("button", { name: "Open menu", exact: true }).click();
    await page
      .getByRole("menuitem", { name: "Add to queue", exact: true })
      .click();
    await expect(
      page.locator('output[aria-label="Menu action"]'),
    ).toContainText("Added to queue in fixture");
    await expect(page.getByRole("dialog")).toBeHidden();
  });
}
