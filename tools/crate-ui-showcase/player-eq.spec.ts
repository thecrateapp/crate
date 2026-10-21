import { expect, test } from "@playwright/test";
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
      expect(type.size).toBe("14px");
      expect(type.weight).toBe("400");
      await expect(panel.getByRole("button", { name: "Shoegaze" })).toHaveCount(
        0,
      );
      await expect(panel.locator("[data-source]")).toHaveCount(3);
      await expect(panel.locator('[aria-current="true"]')).toHaveAttribute(
        "data-source",
        "user_track_preset",
      );
      const group = panel.getByRole("group", {
        name: "Track curves",
        exact: true,
      });
      const gap = await group.evaluate((e) => {
        const label = document.getElementById(
          e.getAttribute("aria-labelledby")!,
        )!;
        return (
          e.getBoundingClientRect().top - label.getBoundingClientRect().bottom
        );
      });
      expect(gap).toBeCloseTo(8, 0);
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
      const presets = panel.getByRole("combobox", {
        name: "Presets",
        exact: true,
      });
      await presets.click();
      await page.getByRole("option", { name: "Rock", exact: true }).click();
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
    await expect(panel).toContainText(
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
    const readings = panel.locator('[data-slot="eq-band-value"]');
    const bounds = await readings.evaluateAll((nodes) =>
      nodes.map((n) => ({
        left: n.getBoundingClientRect().left,
        right: n.getBoundingClientRect().right,
      })),
    );
    for (let i = 1; i < bounds.length; i++)
      expect(bounds[i]!.left).toBeGreaterThanOrEqual(bounds[i - 1]!.right);
    for (let i = 0; i < 10; i++)
      await expect(sliders.nth(i)).toHaveAttribute("aria-valuenow", "11.5");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
