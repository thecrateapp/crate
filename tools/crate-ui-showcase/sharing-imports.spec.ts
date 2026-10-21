import { expect, test, type Page } from "@playwright/test";

async function select(page: Page, label: string, value: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: value, exact: true }).click();
}
for (const host of ["storybook", "standalone"] as const)
  for (const width of [375, 1200]) {
    test(`${host} sharing and imports ${width}px`, async ({ page }) => {
      test.setTimeout(90000);
      page.setDefaultTimeout(8000);
      await page.setViewportSize({ width, height: 1000 });
      const errors: string[] = [],
        writes: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (
          new URL(request.url()).pathname.startsWith("/api/") ||
          request.method() !== "GET"
        )
          writes.push(request.url());
      });
      await page.goto(
        host === "storybook"
          ? "/iframe.html?id=reviews-1bd-sharing-imports--complete&viewMode=story"
          : "http://127.0.0.1:5186/review-1bd-sharing-imports.html",
      );
      await expect(
        page.getByRole("heading", { name: "Sharing and imports", exact: true }),
      ).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const storage = await page.evaluate(() =>
        JSON.stringify({ ...localStorage }),
      );
      await select(page, "Sharing state", "crate");
      const open = page.getByRole("button", {
        name: "Open sharing",
        exact: true,
      });
      await open.click();
      const dialog = page.getByRole("dialog", {
        name: "Share Crate",
        exact: true,
      });
      await expect(dialog).toBeVisible();
      const context = dialog.getByText("Share Crate", { exact: true });
      await expect(context).toHaveCSS("font-family", /JetBrains Mono/);
      await expect(context).toHaveCSS("text-transform", "uppercase");
      await expect(
        dialog.getByRole("heading", { name: "Night Music" }),
      ).toHaveCSS("font-family", /Bricolage Grotesque/);
      const whatsapp = dialog.getByRole("button", {
        name: "WhatsApp",
        exact: true,
      });
      await expect
        .poll(async () => (await whatsapp.boundingBox())!.height)
        .toBeGreaterThanOrEqual(47.99);
      const caption = whatsapp.getByText("WhatsApp", { exact: true });
      await expect(caption).toHaveCSS("text-transform", "uppercase");
      await expect(caption).toHaveCSS("font-size", "11px");
      if (width === 1200) {
        await whatsapp.hover();
        await expect(caption).toHaveCSS(
          "color",
          await context.evaluate((el) => getComputedStyle(el).color),
        );
        await dialog.getByRole("heading", { name: "Night Music" }).hover();
        await whatsapp.press("Tab");
        await page.keyboard.press("Shift+Tab");
        await expect(whatsapp).toBeFocused();
        await expect(caption).toHaveCSS(
          "color",
          await context.evaluate((el) => getComputedStyle(el).color),
        );
      }
      await expect(whatsapp).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await dialog
        .getByRole("button", { name: "Instagram Story", exact: true })
        .click();
      await expect(
        dialog.getByRole("heading", { name: "Story style", exact: true }),
      ).toBeVisible();
      await dialog.getByRole("button", { name: "Wall", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByLabel("Sharing fixture event")).toHaveText(
        "Story style 1 requested locally",
      );
      await expect(open).toBeFocused();
      await select(page, "Sharing state", "unavailable");
      await open.click();
      await expect(
        page.getByRole("button", { name: "Instagram Story", exact: true }),
      ).toBeDisabled();
      const unavailableCaption = page
        .getByRole("button", { name: "Instagram Story", exact: true })
        .getByText("Instagram Story", { exact: true });
      const disabledColor = await unavailableCaption.evaluate(
        (el) => getComputedStyle(el).color,
      );
      await unavailableCaption.hover({ force: true });
      await expect(unavailableCaption).toHaveCSS("color", disabledColor);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);

      await page.getByRole("tab", { name: "bandcamp", exact: true }).click();
      const bandcamp = page.getByRole("group", {
        name: "Actual Bandcamp page",
        exact: true,
      });
      await expect(bandcamp.getByText("Owned", { exact: true })).toHaveCSS(
        "text-transform",
        "uppercase",
      );
      const purchases = bandcamp.getByRole("region", {
        name: "Owned purchases",
        exact: true,
      });
      const radar = bandcamp.getByRole("region", {
        name: "Bandcamp Radar",
        exact: true,
      });
      expect(
        await bandcamp
          .getByRole("region")
          .evaluateAll((nodes) =>
            nodes.map((node) => node.getAttribute("aria-label")),
          ),
      ).toEqual(["Owned purchases", "Bandcamp Radar", "Wishlist"]);
      await expect(purchases.locator('[data-slot="entity-card"]')).toHaveCount(
        4,
      );
      await expect(purchases.locator('[data-slot="entity-row"]')).toHaveCount(
        0,
      );
      await expect(radar.locator('[data-slot="entity-row"]')).toHaveCount(4);
      await expect(radar.locator('[data-slot="entity-card"]')).toHaveCount(0);
      const radarOpen = radar.getByRole("button", {
        name: "Open on Bandcamp: Night Music",
        exact: true,
      });
      await radarOpen.click();
      await expect(page.getByLabel("Bandcamp fixture event")).toHaveText(
        "Open on Bandcamp requested locally",
      );
      await expect(radar.getByRole("button", { name: /^Import:/ })).toHaveCount(
        0,
      );
      const tile = purchases.locator('[data-slot="entity-card"]').first();
      expect(
        await tile.evaluate((root) =>
          Math.abs(
            root
              .querySelector('[data-slot="entity-artwork"]')!
              .getBoundingClientRect().width -
              root
                .querySelector('[data-slot="media-cover"]')!
                .getBoundingClientRect().width,
          ),
        ),
      ).toBeLessThanOrEqual(0.1);
      await expect(tile.locator('[data-slot="entity-row"]')).toHaveCount(0);
      const cardArtwork = tile.locator('[data-slot="entity-artwork"]');
      const menuTrigger = tile.getByRole("button", { name: /More actions:/ });
      await tile.hover();
      const artworkBox = (await cardArtwork.boundingBox())!,
        menuBox = (await menuTrigger.boundingBox())!;
      expect(menuBox.x).toBeGreaterThanOrEqual(artworkBox.x);
      expect(menuBox.y).toBeGreaterThanOrEqual(artworkBox.y);
      expect(menuBox.x - artworkBox.x).toBeLessThanOrEqual(10);
      expect(menuBox.y - artworkBox.y).toBeLessThanOrEqual(10);
      await expect(tile.getByText("Night Music", { exact: true })).toHaveCSS(
        "white-space",
        "nowrap",
      );
      await expect(tile.getByRole("button", { name: /^Import:/ })).toHaveCount(
        0,
      );
      await expect(
        bandcamp
          .locator('[data-slot="entity-row"] [data-slot="media-cover"]')
          .first(),
      ).toHaveCSS("width", "56px");
      // Deliver Playwright's queued viewport scroll before opening a menu that
      // intentionally dismisses on document scroll (as a human would scroll, then click).
      await menuTrigger.scrollIntoViewIfNeeded();
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await menuTrigger.click();
      await page
        .getByRole("menuitem", { name: "Open on Bandcamp", exact: true })
        .click();
      await expect(page.getByLabel("Bandcamp fixture event")).toHaveText(
        "Open on Bandcamp requested locally",
      );
      await menuTrigger.click();
      await page.getByRole("menuitem", { name: "Import", exact: true }).click();
      await expect(page.getByLabel("Bandcamp fixture event")).toHaveText(
        "Import requested locally",
      );
      await select(page, "Bandcamp read state", "error");
      await expect(bandcamp.getByRole("alert")).toBeVisible();
      await expect(bandcamp.getByText("0", { exact: true })).toHaveCount(0);
      await bandcamp
        .getByRole("button", { name: "Retry", exact: true })
        .click();
      await expect(page.getByLabel("Bandcamp fixture event")).toHaveText(
        "Bandcamp retry requested locally",
      );
      await select(page, "Bandcamp read state", "empty");
      await expect(bandcamp.getByText("0", { exact: true })).toHaveCount(3);
      await select(page, "Bandcamp read state", "long");
      const longTitle = tile.locator(".crate-entity-title");
      await expect(longTitle).toHaveCSS("text-overflow", "ellipsis");
      expect((await longTitle.boundingBox())!.width).toBeGreaterThan(
        (await cardArtwork.boundingBox())!.width * 0.9,
      );
      expect(
        (await tile.boundingBox())!.height -
          (await cardArtwork.boundingBox())!.height,
      ).toBeLessThan(85);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);

      await page.getByRole("tab", { name: "upload", exact: true }).click();
      const upload = page.getByRole("group", {
        name: "Actual upload form",
        exact: true,
      });
      await expect(
        upload.getByRole("button", { name: "Choose files", exact: true }),
      ).toBeVisible();
      await expect(upload.locator('input[type="file"]')).toBeHidden();
      const dropzone = upload.locator("[data-upload-dropzone]");
      await expect(dropzone.locator("svg.crate-logo")).toHaveAttribute(
        "data-crate-logo-effects",
        "off",
      );
      await expect(dropzone).toHaveCSS("border-style", "dashed");
      await expect(dropzone).toHaveCSS("min-height", "256px");
      const files = await page.evaluateHandle(() => {
        const transfer = new DataTransfer();
        transfer.items.add(
          new File(["local fixture"], "Dropped Music.flac", {
            type: "audio/flac",
          }),
        );
        return transfer;
      });
      await dropzone.dispatchEvent("dragenter", { dataTransfer: files });
      await expect(dropzone).toHaveAttribute("data-dragging", "true");
      await dropzone.dispatchEvent("drop", { dataTransfer: files });
      await expect(dropzone).toHaveAttribute("data-dragging", "false");
      await expect(
        upload.getByText("Dropped Music.flac", { exact: true }),
      ).toBeVisible();
      await select(page, "Upload state", "unknown progress");
      await expect(upload.getByRole("progressbar")).toHaveCount(2);
      for (const bar of await upload.getByRole("progressbar").all())
        await expect(bar).not.toHaveAttribute("aria-valuenow");
      await select(page, "Upload state", "confirmed progress");
      await expect(
        upload.getByRole("progressbar", {
          name: "Evening Music.flac",
          exact: true,
        }),
      ).toHaveAttribute("aria-valuenow", "50");
      await expect(
        upload.getByRole("button", { name: "Uploading 1/3", exact: true }),
      ).toBeDisabled();
      await select(page, "Upload state", "files");
      await expect(
        upload.getByText("Evening Music.flac", { exact: true }),
      ).toHaveCSS("text-transform", "none");
      await upload
        .getByRole("button", { name: "Import to library", exact: true })
        .click();
      await expect(upload.getByRole("status")).toContainText("Upload received");
      await expect(page.getByLabel("Upload fixture event")).toHaveText(
        "Upload queued locally",
      );

      await page.getByRole("tab", { name: "remote", exact: true }).click();
      await page
        .getByRole("button", { name: "Make available locally", exact: true })
        .click();
      const confirmation = page.getByRole("alertdialog");
      await expect(confirmation).toBeVisible();
      await confirmation
        .getByRole("button", { name: "Confirm import", exact: true })
        .click();
      await expect(
        page.getByText("Waiting for administrator approval", { exact: true }),
      ).toHaveCSS("text-transform", "uppercase");
      await select(page, "Remote import state", "downloading");
      await expect(
        page.getByRole("progressbar", { name: "Downloading 25%", exact: true }),
      ).toHaveAttribute("aria-valuenow", "25");
      await page
        .getByRole("checkbox", {
          name: "Unknown download progress",
          exact: true,
        })
        .check();
      await expect(page.getByRole("progressbar")).not.toHaveAttribute(
        "aria-valuenow",
      );
      await expect(page.getByRole("progressbar")).toHaveAttribute(
        "aria-label",
        "Downloading…",
      );
      await select(page, "Remote import state", "failed");
      await page
        .getByRole("button", { name: "Try again", exact: true })
        .click();
      await confirmation
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      await select(page, "Remote import state", "completed");
      await expect(
        page.getByText("Available locally", { exact: true }),
      ).toHaveCSS("font-family", /JetBrains Mono/);

      await page
        .getByRole("tab", { name: "contributions", exact: true })
        .click();
      const contributions = page.getByRole("group", {
        name: "Actual contribution cards",
        exact: true,
      });
      const cards = contributions.locator('[data-slot="entity-card"]');
      await expect(cards).toHaveCount(3);
      await expect(
        contributions.locator('[data-slot="media-grid"]'),
      ).toHaveAttribute("data-density", "default");
      await expect(
        contributions.locator('[data-slot="entity-row"]'),
      ).toHaveCount(0);
      const contribution = cards.first();
      const unavailable = cards.last();
      const bandcampSource = contribution.getByText("Bandcamp", {
        exact: true,
      });
      const uploadSource = cards.nth(1).getByText("Upload", { exact: true });
      for (const source of [bandcampSource, uploadSource]) {
        await expect(source).toHaveCSS("font-family", /JetBrains Mono/);
        await expect(source).toHaveCSS("text-transform", "uppercase");
        await expect(source).toHaveCSS("border-top-width", "0px");
        await expect(source.locator("svg")).toHaveAttribute(
          "aria-hidden",
          "true",
        );
        await expect(source.locator("svg")).toHaveAttribute("width", "12");
      }
      expect(
        await bandcampSource.evaluate((el) => getComputedStyle(el).color),
      ).not.toBe(
        await uploadSource.evaluate((el) => getComputedStyle(el).color),
      );
      const cover = contribution.locator('[data-slot="entity-artwork"]');
      const box = (await cover.boundingBox())!;
      expect(Math.abs(box.width - box.height)).toBeLessThan(1);
      expect(box.width).toBeGreaterThanOrEqual(100);
      const contributionTitle = cards.nth(1).locator(".crate-entity-title");
      await expect(contributionTitle).toHaveCSS("text-overflow", "ellipsis");
      await contribution.locator('[data-slot="entity-primary"]').click();
      await expect(page.getByLabel("Contributions fixture event")).toHaveText(
        "Album opened locally",
      );
      const more = contribution.getByRole("button", {
        name: "More actions",
        exact: true,
      });
      async function openContributionMenu() {
        await more.scrollIntoViewIfNeeded();
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              ),
            ),
        );
        await more.click();
      }
      await openContributionMenu();
      const moreBox = (await more.boundingBox())!;
      const coverBox = (await cover.boundingBox())!;
      expect(moreBox.x).toBeGreaterThanOrEqual(coverBox.x);
      expect(moreBox.x + moreBox.width).toBeLessThanOrEqual(
        coverBox.x + coverBox.width,
      );
      expect(moreBox.y).toBeGreaterThanOrEqual(coverBox.y);
      await page
        .getByRole("menuitem", { name: "Play album", exact: true })
        .click();
      await expect(page.getByLabel("Contributions fixture event")).toHaveText(
        "Play requested locally",
      );
      await openContributionMenu();
      await page.getByRole("menuitem", { name: "Export", exact: true }).click();
      await expect(page.getByLabel("Contributions fixture event")).toHaveText(
        "Export requested locally",
      );
      await openContributionMenu();
      await page
        .getByRole("menuitem", { name: "Remove contribution", exact: true })
        .click();
      const withdraw = page.getByRole("alertdialog");
      await expect(withdraw).toBeVisible();
      await withdraw
        .getByRole("button", { name: "Keep it", exact: true })
        .click();
      await expect(more).toBeFocused();
      const pendingMenu = unavailable.getByRole("button", {
        name: "More actions",
        exact: true,
      });
      await pendingMenu.scrollIntoViewIfNeeded();
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await pendingMenu.click();
      await expect(
        page.getByRole("menuitem", { name: "Export", exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole("menuitem", { name: "Play album", exact: true }),
      ).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(pendingMenu).toBeFocused();
      const gaps = await page
        .locator('[data-slot="form-field"][data-layout="stacked"]')
        .evaluateAll((fields) =>
          fields.map((field) => {
            const label = field.querySelector(
              '[data-slot="form-field-label"]',
            )!;
            const control = Array.from(field.children).find(
              (child) => child !== label,
            )!;
            return (
              control.getBoundingClientRect().top -
              label.getBoundingClientRect().bottom
            );
          }),
        );
      for (const gap of gaps) expect(gap).toBeCloseTo(8, 1);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        await page.evaluate(() => JSON.stringify({ ...localStorage })),
      ).toBe(storage);
      expect(errors).toEqual([]);
      expect(writes).toEqual([]);
    });
  }
