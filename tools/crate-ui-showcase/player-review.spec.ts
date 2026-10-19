import { expect, test } from "@playwright/test";
const hosts = [
  {
    name: "storybook",
    url: "/iframe.html?id=reviews-1az-player--complete&viewMode=story",
  },
  { name: "standalone", url: "http://127.0.0.1:5186/review-1az-player.html" },
];
for (const host of hosts) {
  test(`${host.name}: dock controls fit, native seek and volume`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto(host.url);
    await expect(
      page.getByRole("heading", { name: "1AZ · Listen Player" }),
    ).toBeVisible();
    const dock = page.getByTestId("player-bar-frame");
    const play = dock.getByRole("button", { name: "Play", exact: true });
    const frame = (await dock.boundingBox())!,
      control = (await play.boundingBox())!,
      progress = (await dock
        .locator('[data-slot="player-bar-progress"]')
        .boundingBox())!;
    expect(control.y - frame.y).toBeGreaterThanOrEqual(8);
    expect(progress.y + progress.height).toBeLessThanOrEqual(
      frame.y + frame.height - 4,
    );
    expect(
      await dock
        .locator('[data-slot="player-chrome"]')
        .evaluate((e) => getComputedStyle(e).backdropFilter),
    ).toBe("none");
    await play.click();
    await expect(
      dock.getByRole("button", { name: "Pause", exact: true }),
    ).toHaveAttribute("data-active", "true");
    const seek = page.getByTestId("large-seek").getByRole("slider");
    await seek.focus();
    await page.keyboard.press("Home");
    await expect(seek).toHaveAttribute("aria-valuenow", "0");
    await page.keyboard.press("ArrowRight");
    await expect(seek).toHaveAttribute("aria-valuenow", "5");
    await page.keyboard.press("End");
    await expect(seek).toHaveAttribute("aria-valuenow", "204");
    const box = (await seek.boundingBox())!;
    for (const pct of [0.75, 0.25]) {
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * pct, box.y + box.height / 2);
      const edge = page
        .getByTestId("large-seek")
        .locator(".listen-player-progress-position");
      const alignment = await edge.evaluate((el) => {
        const beam = el.getBoundingClientRect();
        const head = el
          .querySelector(".listen-player-progress-thumb")!
          .getBoundingClientRect();
        return {
          distance: Math.abs(beam.right - (head.x + head.width / 2)),
          transition: getComputedStyle(el).transitionDuration,
        };
      });
      expect(alignment.distance).toBeLessThanOrEqual(1);
      expect(alignment.transition).toBe("0s");
      await page.mouse.up();
    }
    await dock.getByRole("button", { name: "Volume", exact: true }).click();
    const volume = page.getByRole("slider", { name: "Volume", exact: true });
    await expect(volume).toBeFocused();
    await page.keyboard.press("End");
    await expect(volume).toHaveAttribute("aria-valuenow", "100");
    await page.keyboard.press("Escape");
    await expect(
      dock.getByRole("button", { name: "Volume", exact: true }),
    ).toBeFocused();
    await page
      .getByRole("checkbox", { name: "Jam locked", exact: true })
      .check();
    await expect(
      dock.getByRole("button", { name: "Pause", exact: true }),
    ).toBeDisabled();
    await expect(seek).toBeDisabled();
    await page
      .getByRole("checkbox", { name: "Jam locked", exact: true })
      .uncheck();
    await page.getByRole("checkbox", { name: "No track", exact: true }).check();
    await expect(seek).toBeDisabled();
    await expect(
      dock.getByRole("button", { name: "Pause", exact: true }),
    ).toBeDisabled();
    const gaps = await page
      .locator('[data-slot="form-field"][data-layout="stacked"]')
      .evaluateAll((fields) =>
        fields.map((field) => {
          const label = field.querySelector('[data-slot="form-field-label"]')!;
          return (
            label.nextElementSibling!.getBoundingClientRect().top -
            label.getBoundingClientRect().bottom
          );
        }),
      );
    for (const gap of gaps) expect(gap).toBeCloseTo(8, 1);
  });
  test(`${host.name}: panels, queue, lyrics and resume`, async ({ page }) => {
    await page.goto(host.url);
    const stage = page.locator('[data-slot="player-stage"]');
    const stageBounds = (await stage.boundingBox())!;
    const playBounds = (await stage
      .getByRole("button", { name: "Play", exact: true })
      .boundingBox())!;
    expect(playBounds.y + playBounds.height).toBeLessThanOrEqual(
      stageBounds.y + stageBounds.height,
    );
    const queue = page.getByRole("tab", { name: "Queue", exact: true });
    await queue.click();
    const panel = page.getByRole("tabpanel");
    await expect(panel).toHaveAttribute(
      "aria-labelledby",
      (await queue.getAttribute("id")) as string,
    );
    await expect(panel.getByRole("row")).toHaveCount(3);
    const row = panel.getByRole("row").nth(1);
    const before = await row.evaluate(
      (e) => getComputedStyle(e).backgroundColor,
    );
    await row.hover();
    expect(await row.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(
      before,
    );
    await page
      .getByRole("button", { name: "Empty queue", exact: true })
      .click();
    await expect(panel.getByText("Queue is empty")).toBeVisible();
    await page.getByRole("button", { name: "Long queue", exact: true }).click();
    await expect(panel.getByRole("row")).toHaveCount(30);
    await page
      .getByRole("checkbox", { name: "Queue locked", exact: true })
      .check();
    await expect(panel.locator("[inert]")).toHaveCount(30);
    await page.getByRole("tab", { name: "Lyrics", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Across the quiet water" }),
    ).toHaveAttribute("aria-current", "true");
    await page.getByRole("button", { name: "Advance lyric" }).click();
    await expect(
      page.getByRole("button", { name: "The light returns" }),
    ).toHaveAttribute("aria-current", "true");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Continue on this device" }),
    ).toHaveCount(0);
    await page
      .getByRole("combobox", { name: "Sleep timer", exact: true })
      .click();
    await page.getByRole("option", { name: "15 min", exact: true }).click();
    await expect(page.getByText("Pausing in 15:00")).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByText("Pausing in 15:00")).toHaveCount(0);
  });
  test(`${host.name}: mobile and coarse tablet do not clip controls`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    await page.goto(
      host.url.startsWith("http")
        ? host.url
        : `http://127.0.0.1:6006${host.url}`,
    );
    await expect(page.getByTestId("player-bar-frame")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    const mobile = page.locator('[data-slot="mobile-transport"]');
    const row = await page.getByTestId("player-bar-frame").boundingBox();
    const control = await mobile
      .getByRole("button", { name: "Play", exact: true })
      .boundingBox();
    expect(control!.y).toBeGreaterThanOrEqual(row!.y);
    expect(control!.y + control!.height).toBeLessThanOrEqual(
      row!.y + row!.height,
    );
    await page.setViewportSize({ width: 1024, height: 900 });
    const seek = page.getByTestId("player-bar-frame").getByRole("slider");
    expect((await seek.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const bounds = await page.getByTestId("player-bar-frame").boundingBox();
    const end = await seek.boundingBox();
    expect(end!.y + end!.height).toBeLessThanOrEqual(
      bounds!.y + bounds!.height,
    );
    await context.close();
  });
}
