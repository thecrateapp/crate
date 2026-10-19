import { expect, test } from "@playwright/test";

const headers: [string, string, string[]][] = [
  ["dashboard", "Dashboard", ["Refresh", "Maintenance"]],
  [
    "analysis",
    "Analysis",
    [
      "Refresh",
      "Backfill fingerprints",
      "Recompute popularity",
      "Recompute bliss",
      "Re-analyze all",
    ],
  ],
  ["system-health", "System Health", ["Refresh metrics"]],
  ["health", "Library Health", ["Run scan"]],
  ["trash", "Library Trash", ["Refresh", "Empty trash"]],
  ["contributions", "Contributions", ["Refresh"]],
  [
    "bandcamp",
    "Support layer for the collection",
    ["Sync collection", "Refresh Radar", "Backfill URLs"],
  ],
  ["discovery", "Discovery", ["Refresh", "Recompute gaps", "Check releases"]],
  ["new-releases", "New Releases", ["Timeline", "Grid", "Check now"]],
  [
    "global-catalog",
    "Global Catalog",
    ["Refresh", "Reconcile", "Full rebuild"],
  ],
  ["roles", "Roles & Permissions", []],
  ["users", "Users", ["Invite user", "Add user"]],
  ["translations", "Listen Translations", ["Refresh"]],
  ["upcoming", "Upcoming", ["Sync shows", "Clear caches"]],
  ["playlists", "System Playlists", ["New static", "New smart"]],
  [
    "playlist-editor",
    "Costa de noche",
    ["Duplicate", "Preview", "Generate", "Save changes"],
  ],
  ["operations-demo.html?page=logs", "Logs", ["Pause live", "Refresh"]],
  ["operations-demo.html?page=stack", "Stack", ["Refresh"]],
];
for (const width of [1440, 768, 390]) {
  test.describe(`1AQ migrated headers ${width}`, () => {
    test.use({
      viewport: { width, height: 1100 },
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    for (const [demo, heading, names] of headers) {
      test(`${heading}: compact named actions and actual-container layout`, async ({
        page,
      }) => {
        const errors: string[] = [],
          apiRequests: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("request", (request) => {
          if (new URL(request.url()).pathname.startsWith("/api/"))
            apiRequests.push(request.url());
        });
        await page.goto(
          `/admin-${demo.includes(".html") ? demo : `${demo}-demo.html`}`,
        );
        const header = page.locator('[data-slot="admin-page-header"]');
        await expect(header).toHaveCount(1);
        await expect(
          header.getByRole("heading", { level: 1, name: heading, exact: true }),
        ).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await expect(header.getByRole("heading", { level: 1 })).toHaveCSS(
          "font-family",
          /Bricolage Grotesque/,
        );
        await expect(
          header
            .locator('[data-slot="header-actions-position"]')
            .getByRole("button"),
        ).toHaveCount(names.length);
        for (const name of names) {
          const button = header.getByRole("button", { name, exact: true });
          await expect(button).toHaveAttribute("data-size", "icon-lg");
          await expect(button).toHaveAttribute("data-variant", "ghost");
          await expect(button).toHaveAttribute("title", name);
          await expect(button).toHaveText("");
          await expect(button.locator("svg")).toHaveCount(1);
          await expect(button.locator("svg")).toHaveAttribute(
            "aria-hidden",
            "true",
          );
          const box = (await button.boundingBox())!;
          expect([box.width, box.height]).toEqual([44, 44]);
          await expect(button).toHaveCSS("border-top-width", "0px");
          await expect(button).toHaveCSS(
            "background-color",
            "rgba(0, 0, 0, 0)",
          );
          if (await button.isEnabled()) {
            await button.focus();
            await expect(button).toBeFocused();
            await expect(
              page.getByRole("tooltip", { name, exact: true }),
            ).toBeVisible();
            await page.keyboard.press("Escape");
            await button.blur();
          }
        }
        const geometry = await header.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const title = el.querySelector("h1")!.getBoundingClientRect();
          const actions = el
            .querySelector('[data-slot="header-actions-position"]')
            ?.getBoundingClientRect();
          return {
            left: r.left,
            right: r.right,
            width: r.width,
            titleLeft: title.left,
            titleRight: title.right,
            top: r.top,
            actionTop: actions?.top,
            actionRight: actions?.right,
            actionBottom: actions?.bottom,
            titleTop: title.top,
          };
        });
        expect(geometry.left).toBeGreaterThanOrEqual(0);
        expect(geometry.right).toBeLessThanOrEqual(width);
        expect(geometry.titleRight).toBeLessThanOrEqual(geometry.right + 1);
        if (names.length) {
          expect(geometry.actionRight).toBe(geometry.right);
          if (geometry.width >= 672)
            expect(geometry.actionTop).toBe(geometry.top);
          else
            expect(geometry.actionBottom!).toBeLessThanOrEqual(
              geometry.titleTop,
            );
        } else await expect(header.getByRole("group")).toHaveCount(0);
        expect(errors).toEqual([]);
        expect(apiRequests).toEqual([]);
      });
    }
  });
}
for (const width of [1440, 768, 390]) {
  test(`1AQ playlist row actions and single padding layer ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1100 });
    await page.goto("/admin-playlists-demo.html");
    const row = page.getByRole("link", { name: /Costa de noche/ });
    await expect(row).toBeVisible();
    const padding = await row.evaluate((el) => ({
      card: getComputedStyle(el.parentElement!).paddingBlock,
      row: getComputedStyle(el).paddingBlock,
    }));
    expect(padding).toEqual({ card: "0px", row: "16px" });
    for (const name of [
      "Edit Costa de noche",
      "Deactivate Costa de noche",
      "Delete Costa de noche",
    ]) {
      const button = row.getByRole("button", { name, exact: true });
      await expect(button).toHaveAttribute("data-variant", "ghost");
      await expect(button).toHaveAttribute("data-size", "icon-lg");
      await expect(button).toHaveText("");
      const box = (await button.boundingBox())!;
      expect([box.width, box.height]).toEqual([44, 44]);
      await button.focus();
      await expect(
        page.getByRole("tooltip", { name: name.split(" ")[0], exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
    }
    const before = await row.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    await row.hover();
    expect(
      await row.evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe(before);
    const [action, card] = await Promise.all([
      row.getByRole("group").boundingBox(),
      row.boundingBox(),
    ]);
    expect(action!.y).toBe(card!.y + 16);
    await row
      .getByRole("button", {
        name: "Edit Costa de noche",
        exact: true,
      })
      .press("Enter");
    await expect(page).toHaveURL(/\/playlists\/11$/);
  });
}

for (const width of [1440, 768, 390]) {
  test(`1AQ disabled actions remain discoverable without executing ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1100 });
    await page.goto("/admin-bandcamp-demo.html");
    await page
      .getByRole("radio", { name: "Sin conexión", exact: true })
      .click();
    const header = page.locator('[data-slot="admin-page-header"]');
    for (const name of ["Sync collection", "Refresh Radar"]) {
      const button = header.getByRole("button", { name, exact: true });
      await expect(button).toBeDisabled();
      const trigger = header.getByRole("group", { name, exact: true });
      await trigger.hover();
      await expect(
        page.getByRole("tooltip", { name, exact: true }),
      ).toBeVisible();
      await page.mouse.move(0, 0);
      await trigger.focus();
      await expect(trigger).toBeFocused();
      await expect(
        page.getByRole("tooltip", { name, exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Enter");
      await page.keyboard.press("Space");
      await expect(button).toBeDisabled();
      await page.keyboard.press("Escape");
      await trigger.blur();
      // Wait for the shared exit animation and Radix pointer-grace cleanup before
      // switching from keyboard interaction to the next pointer trigger.
      await expect(
        page.getByRole("tooltip", { name, exact: true }),
      ).toHaveCount(0);
    }
    await expect(page.getByRole("status").first()).toHaveText(
      "Sin acciones de muestra.",
    );
  });
}
