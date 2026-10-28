import { expect, test } from "@playwright/test";
for (const host of ["storybook", "standalone"]) {
  for (const width of [375, 1200, 1920]) {
    test(`${host} artist image scale and full-width biography ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        host === "storybook"
          ? "/iframe.html?id=reviews-1ba-artist-player--complete&viewMode=story"
          : "http://127.0.0.1:5186/review-1ba-artist-player.html",
      );
      const grid = page.getByTestId("media-grid");
      await expect(grid).toBeVisible();
      const columns = await grid.evaluate(
        (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
      );
      expect(columns).toBe(width < 640 ? 2 : 5);
      await page
        .getByRole("button", { name: "Show more", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "Sample artist biography",
        exact: true,
      });
      await expect(dialog).toBeVisible();
      const sizes = await dialog.evaluate((el) => {
        const body = el.querySelector(".crate-overlay-body")!;
        const panel = el
          .querySelector("[data-app-modal-panel]")!
          .getBoundingClientRect();
        const bodyRect = body.getBoundingClientRect();
        const paragraph = body.querySelector("p")!.getBoundingClientRect();
        const style = getComputedStyle(body);
        return {
          panel: panel.width,
          body: bodyRect.width,
          paragraph: paragraph.width,
          usable:
            bodyRect.width -
            parseFloat(style.paddingLeft) -
            parseFloat(style.paddingRight) -
            (body.clientWidth < bodyRect.width
              ? bodyRect.width - body.clientWidth
              : 0),
        };
      });
      expect(sizes.panel - sizes.body).toBeLessThan(4);
      expect(Math.abs(sizes.paragraph - sizes.usable)).toBeLessThan(2);
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      const header = page.locator('[data-slot="extended-player-header"]');
      await expect(header).not.toContainText(/now playing/i);
      const eq = header.getByRole("button", { name: "Equalizer", exact: true });
      await eq.click();
      await expect(eq).toHaveAttribute("aria-pressed", "true");
      await expect(
        page.getByRole("status").filter({ hasText: "Open" }),
      ).toBeVisible();
      const lyrics = page.locator('[data-slot="player-lyrics-surface"]');
      await expect(lyrics).toHaveCSS("background-image", "none");
      await expect(lyrics).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await expect(lyrics.locator(".lyrics-fullscreen-backdrop")).toHaveCount(
        0,
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
  }
}
