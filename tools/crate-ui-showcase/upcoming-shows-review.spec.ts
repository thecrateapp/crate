import { expect, test } from "@playwright/test";
for (const host of ["storybook", "standalone"] as const)
  for (const width of [375, 1200]) {
    test(`${host} upcoming and show contracts ${width}px`, async ({ page }) => {
      test.setTimeout(60000);
      await page.setViewportSize({ width, height: 1000 });
      await page.clock.setFixedTime(new Date("2026-10-20T12:00:00"));
      const errors: string[] = [],
        requests: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (new URL(request.url()).pathname.startsWith("/api/"))
          requests.push(request.url());
      });
      await page.goto(
        host === "storybook"
          ? "http://127.0.0.1:6006/iframe.html?id=reviews-1bc-upcoming-shows--complete&viewMode=story"
          : "http://127.0.0.1:5186/review-1bc-upcoming-shows.html",
      );
      await expect(
        page.getByRole("heading", { name: "Radar", exact: true }),
      ).toBeVisible({ timeout: 30000 });
      await expect(
        page.getByTitle("post-punk · 83% · enrichment"),
      ).toBeVisible();
      await expect(page.getByTitle("drone · 0%")).toBeVisible();
      await expect(page.getByTitle("ambient", { exact: true })).toBeVisible();
      const ticket = page.locator("article").filter({
        has: page.getByRole("link", {
          name: "Nocturnal Ensemble",
          exact: true,
        }),
      });
      const compact = page.locator('[data-slot="upcoming-event-row"]');
      for (const row of await compact.all()) {
        const image = row.locator('[data-slot="media-cover"]');
        await expect(image).toHaveCSS("width", "88px");
        await expect(image).toHaveCSS("height", "88px");
        await expect(row.locator('[data-slot="upcoming-date"]')).toHaveCSS(
          "width",
          "56px",
        );
      }
      await expect(page.getByText("Pre-release", { exact: true })).toHaveCount(
        0,
      );
      const released = page
        .locator('[data-slot="upcoming-timing"]')
        .filter({ hasText: /^Released$/ });
      await expect(released).toHaveCount(1);
      await expect(released).toHaveCSS("text-transform", "uppercase");
      await expect(released.locator('[data-slot="info-badge"]')).toHaveCount(0);
      const nextRelease = page.getByRole("link", {
        name: "Open Luz de octubre",
        exact: true,
      });
      await expect(
        nextRelease.locator('[data-slot="upcoming-timing"]'),
      ).toContainText("5 days to go");
      const nextShow = page.getByRole("button", {
        name: /Costa Norte.*Sala Radar/,
      });
      await expect(
        nextShow.locator('[data-slot="upcoming-timing"]'),
      ).toContainText("15 days to go");
      for (const row of await compact.all()) {
        const article = row.locator("xpath=ancestor::article");
        const rowBox = await row.boundingBox();
        const articleBox = await article.boundingBox();
        expect(articleBox!.height).toBeGreaterThanOrEqual(rowBox!.height);
      }
      const rowAction = nextRelease
        .locator("xpath=ancestor::article")
        .getByRole("button", { name: "More actions", exact: true });
      const baseBackground = await rowAction.evaluate(
        (node) => getComputedStyle(node).backgroundColor,
      );
      const baseColor = await rowAction.evaluate(
        (node) => getComputedStyle(node).color,
      );
      await rowAction.hover();
      await expect(rowAction).toHaveCSS("background-color", baseBackground);
      await expect
        .poll(() => rowAction.evaluate((node) => getComputedStyle(node).color))
        .not.toBe(baseColor);
      const accentColor = await page
        .locator('[data-slot="upcoming-date"]')
        .first()
        .locator("span")
        .first()
        .evaluate((node) => getComputedStyle(node).color);
      await expect(rowAction).toHaveCSS("color", accentColor);
      await page.mouse.move(0, 0);
      const search = page.getByRole("searchbox", {
        name: "Search",
        exact: true,
      });
      await search.fill("no matching signal");
      await expect(
        page.getByText("Nothing matches your filters", { exact: true }),
      ).toBeVisible();
      await search.fill("");
      await page.getByRole("radio", { name: "Releases", exact: true }).click();
      await expect(
        page.getByRole("link", { name: "Open Luz de octubre", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /Costa Norte.*Sala Radar/ }),
      ).toHaveCount(0);
      await page.getByRole("radio", { name: "All", exact: true }).click();
      await ticket
        .getByRole("button", { name: "More actions", exact: true })
        .click();
      await page
        .getByRole("menuitem", { name: "Open artist", exact: true })
        .click();
      await expect(page.getByLabel("Upcoming fixture event")).toHaveText(
        "Artist requested from menu",
      );
      await ticket
        .getByRole("button", { name: "Play Setlist", exact: true })
        .click();
      await expect(page.getByLabel("Upcoming fixture event")).toHaveText(
        "Play setlist requested",
      );
      await ticket
        .getByRole("button", { name: "Close show details", exact: true })
        .click();
      const toggle = page.getByRole("button", {
        name: /Nocturnal Ensemble.*The Forum/,
      });
      await toggle.focus();
      await page.keyboard.press("Enter");
      await expect(
        ticket.getByRole("link", { name: "Nocturnal Ensemble", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Use long content", exact: true })
        .click();
      const longTicket = page.locator("article").filter({
        has: page.getByRole("link", {
          name: /Nocturnal Ensemble and the Extraordinary/,
        }),
      });
      await expect(longTicket.getByRole("listitem")).toHaveCount(12);
      await expect
        .poll(() =>
          longTicket.evaluate(
            (article) =>
              article.getBoundingClientRect().height >=
              article.scrollHeight - 1,
          ),
        )
        .toBe(true);
      await page.setViewportSize({
        width: width === 375 ? 420 : 800,
        height: 1000,
      });
      await expect
        .poll(() =>
          longTicket.evaluate(
            (article) =>
              article.getBoundingClientRect().height >=
              article.scrollHeight - 1,
          ),
        )
        .toBe(true);
      await page.setViewportSize({ width, height: 1000 });
      await page
        .getByRole("button", { name: "Use short content", exact: true })
        .click();
      await ticket.getByRole("button", { name: "Attend", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Next show", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Nocturnal Ensemble", exact: true }),
      ).toHaveCount(1);
      await page
        .getByRole("checkbox", { name: "Pending actions", exact: true })
        .click();
      await expect(
        ticket.getByRole("button", { name: "Play Setlist", exact: true }),
      ).toBeDisabled();
      await expect(
        ticket.getByRole("button", { name: "Going", exact: true }),
      ).toBeDisabled();
      await page
        .getByRole("checkbox", { name: "Pending actions", exact: true })
        .click();
      const gaps = await page
        .locator('[data-slot="form-field"][data-layout="stacked"]')
        .evaluateAll((fields) =>
          fields.map((field) => {
            const caption = field.querySelector(
              '[data-slot="form-field-label"]',
            )!;
            const sample = Array.from(field.children).find(
              (child) => child !== caption,
            )!;
            return (
              sample.getBoundingClientRect().top -
              caption.getBoundingClientRect().bottom
            );
          }),
        );
      for (const gap of gaps) expect(gap).toBeCloseTo(8, 1);
      for (const action of await page
        .locator('[data-slot="action-group"] [data-slot="button"]')
        .all()) {
        const box = await action.boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      const read = page.getByRole("combobox", {
        name: "Read state",
        exact: true,
      });
      for (const state of [
        "loading",
        "error",
        "no follows",
        "empty",
        "not found",
        "genre",
        "sparse",
        "cached",
      ]) {
        await read.click();
        await page.getByRole("option", { name: state, exact: true }).click();
        if (state === "loading")
          await expect(page.getByTestId("loading-state")).toBeVisible();
        if (state === "error") {
          await expect(page.getByRole("alert")).toBeVisible();
          await page
            .getByRole("button", { name: "Retry", exact: true })
            .click();
        }
        if (state === "no follows")
          await expect(
            page.getByText("Follow some artists to unlock Radar", {
              exact: true,
            }),
          ).toBeVisible();
        if (state === "empty")
          await expect(
            page.getByText("No new Radar signals yet", { exact: true }),
          ).toBeVisible();
        if (state === "not found")
          await expect(
            page.getByText("Genre not found", { exact: true }),
          ).toBeVisible();
        if (state === "sparse")
          await expect(
            page.getByRole("link", { name: "Get Tickets", exact: true }),
          ).toHaveAttribute("aria-disabled", "true");
        if (state === "cached") {
          await expect(
            page.getByRole("link", {
              name: "Open Luz de octubre",
              exact: true,
            }),
          ).toBeVisible();
          await expect(page.getByTestId("loading-state")).toHaveCount(0);
        }
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(errors).toEqual([]);
      expect(requests).toEqual([]);
    });
  }
