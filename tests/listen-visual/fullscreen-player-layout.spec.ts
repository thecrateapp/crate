import { expect, test } from "./fixtures";

test.skip(({ isMobile }) => !isMobile, "Fullscreen uses the mobile renderer");

for (const viewport of [
  { width: 393, height: 873, top: 28, bottom: 24, side: 0 },
  { width: 320, height: 568, top: 24, bottom: 20, side: 0 },
  { width: 740, height: 360, top: 0, bottom: 20, side: 44 },
]) {
  test(`keeps the full paused disc below the header at ${viewport.width}x${viewport.height}`, async ({
    page,
    openListenPage,
  }) => {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await openListenPage("/", {
      player: true,
      playerIdentity: {
        title:
          "A very long track title that remains readable without pushing the disc into the toolbar",
        artist: "A long artist identity for this restored paused player",
        album: "A long album name for a short landscape viewport",
        source:
          "The Clash → Erik Urano · a long source label that wraps naturally",
      },
    });
    await page.evaluate(({ top, bottom, side }) => {
      const root = document.documentElement;
      root.style.setProperty("--listen-safe-top", `${top}px`);
      root.style.setProperty("--listen-safe-bottom", `${bottom}px`);
      root.style.setProperty("--listen-safe-left", `${side}px`);
      root.style.setProperty("--listen-safe-right", `${side}px`);
    }, viewport);
    await page
      .getByRole("button", { name: "Open fullscreen player", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Now Playing",
      exact: true,
    });
    const disc = dialog.getByTestId("spinning-disc-jog-surface");
    const header = dialog.getByRole("tablist").locator("..").locator("..");
    await expect(disc).toBeVisible();
    for (const name of ["Like track", "More actions"]) {
      const action = dialog.getByRole("button", { name, exact: true });
      const appearance = await action.evaluate((node) => {
        const css = getComputedStyle(node);
        return {
          background: css.backgroundColor,
          border: css.borderWidth,
          width: node.getBoundingClientRect().width,
          height: node.getBoundingClientRect().height,
        };
      });
      expect(appearance.background).toBe("rgba(0, 0, 0, 0)");
      expect(appearance.border).toBe("0px");
      expect(appearance.width).toBeGreaterThanOrEqual(44);
      expect(appearance.height).toBeGreaterThanOrEqual(44);
      await expect(action).not.toHaveAttribute("title");
    }
    await expect(
      dialog.getByText(
        "A very long track title that remains readable without pushing the disc into the toolbar",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      dialog.getByText(
        "A long artist identity for this restored paused player",
        { exact: true },
      ),
    ).toBeVisible();
    await page.clock.runFor(500);
    const discBox = await disc.boundingBox();
    const headerBox = await header.boundingBox();
    expect(discBox).not.toBeNull();
    expect(headerBox).not.toBeNull();
    expect(discBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height);
    expect(discBox!.y + discBox!.height).toBeLessThanOrEqual(
      viewport.height - viewport.bottom,
    );
    expect(discBox!.x).toBeGreaterThanOrEqual(viewport.side);
    expect(discBox!.x + discBox!.width).toBeLessThanOrEqual(
      viewport.width - viewport.side,
    );
    expect(Math.abs(discBox!.width - discBox!.height)).toBeLessThan(1);
    const close = dialog.getByRole("button", { name: "Close player" });
    const closeBox = await close.boundingBox();
    expect(closeBox!.x).toBeGreaterThanOrEqual(viewport.side);
    expect(closeBox!.y).toBeGreaterThanOrEqual(viewport.top);
    expect(closeBox!.width).toBeGreaterThanOrEqual(44);
    expect(closeBox!.height).toBeGreaterThanOrEqual(44);
    const surface = await dialog.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        image: style.backgroundImage,
        color: style.backgroundColor,
        canvas: getComputedStyle(document.documentElement).backgroundColor,
      };
    });
    expect(surface.image).toBe("none");
    expect(surface.color).toBe(surface.canvas);
    expect(
      await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    expect(
      await header.evaluate((node) => getComputedStyle(node).backgroundColor),
    ).toBe("rgba(0, 0, 0, 0)");
    expect(
      await header.evaluate((node) => getComputedStyle(node).backgroundImage),
    ).toBe("none");
    const stage = dialog.locator('[data-slot="player-stage"]');
    const scroll = await stage.evaluate((node) => ({
      total: node.scrollHeight,
      visible: node.clientHeight,
    }));
    if (viewport.height <= 568)
      expect(scroll.total).toBeGreaterThan(scroll.visible);
    await stage.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    const utility = dialog.getByRole("radio", {
      name: "Cover mode",
      exact: true,
    });
    await expect(utility).toBeInViewport();
    await stage.evaluate((node) => {
      node.scrollTop = 0;
    });
    const restored = await disc.boundingBox();
    expect(restored!.y).toBeGreaterThanOrEqual(
      headerBox!.y + headerBox!.height,
    );
    expect(restored!.y + restored!.height).toBeLessThanOrEqual(
      viewport.height - viewport.bottom,
    );
    await page.mouse.move(viewport.width - 1, viewport.height - 1);
    await page.clock.runFor(300);
    if (viewport.width === 393 || viewport.width === 740)
      await page.screenshot({
        path: `/tmp/listen-fullscreen-${viewport.width}x${viewport.height}-oct24.png`,
      });
  });
}
