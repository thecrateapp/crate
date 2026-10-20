import { expect, test } from "@playwright/test";
for (const host of ["storybook", "standalone"] as const) {
  for (const mode of [
    "desktop",
    "reported-touch-desktop",
    "phone",
    "tablet",
  ] as const) {
    test(`${host} context menu input ${mode}`, async ({ browser }) => {
      const touchFirst = mode === "phone" || mode === "tablet";
      const context = await browser.newContext({
        viewport: {
          width:
            mode === "phone"
              ? 375
              : mode === "reported-touch-desktop"
                ? 2560
                : 1200,
          height: 900,
        },
        hasTouch: touchFirst,
        isMobile: touchFirst,
      });
      if (mode === "reported-touch-desktop")
        await context.addInitScript(() =>
          Object.defineProperty(navigator, "maxTouchPoints", {
            configurable: true,
            get: () => 10,
          }),
        );
      const page = await context.newPage();
      const errors: string[] = [],
        requests: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (new URL(request.url()).pathname.startsWith("/api/"))
          requests.push(request.url());
      });
      await page.goto(
        host === "storybook"
          ? "http://127.0.0.1:6006/iframe.html?id=reviews-1bc-menus--complete&viewMode=story"
          : "http://127.0.0.1:5186/review-1bc-menus.html",
      );
      const trigger = page.getByRole("button", {
        name: "Open menu",
        exact: true,
      });
      await trigger.click();
      await expect(
        page.getByRole("menuitem", { name: "Add to queue", exact: true }),
      ).toBeVisible();
      if (touchFirst)
        await expect(
          page.getByRole("dialog", { name: "Track actions", exact: true }),
        ).toBeVisible();
      else {
        await expect(page.getByRole("dialog")).toHaveCount(0);
        const menu = page.getByRole("menu").first();
        await expect(menu).toHaveCSS("position", "fixed");
        await expect(menu).toHaveCSS("width", "288px");
        const frame = await menu.boundingBox();
        const button = await trigger.boundingBox();
        expect(frame!.x).toBeGreaterThanOrEqual(button!.x - 1);
        expect(frame!.x).toBeLessThanOrEqual(button!.x + button!.width);
        expect(frame!.y).toBeCloseTo(button!.y + button!.height + 8, 0);
      }
      await expect(
        page.getByRole("menuitem", { name: "Unavailable action", exact: true }),
      ).toBeDisabled();
      const disclosure = page.getByRole("menuitem", {
        name: "Add to playlist",
        exact: true,
      });
      await disclosure.focus();
      await disclosure.press("ArrowRight");
      await expect(
        page.getByRole("menuitem", { name: "Night music", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("menuitem", { name: "Night music", exact: true })
        .click();
      await expect(page.getByLabel("Menu action")).toHaveText(
        "Added to Night music in fixture",
      );
      await expect(trigger).toBeFocused();
      await trigger.click();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toHaveCount(0);
      await expect(trigger).toBeFocused();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(errors).toEqual([]);
      expect(requests).toEqual([]);
      await context.close();
    });
  }
}
