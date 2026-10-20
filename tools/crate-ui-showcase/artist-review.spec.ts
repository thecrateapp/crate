import { expect, test } from "@playwright/test";
for (const host of ["storybook", "standalone"] as const)
  for (const width of [375, 1200]) {
    test(`${host} artist contracts ${width}px`, async ({ page }) => {
      test.setTimeout(60000);
      await page.setViewportSize({ width, height: 1000 });
      const errors: string[] = [],
        requests: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (new URL(request.url()).pathname.startsWith("/api/"))
          requests.push(request.url());
      });
      await page.goto(
        host === "storybook"
          ? "http://127.0.0.1:6006/iframe.html?id=reviews-1bc-artist--complete&viewMode=story"
          : "http://127.0.0.1:5186/review-1bc-artist.html",
      );
      await expect(
        page.getByRole("heading", { name: "Artist", exact: true }),
      ).toBeVisible({ timeout: 30000 });
      const hero = page.getByRole("group", {
        name: "Artist hero · managed image adapter and actual secondary actions",
      });
      for (const text of ["Radio", "Setlist", "Follow", "Share"]) {
        const caption = hero.getByText(text, { exact: true });
        await expect(caption).toHaveCSS("text-transform", "uppercase");
        expect(
          await caption.evaluate(
            (element) => getComputedStyle(element).fontFamily,
          ),
        ).toMatch(/Mono/i);
        const button = caption.locator("..");
        expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      for (const caption of ["More", "Bandcamp"])
        await expect(hero.getByText(caption, { exact: true })).toHaveCSS(
          "text-transform",
          "uppercase",
        );
      const play = hero.getByRole("button", { name: "Play", exact: true });
      expect(
        await play.evaluate((element) => getComputedStyle(element).fontFamily),
      ).toMatch(/Poppins/i);
      await hero.getByLabel("Follow", { exact: true }).click();
      await expect(hero.getByText("Following", { exact: true })).toHaveCSS(
        "text-transform",
        "uppercase",
      );
      await expect(hero.getByLabel("Unfollow", { exact: true })).toBeVisible();
      await hero.getByRole("button", { name: "More", exact: true }).click();
      await page.getByRole("menuitem", { name: "Share", exact: true }).click();
      await expect(page.getByLabel("Artist fixture event")).toHaveText(
        "Share from menu requested",
      );
      await hero
        .getByRole("button", { name: "Support on Bandcamp", exact: true })
        .click();
      await expect(page.getByLabel("Artist fixture event")).toHaveText(
        "Bandcamp requested",
      );
      await page
        .getByRole("button", { name: "Show Bandcamp owned", exact: true })
        .click();
      await expect(
        hero.getByLabel("Owned on Bandcamp", { exact: true }),
      ).toBeVisible();
      await expect(hero.getByText("Bandcamp", { exact: true })).toHaveCSS(
        "text-transform",
        "uppercase",
      );
      await page
        .getByRole("button", { name: "Show Bandcamp action", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Use long artist name", exact: true })
        .click();
      await expect(
        hero.getByRole("heading", {
          name: "Nocturnal Ensemble and the Extraordinary Orchestra of the Very Long Night",
          exact: true,
        }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page
        .getByRole("button", { name: "Use short artist name", exact: true })
        .click();
      const meta = hero.getByTestId("page-hero-meta");
      for (const caption of await meta.locator(".font-mono").all())
        await expect(caption).toHaveCSS("text-transform", "uppercase");
      await expect
        .poll(() =>
          hero
            .getByTestId("desktop-hero-artwork-mask")
            .locator("img")
            .evaluate((element) => (element as HTMLImageElement).naturalWidth),
        )
        .toBeGreaterThan(0);
      if (width === 1200) {
        await expect(hero.getByTestId("page-hero-artwork")).toHaveCSS(
          "width",
          "160px",
        );
        await expect(
          hero.getByTestId("desktop-hero-artwork-mask").locator("img"),
        ).toHaveCSS("object-position", "50% calc(50% + 100px)");
        const grid = page
          .getByRole("region", { name: "Albums", exact: true })
          .getByTestId("media-grid");
        expect(
          await grid.evaluate(
            (element) =>
              getComputedStyle(element).gridTemplateColumns.split(" ").length,
          ),
        ).toBe(5);
      }
      const gaps = await page
        .locator('[data-slot="form-field"][data-layout="stacked"]')
        .evaluateAll((fields) =>
          fields.map((field) => {
            const caption = field.querySelector(
              '[data-slot="form-field-label"]',
            )!;
            const control = Array.from(field.children).find(
              (child) => child !== caption,
            )!;
            return (
              control.getBoundingClientRect().top -
              caption.getBoundingClientRect().bottom
            );
          }),
        );
      for (const gap of gaps) expect(gap).toBeCloseTo(8, 1);
      await page
        .getByRole("button", { name: "Open biography", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "Nocturnal Ensemble biography",
      });
      await expect(dialog).toBeVisible();
      const paragraphs = dialog.getByText(
        /The artist moves between nocturnal electronics/,
      );
      const metrics = await paragraphs.evaluate((element) => {
        const paragraph = element.closest("p")!,
          body = element.closest(
            '[class*="crate-overlay-body"]',
          )! as HTMLElement;
        const style = getComputedStyle(body);
        return {
          width: paragraph.clientWidth,
          available:
            body.clientWidth -
            parseFloat(style.paddingLeft) -
            parseFloat(style.paddingRight),
        };
      });
      expect(Math.abs(metrics.width - metrics.available)).toBeLessThanOrEqual(
        1,
      );
      await expect(dialog.getByText("popularity", { exact: true })).toHaveCSS(
        "text-transform",
        "uppercase",
      );
      await expect(dialog.getByText("0%", { exact: true })).toHaveCount(2);
      await expect(
        dialog.getByRole("table", { name: "Current members" }),
      ).toBeVisible();
      await dialog.getByRole("link", { name: "Website", exact: true }).click();
      await expect(page.getByLabel("Artist fixture event")).toHaveText(
        "External biography link requested",
      );
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Open biography", exact: true }),
      ).toBeFocused();
      await page
        .getByRole("button", { name: "Open setlist", exact: true })
        .click();
      const setlist = page.getByRole("dialog", { name: "Probable Setlist" });
      await expect(setlist.getByText("80%", { exact: true })).toHaveCSS(
        "text-transform",
        "uppercase",
      );
      await expect(setlist.locator('[data-slot="hairline-row"]')).toHaveCount(
        2,
      );
      await setlist
        .getByRole("button", { name: "Export", exact: true })
        .click();
      await expect(
        setlist.getByRole("button", { name: /Saving/ }),
      ).toBeDisabled();
      await setlist
        .getByRole("button", { name: "Play Setlist", exact: true })
        .click();
      await expect(setlist).toHaveCount(0);
      await expect(page.getByLabel("Artist fixture event")).toHaveText(
        "Play setlist requested",
      );
      const read = page.getByRole("combobox", {
        name: "Read state",
        exact: true,
      });
      for (const state of ["loading", "error", "not found", "sparse"]) {
        await read.click();
        await page.getByRole("option", { name: state, exact: true }).click();
        if (state === "loading")
          await expect(page.getByTestId("loading-state")).toHaveCount(1);
        if (state === "error") {
          await expect(page.getByRole("alert")).toBeVisible();
          await page
            .getByRole("button", { name: "Retry", exact: true })
            .click();
        }
        if (state === "not found")
          await expect(
            page.getByText("Artist not found", { exact: true }),
          ).toBeVisible();
        if (state === "sparse")
          await expect(hero.getByText("0 tracks", { exact: true })).toHaveCSS(
            "text-transform",
            "uppercase",
          );
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(requests).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
