import { expect, test } from "@playwright/test";

for (const host of ["storybook", "standalone"] as const) {
  for (const width of [375, 1200]) {
    test(`${host} action labels ${width}px`, async ({ browser }) => {
      const touch = width === 375;
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
        hasTouch: touch,
        isMobile: touch,
      });
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
          ? "/iframe.html?id=reviews-1bd-action-labels--complete&viewMode=story"
          : "http://127.0.0.1:5186/review-1bd-action-labels.html",
      );
      const action = page.getByRole("button", {
        name: "View All",
        exact: true,
      });
      await expect(action).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const caption = action.getByText("View All");
      await expect(caption).toHaveCSS("font-family", /JetBrains Mono/);
      await expect(caption).toHaveCSS("text-transform", "uppercase");
      await expect(caption).toHaveCSS("font-size", "11px");
      const accent = await caption.evaluate((el) => getComputedStyle(el).color);
      const dot = action.locator(".crate-status-dot");
      await expect(dot).toHaveCSS("background-color", accent);
      await expect(dot.locator("..")).not.toHaveCSS("filter", "none");
      await expect(dot).toHaveAttribute("aria-hidden", "true");
      await expect(action.locator("svg")).toHaveCount(0);
      expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await action.press("Enter");
      await expect(page.getByLabel("Section action result")).toHaveText(
        "View All selected",
      );

      const sourceGroup = page.getByRole("group", {
        name: "Player bar source · desktop caption",
        exact: true,
      });
      const sourceCaption = sourceGroup.getByText("Playing from:", {
        exact: true,
      });
      if (width === 1200) {
        await expect(sourceCaption).toBeVisible();
        await expect(sourceCaption).toHaveCSS("font-family", /JetBrains Mono/);
        await expect(sourceCaption).toHaveCSS("font-size", "11px");
        await expect(sourceCaption).toHaveCSS("text-transform", "uppercase");
        const source = sourceGroup.getByRole("button", {
          name: "Night Drives",
          exact: true,
        });
        await expect(source).toHaveCSS("font-family", /IBM Plex Sans/);
        await expect(source).toHaveCSS("text-transform", "none");
        await source.click();
        await expect(
          page.getByLabel("Player source navigation result"),
        ).toHaveText("Night Drives requested");
      } else {
        await expect(sourceCaption).toBeHidden();
      }

      const trigger = page.getByRole("button", {
        name: "Open menu",
        exact: true,
      });
      await trigger.click();
      const menuAction = page.getByRole("menuitem", {
        name: "Add to queue",
        exact: true,
      });
      const label = menuAction.locator('[data-slot="context-menu-item-label"]');
      await expect(label).toHaveCSS("font-family", /JetBrains Mono/);
      await expect(label).toHaveCSS("font-size", "11px");
      await expect(label).toHaveCSS("line-height", "15.4px");
      await expect(label).toHaveCSS("text-transform", "uppercase");
      await expect(menuAction).toHaveCSS("min-height", touch ? "44px" : "36px");
      await expect
        .poll(async () => (await menuAction.boundingBox())!.height)
        .toBeGreaterThanOrEqual((touch ? 44 : 36) - 0.01);
      const remove = page.getByRole("menuitem", {
        name: "Remove",
        exact: true,
      });
      await expect(
        remove.locator('[data-slot="context-menu-item-label"]'),
      ).toHaveCSS(
        "color",
        await remove.evaluate((el) => getComputedStyle(el).color),
      );
      await expect(page.getByText("Talk For Hours", { exact: true })).toHaveCSS(
        "text-transform",
        "none",
      );
      await expect(
        page.getByRole("menuitem", { name: "Unavailable action" }),
      ).toBeDisabled();
      await page
        .getByRole("menuitem", { name: "Add to playlist", exact: true })
        .press("ArrowRight");
      const child = page.getByRole("menuitem", {
        name: "Night music",
        exact: true,
      });
      await expect(
        child.locator('[data-slot="context-menu-item-label"]'),
      ).toHaveCSS("text-transform", "uppercase");
      await child.click();
      await expect(page.getByLabel("Menu action")).toHaveText(
        "Added to Night music in fixture",
      );
      await expect(trigger).toBeFocused();

      await page.getByRole("checkbox", { name: "Long menu options" }).check();
      await trigger.click();
      const longOption = page.getByRole("menuitem", {
        name: "Add this unusually long translated track title to the end of the current playback queue",
        exact: true,
      });
      const longLabel = longOption.locator(
        '[data-slot="context-menu-item-label"]',
      );
      await expect(longLabel).toHaveCSS("-webkit-line-clamp", "2");
      await expect(longLabel).not.toHaveAttribute("title");
      await longLabel.hover();
      await expect(
        page.getByRole("tooltip", {
          name: "Add this unusually long translated track title to the end of the current playback queue",
        }),
      ).toBeVisible();
      expect((await longLabel.boundingBox())!.height).toBeLessThanOrEqual(32);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toHaveCount(0);
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
