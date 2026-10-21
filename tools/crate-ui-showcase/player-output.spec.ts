import { expect, test } from "@playwright/test";
for (const host of ["storybook", "standalone"] as const)
  for (const width of [375, 1200]) {
    test(`${host} output picker ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 700 });
      const forbidden: string[] = [];
      page.on("request", (r) => {
        if (
          new URL(r.url()).pathname.startsWith("/api/") ||
          r.method() !== "GET"
        )
          forbidden.push(r.url());
      });
      await page.goto(
        host === "storybook"
          ? "/iframe.html?id=reviews-1be-player-output--complete&viewMode=story"
          : "http://127.0.0.1:5186/review-1be-player-output.html",
      );
      await expect(
        page.getByRole("heading", { name: "Output and devices", exact: true }),
      ).toBeVisible({ timeout: 4000 });
      const choose = async (value: string) => {
        await page
          .getByRole("combobox", { name: "Scenario", exact: true })
          .click();
        await page.getByRole("option", { name: value, exact: true }).click();
      };
      const staticPanel = page.getByRole("region", {
        name: "Output panel",
        exact: true,
      });
      const group = staticPanel.getByRole("group", {
        name: "This device",
        exact: true,
      });
      const gap = await group.evaluate((el) => {
        const caption = document.getElementById(
          el.getAttribute("aria-labelledby")!,
        )!;
        return (
          el.getBoundingClientRect().top -
          caption.getBoundingClientRect().bottom
        );
      });
      expect(gap).toBeCloseTo(8, 0);
      expect(
        (await staticPanel.getByRole("menuitemradio").first().boundingBox())!
          .height,
      ).toBeGreaterThanOrEqual(44);
      const trigger = page.getByRole("button", { name: "Output", exact: true });
      await trigger.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", {
        name: "Output targets",
        exact: true,
      });
      await expect(dialog.getByRole("menuitemradio").first()).toBeFocused();
      await page.keyboard.press("End");
      await expect(dialog.getByRole("menuitemradio").last()).toBeFocused();
      const box = (await dialog.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(7);
      expect(box.x + box.width).toBeLessThanOrEqual(width - 7);
      expect(box.y).toBeGreaterThanOrEqual(7);
      expect(box.y + box.height).toBeLessThanOrEqual(693);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await choose("cast");
      await expect(
        staticPanel.getByRole("menuitem", { name: /Disconnect/ }),
      ).toBeVisible();
      await staticPanel.getByRole("menuitem", { name: /Disconnect/ }).click();
      await expect(
        page.getByRole("status", { name: "Local fixture action" }),
      ).toContainText("Disconnect");
      await choose("unavailable");
      await expect(
        staticPanel.getByText("Start a track before casting."),
      ).toBeVisible();
      await choose("error");
      await expect(staticPanel.getByRole("alert")).toBeVisible();
      await staticPanel.getByRole("button", { name: "Retry" }).click();
      await expect(staticPanel.getByRole("alert")).toHaveCount(0);
      await choose("partial");
      await expect(staticPanel.getByRole("alert")).toBeVisible();
      await expect(
        staticPanel.getByRole("menuitemradio").first(),
      ).toBeVisible();
      await choose("pending");
      await expect(staticPanel.getByRole("status")).toContainText("Connecting");
      await expect(
        staticPanel.getByRole("menuitemradio").first(),
      ).toBeDisabled();
      await choose("long");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await trigger.click();
      await expect(dialog).toBeVisible();
      await page.setViewportSize({ width, height: 430 });
      await expect
        .poll(async () => {
          const b = (await dialog.boundingBox())!;
          return b.y >= 7 && b.y + b.height <= 423;
        })
        .toBe(true);
      await page.keyboard.press("Escape");
      await choose("loading");
      await expect(
        staticPanel.getByRole("status", { name: "Loading targets..." }),
      ).toBeVisible();
      await choose("empty");
      await expect(staticPanel.getByRole("menuitemradio")).toHaveCount(0);
      await page.getByRole("button", { name: "Mute", exact: true }).hover();
      const volume = page.getByRole("slider", { name: "Volume", exact: true });
      await volume.focus();
      await expect(volume).toBeFocused();
      await expect(volume).toHaveAttribute("aria-orientation", "vertical");
      const rail = volume.locator(".listen-player-progress-track");
      await expect(rail).toHaveCSS("width", "2px");
      await expect(
        page
          .getByLabel("Progress reference")
          .locator(".listen-player-progress-track"),
      ).toHaveCSS("height", "2px");
      await expect(volume).toHaveCSS("width", "44px");
      await expect
        .poll(async () => {
          const railBox = (await rail.boundingBox())!;
          const iconBox = (await page
            .getByRole("button", { name: "Mute", exact: true })
            .locator("svg")
            .boundingBox())!;
          return Math.abs(
            railBox.x + railBox.width / 2 - iconBox.x - iconBox.width / 2,
          );
        })
        .toBeLessThan(1);

      await page.keyboard.press("ArrowUp");
      await expect(volume).toHaveAttribute("aria-valuenow", "55");
      await page.keyboard.press("Home");
      await expect(volume).toHaveAttribute("aria-valuenow", "0");
      await page.keyboard.press("End");
      await expect(volume).toHaveAttribute("aria-valuenow", "100");
      await page.keyboard.press("Escape");
      expect(forbidden).toEqual([]);
    });
  }

for (const host of ["storybook", "standalone"] as const)
  test(`${host} dismisses output when its anchor scrolls outside the viewport`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1200, height: 500 });
    await page.goto(
      host === "storybook"
        ? "/iframe.html?id=reviews-1be-player-output--complete&viewMode=story"
        : "http://127.0.0.1:5186/review-1be-player-output.html",
    );
    const trigger = page.getByRole("button", { name: "Output", exact: true });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Output targets" });
    await expect(dialog).toBeVisible();
    // Extend only the scene host to reproduce a long page; no picker internals are changed.
    await page.evaluate(() => {
      document.body.style.minHeight = "3000px";
      window.scrollTo(0, 1200);
    });
    await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
    await expect(trigger).toBeFocused();
  });

for (const host of ["storybook", "standalone"] as const)
  test(`${host} volume head follows the same moving edge as its trail`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(
      host === "storybook"
        ? "/iframe.html?id=reviews-1be-player-output--complete&viewMode=story"
        : "http://127.0.0.1:5186/review-1be-player-output.html",
    );
    const button = page.getByRole("button", { name: /^(Volume|Mute)$/ });
    await button.hover();
    // Legacy click-open makes the geometry regression reproducible before the hover amendment.
    if (
      !(await page
        .getByRole("slider", { name: "Volume", exact: true })
        .isVisible())
    )
      await button.click();
    const slider = page.getByRole("slider", { name: "Volume", exact: true });
    await slider.focus();
    await page.keyboard.press("Home");
    const unmute = page.getByRole("button", { name: /^(Volume|Unmute)$/ });
    await unmute.focus();
    await unmute.hover();
    await page.mouse.wheel(0, -100);
    const maxDrift = await slider.evaluate(async (el) => {
      let max = 0;
      for (let i = 0; i < 8; i++) {
        await new Promise(requestAnimationFrame);
        const fill = el
          .querySelector(".listen-player-progress-fill--vertical")!
          .getBoundingClientRect();
        const head = el
          .querySelector(".listen-player-progress-thumb")!
          .getBoundingClientRect();
        max = Math.max(max, Math.abs(fill.top - (head.top + head.height / 2)));
      }
      return max;
    });
    expect(maxDrift).toBeLessThan(1);
  });

for (const host of ["storybook", "standalone"] as const)
  test(`${host} volume hover mute idle and effects`, async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto(
      host === "storybook"
        ? "/iframe.html?id=reviews-1be-player-output--complete&viewMode=story"
        : "http://127.0.0.1:5186/review-1be-player-output.html",
    );
    const scenario = page.getByRole("combobox", {
      name: "Scenario",
      exact: true,
    });
    await scenario.focus();
    const mute = page.getByRole("button", { name: "Mute", exact: true });
    await mute.hover();
    const slider = page.getByRole("slider", { name: "Volume", exact: true });
    await expect(slider).toBeVisible();
    await expect(scenario).toBeFocused();
    await mute.click();
    await expect(slider).toHaveAttribute("aria-valuenow", "0");
    await expect(
      page
        .getByRole("button", { name: "Unmute", exact: true })
        .locator(".listen-player-volume-icon"),
    ).toHaveCSS("filter", "none");
    await page.getByRole("button", { name: "Unmute", exact: true }).click();
    await expect(slider).toHaveAttribute("aria-valuenow", "50");
    await slider.focus();
    await page.keyboard.press("Home");
    const zeroOpacity = await page
      .getByRole("button", { name: "Unmute", exact: true })
      .locator(".listen-player-volume-icon")
      .evaluate((el) => getComputedStyle(el).opacity);
    await page.keyboard.press("End");
    await expect
      .poll(async () =>
        Number(
          await mute
            .locator(".listen-player-volume-icon")
            .evaluate((el) => getComputedStyle(el).opacity),
        ),
      )
      .toBeGreaterThan(Number(zeroOpacity));
    await page.evaluate(() => {
      document.documentElement.dataset.crateEffects = "off";
    });
    await expect(mute.locator(".listen-player-volume-icon")).toHaveCSS(
      "filter",
      "none",
    );
    await page.mouse.move(0, 0);
    await page.waitForTimeout(2800);
    await expect(slider).toBeVisible();
    await scenario.focus();
    await expect(slider).toHaveCount(0, { timeout: 3500 });
  });

for (const host of ["storybook", "standalone"] as const)
  test(`${host} volume wheel changes volume without scrolling the page`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto(
      host === "storybook"
        ? "/iframe.html?id=reviews-1be-player-output--complete&viewMode=story"
        : "http://127.0.0.1:5186/review-1be-player-output.html",
    );
    // A long scene reproduces the production page's scrollable content without
    // changing the control or its scroll handling.
    await page.evaluate(() => {
      document.body.style.minHeight = "3000px";
    });
    const button = page.getByRole("button", { name: "Mute", exact: true });
    await button.hover();
    const slider = page.getByRole("slider", { name: "Volume", exact: true });
    const settleWheel = () =>
      page.evaluate(async () => {
        for (let i = 0; i < 8; i++) await new Promise(requestAnimationFrame);
      });
    await page.mouse.wheel(0, 150);
    await expect(slider).toHaveAttribute("aria-valuenow", "47");
    await settleWheel();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await slider.hover();
    await page.keyboard.down("Shift");
    await page.mouse.wheel(0, -150);
    await page.keyboard.up("Shift");
    await expect(slider).toHaveAttribute("aria-valuenow", "48");
    await settleWheel();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await slider.focus();
    await page.keyboard.press("End");
    await page.mouse.wheel(0, -150);
    await expect(slider).toHaveAttribute("aria-valuenow", "100");
    await settleWheel();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await page.mouse.move(1100, 750);
    await page.mouse.wheel(0, 150);
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(0);
  });

test.describe("volume coarse pointer", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 375, height: 812 },
  });
  for (const host of ["storybook", "standalone"] as const)
    test(`${host} touch opens slider with a separate mute action`, async ({
      page,
    }) => {
      await page.goto(
        host === "storybook"
          ? "/iframe.html?id=reviews-1be-player-output--complete&viewMode=story"
          : "http://127.0.0.1:5186/review-1be-player-output.html",
      );
      await page.getByRole("button", { name: "Volume", exact: true }).tap();
      const slider = page.getByRole("slider", { name: "Volume", exact: true });
      await expect(slider).toHaveAttribute("aria-valuenow", "50");
      await page.getByRole("button", { name: "Mute", exact: true }).tap();
      await expect(slider).toHaveAttribute("aria-valuenow", "0");
      await page.getByRole("button", { name: "Unmute", exact: true }).tap();
      await expect(slider).toHaveAttribute("aria-valuenow", "50");
    });
});

test.describe("hybrid volume transitions", () => {
  test.use({ hasTouch: true, viewport: { width: 1200, height: 900 } });
  for (const host of ["storybook", "standalone"] as const)
    test(`${host} preserves outside clicks and keyboard/touch transitions`, async ({
      page,
    }) => {
      await page.addInitScript(() => {
        const original = window.matchMedia.bind(window);
        window.matchMedia = (query) => {
          const match = original(query);
          if (query === "(hover: hover) and (pointer: fine)")
            Object.defineProperty(match, "matches", { value: true });
          return match;
        };
      });
      await page.goto(
        host === "storybook"
          ? "/iframe.html?id=reviews-1be-player-output--complete&viewMode=story"
          : "http://127.0.0.1:5186/review-1be-player-output.html",
      );
      const mute = page.getByRole("button", { name: "Mute", exact: true });
      await mute.hover();
      await expect(
        page.getByRole("slider", { name: "Volume", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Output", exact: true }).click();
      await expect(
        page.getByRole("dialog", { name: "Output targets" }),
      ).toBeVisible();
      await expect(
        page.getByRole("slider", { name: "Volume", exact: true }),
      ).toHaveCount(0);
      await page.keyboard.press("Escape");
      await mute.hover();
      await mute.focus();
      await page.keyboard.press("ArrowUp");
      await expect(page.getByRole("slider")).toBeFocused();
      await page.keyboard.press("Escape");
      const scenario = page.getByRole("combobox", {
        name: "Scenario",
        exact: true,
      });
      await scenario.focus();
      await page.mouse.move(0, 0);
      await mute.hover();
      await expect(page.getByRole("slider")).toBeVisible();
      await expect(scenario).toBeFocused();
      await page.keyboard.press("Escape");
      await mute.tap();
      const dialog = page.getByRole("dialog", { name: "Volume", exact: true });
      await dialog.getByRole("button", { name: "Mute", exact: true }).tap();
      await expect(dialog.getByRole("slider")).toHaveAttribute(
        "aria-valuenow",
        "0",
      );
      await dialog.getByRole("button", { name: "Unmute", exact: true }).tap();
      await expect(dialog.getByRole("slider")).toHaveAttribute(
        "aria-valuenow",
        "50",
      );
    });
});
