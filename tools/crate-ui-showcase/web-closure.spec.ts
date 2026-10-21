import { expect, test } from "@playwright/test";
const target = (host: string) =>
  host === "storybook"
    ? "/iframe.html?id=reviews-1be-web-closure--complete&viewMode=story"
    : "http://127.0.0.1:5186/review-1be-web-closure.html";
for (const host of ["storybook", "standalone"])
  for (const width of [375, 1200]) {
    test(`${host} web closure ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const writes: string[] = [];
      page.on("request", (request) => {
        if (
          request.method() !== "GET" ||
          new URL(request.url()).pathname.startsWith("/api/")
        )
          writes.push(request.url());
      });
      await page.goto(target(host));
      await expect(
        page.getByRole("heading", { name: "Listen web closure", exact: true }),
      ).toBeVisible({ timeout: 4000 });
      const power = page.getByRole("switch", {
        name: "Equalizer",
        exact: true,
      });
      await page.getByRole("button", { name: "On", exact: true }).click();
      await expect(power).not.toBeChecked();
      await expect(
        page.getByRole("dialog", { name: "Equalizer", exact: true }),
      ).toBeVisible();
      await power.click();
      await expect(
        page.getByRole("button", { name: "On", exact: true }),
      ).toBeVisible();
      const genre = page.getByRole("button", { name: "Genre", exact: true });
      await genre.click();
      await expect(genre).toHaveAttribute("aria-pressed", "true");
      await expect(
        page.getByRole("button", { name: "Smart", exact: true }),
      ).toHaveAttribute("aria-pressed", "false");
      await page.getByRole("button", { name: "Adaptive", exact: true }).click();
      await expect(genre).toHaveAttribute("aria-pressed", "false");
      await page.getByRole("tab", { name: "Actions", exact: true }).click();
      const group = page.getByRole("group", {
        name: "Confirm removal",
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
      const trigger = page.getByRole("button", {
        name: "Review removal",
        exact: true,
      });
      await trigger.click();
      const dialog = page.getByRole("alertdialog");
      await expect(
        dialog.getByRole("button", { name: "Keep item", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await page
        .getByRole("button", { name: "Item actions", exact: true })
        .click();
      await page
        .getByRole("menuitem", { name: "Add to queue", exact: true })
        .click();
      await expect(
        page.getByLabel("Entity action", { exact: true }),
      ).toHaveText("Added to queue in this example");
      await page.getByRole("tab", { name: "Feedback", exact: true }).click();
      await expect(
        page.getByRole("progressbar", { name: "Download progress" }).first(),
      ).toHaveAttribute("aria-valuenow", "0");
      await page.getByRole("tab", { name: "Navigation", exact: true }).click();
      await page.getByRole("link", { name: "Collection", exact: true }).click();
      await expect(page.getByLabel("Current example route")).toHaveText(
        "/collection",
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.getByRole("tab", { name: "Coverage", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Review coverage", exact: true }),
      ).toBeVisible();
      await expect(page.locator("[data-route-audit]")).toHaveCount(25);
      await expect(page.locator('[data-route-evidence="live"]')).toHaveCount(
        11,
      );
      await expect(
        page.locator('[data-route-evidence="inspected"]'),
      ).toHaveCount(14);
      await expect(
        page.getByText("Jam remains disabled", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Native device testing remains separate", {
          exact: true,
        }),
      ).toBeVisible();
      expect(writes).toEqual([]);
    });
  }
for (const host of ["storybook", "standalone"])
  test(`${host} neutral icon hover preserves its surface`, async ({ page }) => {
    await page.goto(target(host));
    await page.getByRole("tab", { name: "Actions", exact: true }).click();
    const provider = page.getByRole("button", {
      name: "Continue with Google",
      exact: true,
    });
    const background = await provider.evaluate(
      (e) => getComputedStyle(e).backgroundColor,
    );
    await provider.hover();
    await provider.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect
      .poll(() => provider.evaluate((e) => getComputedStyle(e).backgroundColor))
      .toBe(background);
    const close = page.getByRole("button", {
      name: "Close example",
      exact: true,
    });
    const accent = await close.evaluate((e) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--accent-action-hi)";
      e.appendChild(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    });
    await close.hover();
    await expect(close).toHaveCSS("color", accent);
    await close.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Close count")).toHaveText("1");
  });
