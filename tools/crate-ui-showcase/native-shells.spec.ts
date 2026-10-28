import { expect, test } from "@playwright/test";

for (const [host, url] of [
  [
    "storybook",
    "/iframe.html?id=reviews-1be-native-chrome--complete&viewMode=story",
  ],
  ["standalone", "http://127.0.0.1:5186/review-1be-native-chrome.html"],
]) {
  test(`${host} native controls and diagnostic actions`, async ({ page }) => {
    await page.goto(url!);
    await expect(
      page.getByRole("heading", { name: "Native shells" }),
    ).toBeVisible({ timeout: 20000 });
    const bar = page.locator('[data-slot="linux-window-titlebar"]');
    expect((await bar.boundingBox())!.height).toBe(36);
    const close = bar.getByRole("button", { name: "Close window" });
    expect((await close.boundingBox())!.width).toBe(28);
    await page.getByRole("radio", { name: "Split", exact: true }).click();
    const closeX = (await close.boundingBox())!.x;
    expect(closeX).toBeLessThan(
      (await bar
        .getByRole("button", { name: "Minimize window" })
        .boundingBox())!.x,
    );
    await close.click();
    await expect(page.locator("output")).toHaveText("close");
    expect(await bar.locator("[title]").count()).toBe(0);
    const field = page.getByRole("group", { name: "Linux window chrome" });
    const gap = await field.evaluate((el) => {
      const caption = document.getElementById(
        el.getAttribute("aria-labelledby")!,
      );
      return (
        el.getBoundingClientRect().top - caption!.getBoundingClientRect().bottom
      );
    });
    expect(gap).toBe(8);
    const panel = page.getByRole("region", {
      name: "Tauri playback logs",
      exact: true,
    });
    const detail = panel.getByRole("region", {
      name: "Waiting for output",
      exact: true,
    });
    await detail.focus();
    await detail.press("PageDown");
    await expect
      .poll(() => detail.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0);
    await detail.press("Escape");
    await expect(panel).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Logs · 3" })).toBeFocused();
    await page.getByRole("button", { name: "Logs · 3" }).click();
    await panel.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(panel.getByText("No playback events yet.")).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "Clear", exact: true }),
    ).toBeDisabled();
  });

  for (const width of [375, 430]) {
    test(`${host} Capacitor geometry at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(url!);
      await page
        .getByRole("button", { name: "Review Capacitor shell" })
        .click();
      await expect(
        page.getByRole("heading", { name: "Capacitor shell" }),
      ).toBeVisible();
      const header = page.getByTestId("listen-header");
      const main = page.locator("#listen-main-content");
      const player = page.getByTestId("player-bar-frame");
      const nav = page.getByRole("navigation", {
        name: "Collection",
        exact: true,
      });
      expect((await header.boundingBox())!.height).toBe(109);
      await expect
        .poll(async () => {
          const box = (await player.boundingBox())!;
          return box.y + box.height - (await nav.boundingBox())!.y;
        })
        .toBeCloseTo(0, 1);
      expect(
        (await nav.boundingBox())!.y + (await nav.boundingBox())!.height,
      ).toBe(854);
      const clearance = await main.evaluate((el) =>
        parseFloat(getComputedStyle(el).paddingBottom),
      );
      await page
        .getByRole("checkbox", { name: "Keyboard clearance", exact: true })
        .click();
      await expect
        .poll(() =>
          main.evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom)),
        )
        .toBe(clearance + 300);
      await page
        .getByRole("textbox", { name: "Focused field" })
        .fill("Local test");
      await page
        .getByRole("button", { name: "Collection", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "Collection",
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("link", { name: "Albums", exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await expect(
        page.getByRole("status", { name: "Mobile route" }),
      ).toHaveText("/collection/albums");
      await page
        .getByRole("checkbox", { name: "Player space", exact: true })
        .click();
      await expect(player).not.toBeVisible();
      await page
        .getByRole("checkbox", { name: "Safe areas", exact: true })
        .click();
      await expect
        .poll(() => header.boundingBox().then((box) => box!.height))
        .toBe(65);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page
        .getByRole("button", { name: "Back to native review", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Native shells" }),
      ).toBeVisible();
      expect(
        await page.evaluate(() =>
          document.documentElement.style.getPropertyValue("--listen-safe-top"),
        ),
      ).toBe("");
    });
  }
}
