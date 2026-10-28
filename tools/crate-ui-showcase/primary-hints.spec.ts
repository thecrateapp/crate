import { expect, test } from "@playwright/test";
for (const host of ["storybook", "standalone"]) {
  for (const width of [1200, 375]) {
    test(`${host} primary and custom hints at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(
        host === "storybook"
          ? "/iframe.html?id=reviews-1be-primary-hints--complete&viewMode=story"
          : "http://127.0.0.1:5186/review-1be-primary-hints.html",
      );
      const button = page.getByRole("button", {
        name: "Save changes",
        exact: true,
      });
      await expect(button).toBeVisible();
      for (const control of [
        button,
        page.getByRole("link", { name: "Open playlist" }),
        page.getByRole("button", { name: "Play", exact: true }),
      ]) {
        await expect(control).toHaveCSS("border-top-width", "1px");
        await expect(control).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
        expect(await control.evaluate((el) => getComputedStyle(el).color)).toBe(
          await control.evaluate((el) => getComputedStyle(el).borderTopColor),
        );
        await control.hover();
        await expect(control).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      }
      await expect(button).toHaveCSS("height", "40px");
      expect(
        await page
          .locator("main [title], main svg title")
          .evaluateAll((elements) => elements.map((el) => el.outerHTML)),
      ).toEqual([]);
      await page.getByRole("button", { name: "Keyboard shortcut" }).hover();
      await expect(
        page.getByRole("tooltip", { name: "Press Space to play or pause" }),
      ).toBeVisible();
      await expect(page.getByRole("tooltip")).toHaveCount(1);
      await page.keyboard.press("Escape");
      await button.focus();
      await expect(
        page.getByRole("tooltip", { name: "Save this playlist" }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await page.keyboard.press("Enter");
      await expect(page.getByRole("status")).toHaveText(
        "Playlist saved locally",
      );
      await page.getByText("post-rock", { exact: true }).hover();
      await expect(
        page.getByRole("tooltip", { name: "Post-rock · 83% · musicbrainz" }),
      ).toBeVisible();
      const group = page.getByRole("group", {
        name: "Primary · default size",
        exact: true,
      });
      const gap = await group.evaluate(
        (el) =>
          el.getBoundingClientRect().top -
          document
            .getElementById(el.getAttribute("aria-labelledby")!)!
            .getBoundingClientRect().bottom,
      );
      expect(gap).toBe(8);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
  }
}
