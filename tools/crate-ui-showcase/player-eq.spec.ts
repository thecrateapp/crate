import { expect, test } from "@playwright/test";
import { eqCurvePath } from "../../app/shared/ui/lib/eq-curve";
for (const host of ["storybook", "standalone"] as const)
  for (const width of [375, 1200])
    test(`${host} EQ ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const writes: string[] = [];
      page.on("request", (r) => {
        if (
          r.method() !== "GET" ||
          new URL(r.url()).pathname.startsWith("/api/")
        )
          writes.push(r.url());
      });
      await page.goto(
        host === "storybook"
          ? "/iframe.html?id=reviews-1be-player-eq--complete&viewMode=story"
          : "http://127.0.0.1:5186/review-1be-player-eq.html",
      );
      await expect(
        page.getByRole("heading", {
          name: "Equalizer refinement",
          exact: true,
        }),
      ).toBeVisible({ timeout: 4000 });
      const panel = page.getByRole("dialog", {
        name: "Equalizer",
        exact: true,
      });
      await expect(panel).toBeVisible();
      const size = await panel.boundingBox();
      if (width === 1200)
        await expect
          .poll(async () => (await panel.boundingBox())!.width)
          .toBeCloseTo(720, 0);
      expect(size!.width).toBeLessThanOrEqual(width - 24);
      const values = panel.locator('[data-slot="eq-band-value"]');
      expect(await values.count()).toBe(10);
      const type = await values.first().evaluate((e) => ({
        font: getComputedStyle(e).fontFamily,
        size: getComputedStyle(e).fontSize,
        weight: getComputedStyle(e).fontWeight,
      }));
      expect(type.font).toContain("JetBrains");
      expect(type.size).toBe("12px");
      expect(type.weight).toBe("400");
      await expect(
        panel.getByRole("button", { name: "Shoegaze" }),
      ).toBeVisible();
      await expect(panel.locator("[data-source]")).toHaveCount(1);
      await expect(panel.locator('[aria-current="true"]')).toHaveAttribute(
        "data-source",
        "user_track_preset",
      );
      const viewport = panel.locator('[data-slot="eq-bands-viewport"]');
      expect(
        await viewport.evaluate((e) => e.scrollWidth <= e.clientWidth),
      ).toBe(true);
      const bounds = await panel.boundingBox();
      for (const slider of await panel.getByRole("slider").all()) {
        const band = (await slider.boundingBox())!;
        expect(band.x).toBeGreaterThanOrEqual(bounds!.x);
        expect(band.x + band.width).toBeLessThanOrEqual(
          bounds!.x + bounds!.width,
        );
      }
      const power = (await panel
        .getByRole("button", { name: "On", exact: true })
        .boundingBox())!;
      const close = (await panel
        .getByRole("button", { name: "Close equalizer" })
        .boundingBox())!;
      expect(power.y + power.height / 2).toBeCloseTo(
        close.y + close.height / 2,
        0,
      );
      const slider = panel.getByRole("slider").first();
      await slider.focus();
      await page.keyboard.press("ArrowUp");
      await expect(slider).toHaveAttribute("aria-valuenow", "3.5");
      await expect(
        panel.getByRole("button", { name: "Smart", exact: true }),
      ).toHaveAttribute("aria-pressed", "false");
      await expect(panel.getByRole("slider").nth(1)).toHaveAttribute(
        "aria-valuenow",
        "2",
      );
      await page.keyboard.press("Tab");
      await panel.getByRole("button", { name: "Reset", exact: true }).click();
      await expect(slider).toHaveAttribute("aria-valuenow", "0");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await panel.getByRole("button", { name: "Rock", exact: true }).click();
      await expect(slider).toHaveAttribute("aria-valuenow", "4");
      await panel.getByRole("button", { name: "On", exact: true }).click();
      await expect(
        panel.getByRole("button", { name: "Off", exact: true }),
      ).toBeEnabled();
      await expect(slider).toHaveAttribute("aria-valuenow", "0");
      await expect(panel.locator('[aria-current="true"]')).toHaveCount(0);
      await panel.getByRole("button", { name: "Off", exact: true }).click();
      await expect(slider).toHaveAttribute("aria-valuenow", "4");
      expect(writes).toEqual([]);
    });
for (const host of ["storybook", "standalone"] as const)
  test(`${host} EQ states and short parent`, async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto(
      host === "storybook"
        ? "/iframe.html?id=reviews-1be-player-eq--complete&viewMode=story"
        : "http://127.0.0.1:5186/review-1be-player-eq.html",
    );
    const scenario = page.getByRole("combobox", {
      name: "Scenario",
      exact: true,
    });
    const panel = page.getByRole("dialog", { name: "Equalizer", exact: true });
    const choose = async (name: string) => {
      await scenario.click();
      await page.getByRole("option", { name, exact: true }).click();
    };
    await choose("legacy");
    await expect(panel).not.toContainText(
      "Only the current curve is available from this server.",
    );
    await expect(panel.locator("[data-source]")).toHaveCount(1);
    await choose("loading");
    await expect(panel.locator("[data-source]")).toHaveCount(0);
    await expect(panel).toContainText("Resolving");
    await choose("unavailable");
    await expect(panel.locator("[data-source]")).toHaveCount(0);
    await choose("off");
    await expect(
      panel.getByRole("button", { name: "Off", exact: true }),
    ).toBeEnabled();
    await expect(panel.getByRole("slider").first()).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
    await choose("long");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await choose("short");
    const parent = page.getByTestId("eq-parent");
    await expect
      .poll(async () => {
        const a = (await panel.boundingBox())!;
        const b = (await parent.boundingBox())!;
        return a.y + a.height <= b.y + b.height;
      })
      .toBe(true);
    await panel
      .getByRole("button", { name: "Clear track preset", exact: true })
      .focus();
    await expect(
      panel.getByRole("button", { name: "Clear track preset", exact: true }),
    ).toBeInViewport();
  });
for (const host of ["storybook", "standalone"] as const)
  test(`${host} EQ fractional values fit narrow viewport`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 1000 });
    await page.goto(
      host === "storybook"
        ? "/iframe.html?id=reviews-1be-player-eq--complete&viewMode=story"
        : "http://127.0.0.1:5186/review-1be-player-eq.html",
    );
    const panel = page.getByRole("dialog", { name: "Equalizer", exact: true });
    await panel.getByRole("button", { name: "Smart", exact: true }).click();
    const sliders = panel.getByRole("slider");
    for (let i = 0; i < 10; i++) {
      await sliders.nth(i).focus();
      await page.keyboard.press("End");
      await page.keyboard.press("ArrowDown");
    }
    const readings = panel.locator('[data-slot="eq-band-compact-value"]');
    const bounds = await readings.evaluateAll((nodes) =>
      nodes.map((n) => ({
        left: n.getBoundingClientRect().left,
        right: n.getBoundingClientRect().right,
      })),
    );
    for (let i = 1; i < bounds.length; i++)
      expect(bounds[i]!.left).toBeGreaterThanOrEqual(bounds[i - 1]!.right);
    for (let i = 0; i < 10; i++) {
      await sliders.nth(i).focus();
      await expect(sliders.nth(i)).toHaveAttribute("aria-valuenow", "11.5");
      await expect(
        sliders.nth(i).locator('[data-slot="eq-band-exact-value"]'),
      ).toBeVisible();
      await expect(
        sliders.nth(i).locator('[data-slot="eq-band-exact-value"]'),
      ).toHaveText("+11.5 dB");
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });

for (const host of ["storybook", "standalone"] as const) {
  test.describe(`${host} compact touch EQ`, () => {
    test.use({
      hasTouch: true,
      isMobile: true,
      viewport: { width: 412, height: 915 },
    });
    test("ten bands, a stable header, exact readings and pill power without overflow", async ({
      page,
    }) => {
      await page.goto(
        host === "storybook"
          ? "/iframe.html?id=reviews-1be-player-eq--complete&viewMode=story"
          : "http://127.0.0.1:5186/review-1be-player-eq.html",
      );
      const panel = page.getByRole("dialog", {
        name: "Equalizer",
        exact: true,
      });
      await expect(panel).toBeVisible();
      const modes = panel.locator('[data-slot="eq-mode-controls"] button');
      const positions = await modes.evaluateAll((nodes) =>
        nodes.map((n) => n.getBoundingClientRect().y),
      );
      expect(new Set(positions).size).toBe(1);
      const power = panel.getByRole("button", { name: "On", exact: true });
      const close = panel.getByRole("button", { name: "Close equalizer" });
      await expect
        .poll(async () => {
          const a = (await power.boundingBox())!,
            b = (await close.boundingBox())!;
          return Math.abs(a.y + a.height / 2 - b.y - b.height / 2);
        })
        .toBeLessThan(1);
      await expect
        .poll(async () => (await power.boundingBox())!.height)
        .toBeGreaterThanOrEqual(44);
      const plot = panel.locator('[data-slot="eq-bands-viewport"]');
      expect(await plot.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
        true,
      );
      const sliders = panel.getByRole("slider");
      await expect(sliders).toHaveCount(10);
      await expect(sliders.last()).toHaveCSS("touch-action", "none");
      await sliders.last().tap();
      await expect(
        sliders.last().locator('[data-slot="eq-band-exact-value"]'),
      ).toBeVisible();
      await expect(
        panel.getByRole("button", { name: "Smart", exact: true }),
      ).toHaveAttribute("aria-pressed", "false");
      await panel.getByRole("button", { name: "Rock", exact: true }).tap();
      await expect(sliders.first()).toHaveAttribute("aria-valuenow", "4");
      await power.tap();
      await expect(
        panel.getByRole("button", { name: "Off", exact: true }),
      ).toBeEnabled();
      await expect(sliders.first()).toHaveAttribute("aria-valuenow", "0");
      await panel.getByRole("button", { name: "Off", exact: true }).tap();
      await expect(sliders.first()).toHaveAttribute("aria-valuenow", "4");
      const values = panel.locator('[data-slot="eq-band-compact-value"]');
      await expect(values.first()).toHaveCSS("font-size", "12px");
      const rows = await values.evaluateAll((nodes) =>
        nodes.map((n) => n.getBoundingClientRect().y),
      );
      expect(new Set(rows).size).toBe(1);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `.artifacts/crate-v3/1be-eq-compact-${host}-412.png`,
        fullPage: true,
      });
      await panel.getByRole("button", { name: "Adaptive", exact: true }).tap();
      const information = panel.locator('[data-slot="eq-curve-readout"]');
      await expect(information).toContainText("42%");
      await expect(information).not.toContainText(/audio analysis/i);
      const displayedGains = await sliders.evaluateAll((nodes) =>
        nodes.map((n) => Number(n.getAttribute("aria-valuenow"))),
      );
      await expect(
        panel.locator("path.stroke-accent-action-hi"),
      ).toHaveAttribute("d", eqCurvePath(displayedGains));
      await page.screenshot({
        path: `.artifacts/crate-v3/1be-eq-adaptive-${host}-412.png`,
        fullPage: true,
      });
    });
  });
}

for (const host of ["storybook", "standalone"] as const) {
  test(`${host} Smart genre and Genre use one information slot before presets`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto(
      host === "storybook"
        ? "/iframe.html?id=reviews-1be-player-eq--complete&viewMode=story"
        : "http://127.0.0.1:5186/review-1be-player-eq.html",
    );
    await page.getByRole("combobox", { name: "Scenario", exact: true }).click();
    await page
      .getByRole("option", { name: "smart-genre", exact: true })
      .click();
    const panel = page.getByRole("dialog", { name: "Equalizer", exact: true });
    const info = panel.locator('[data-slot="eq-curve-readout"]');
    await expect(info.getByText("Grindcore", { exact: true })).toBeVisible();
    await expect(info).toHaveText("Genre taxonomy: Grindcore");
    await expect(info).toHaveAttribute("aria-current", "true");
    await expect(info).toHaveAttribute("data-source", "genre_taxonomy_preset");
    await expect(info).toHaveCSS("font-family", /JetBrains/);
    await expect(info).toHaveCSS("text-transform", "uppercase");
    const bandStyle = () =>
      info.evaluate((el) => {
        const s = getComputedStyle(el);
        return {
          background: s.backgroundColor,
          border: s.borderTopColor,
          font: s.fontFamily,
          size: s.fontSize,
          weight: s.fontWeight,
        };
      });
    const smartStyle = await bandStyle();
    const iconOffset = () =>
      info.evaluate((el) => {
        const icon = el.querySelector("svg")!.getBoundingClientRect();
        const text = el.lastElementChild!;
        return Math.abs(
          icon.top +
            icon.height / 2 -
            (text.getBoundingClientRect().top +
              parseFloat(getComputedStyle(text).lineHeight) / 2),
        );
      });
    expect(await iconOffset()).toBeLessThan(0.5);

    const original = await panel
      .getByRole("slider")
      .evaluateAll((nodes) =>
        nodes.map((n) => n.getAttribute("aria-valuenow")),
      );
    await panel.getByRole("button", { name: "Genre", exact: true }).click();
    await expect(info.getByText("Grindcore", { exact: true })).toBeVisible();
    await expect(info).toHaveText("Genre taxonomy: Grindcore");
    await expect(panel).not.toContainText("Smart EQ is waiting");
    await expect(info).toHaveCount(1);
    expect(
      await panel
        .getByRole("slider")
        .evaluateAll((nodes) =>
          nodes.map((n) => n.getAttribute("aria-valuenow")),
        ),
    ).toEqual(original);
    const plot = panel.locator('[data-slot="eq-bands-viewport"]');
    const presets = panel.getByRole("group", { name: "Presets", exact: true });
    expect((await info.boundingBox())!.y).toBeGreaterThan(
      (await plot.boundingBox())!.y,
    );
    await expect(info).toHaveCSS("font-family", /JetBrains/);
    await expect(info).toHaveCSS("text-transform", "uppercase");
    expect((await info.boundingBox())!.y).toBeLessThan(
      (await presets.boundingBox())!.y,
    );
    await panel.getByRole("button", { name: "Adaptive", exact: true }).click();
    await expect(info).toContainText("42%");
    expect(await bandStyle()).toEqual(smartStyle);
    await expect(info).toContainText("Dynamic Range");
    const reset = panel.getByRole("button", { name: "Reset", exact: true });
    await reset.scrollIntoViewIfNeeded();
    expect((await reset.boundingBox())!.y).toBeGreaterThan(
      (await presets.boundingBox())!.y,
    );
    await panel.getByRole("button", { name: "Genre", exact: true }).click();
    await page.screenshot({
      path: `.artifacts/crate-v3/1be-eq-genre-${host}-412.png`,
      fullPage: true,
    });
    await panel.getByRole("button", { name: "Jazz", exact: true }).click();
    await expect(info).toHaveText("Preset: Jazz");
  });
}
