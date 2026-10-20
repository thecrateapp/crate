import { expect, test } from "@playwright/test";
for (const host of ["storybook", "standalone"] as const)
  for (const width of [375, 1200]) {
    test(`${host} Explore browse contracts ${width}px`, async ({ page }) => {
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
          ? "http://127.0.0.1:6006/iframe.html?id=reviews-1bc-explore--complete&viewMode=story"
          : "http://127.0.0.1:5186/review-1bc-explore.html",
      );
      await expect(
        page.getByRole("heading", { name: "Explore and browse", exact: true }),
      ).toBeVisible({ timeout: 30000 });
      const cards = page.locator('[data-slot="card"]');
      await expect(cards).toHaveCount(6);
      for (const card of await cards.all()) {
        await expect(card).toHaveCSS("box-shadow", "none");
        await expect(card).toHaveCSS("backdrop-filter", "none");
      }
      await page
        .getByRole("button", {
          name: "Radio",
          exact: true,
        })
        .click({ position: { x: 8, y: 132 } });
      await expect(page.getByLabel("Fixture event")).toHaveText("Open /radio");
      const room = page.locator('[data-variant="room"]');
      await expect(room.locator("img")).toHaveCSS("z-index", "-10");
      await expect(room.locator('div[aria-hidden="true"]')).toHaveCSS(
        "z-index",
        "-10",
      );
      await room.click({ position: { x: 4, y: 4 } });
      await expect(page.getByLabel("Fixture event")).toHaveText(
        "/explore?keep=one&keep=two&genre=mathcore#browse",
      );
      const recovery = page.getByRole("group", {
        name: "Artwork failure and recovery",
        exact: true,
      });
      await recovery
        .getByRole("button", { name: "Fail first artwork", exact: true })
        .click();
      await expect(recovery.locator("img")).toBeVisible();
      await expect(recovery.getByLabel("Artwork status")).toHaveText(
        "Fallback artwork",
      );
      await recovery
        .getByRole("button", { name: "Exhaust artwork", exact: true })
        .click();
      await expect(recovery.locator("img")).toHaveCount(0);
      await recovery
        .getByRole("button", { name: "Recover artwork", exact: true })
        .click();
      await expect(recovery.locator("img")).toBeVisible();
      await expect(recovery.getByLabel("Artwork status")).toHaveText(
        "Primary artwork",
      );
      const relation = page.getByText("Parent", { exact: true });
      await expect(relation).toHaveCSS("text-transform", "uppercase");
      expect(
        await relation.evaluate(
          (element) => getComputedStyle(element).fontFamily,
        ),
      ).toMatch(/Mono/i);
      await expect(page.getByText("0 albums", { exact: true })).toHaveCSS(
        "text-transform",
        "uppercase",
      );
      await expect(page.getByText("0 playlists", { exact: true })).toHaveCSS(
        "text-transform",
        "uppercase",
      );
      const decade = page.getByRole("button", { name: "1990s", exact: true });
      await expect(decade).not.toHaveAttribute("aria-pressed");
      await decade.click();
      await expect(page.getByLabel("Fixture event")).toHaveText(
        "/explore?keep=one&keep=two&decade=1990s#browse",
      );
      await page
        .getByRole("button", { name: "Back", exact: true })
        .first()
        .click();
      await expect(page.getByLabel("Fixture event")).toHaveText(
        "/explore?keep=one&keep=two#browse",
      );
      const mood = page.getByRole("button", { name: "Dark", exact: true });
      await expect(mood).toHaveCSS("height", "44px");
      await mood.click();
      await expect(
        page.getByRole("button", { name: "Chill", exact: true }),
      ).toBeDisabled();
      await page
        .getByRole("button", { name: "Complete request", exact: true })
        .click();
      await expect(mood).toBeEnabled();
      await page
        .getByRole("button", { name: "Play genre radio", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Play genre radio", exact: true }),
      ).toBeDisabled();
      await page
        .getByRole("button", { name: "Complete request", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Hide artwork", exact: true })
        .click();
      await expect(page.locator('[data-variant="room"] img')).toHaveCount(0);
      await page
        .getByRole("button", { name: "Show artwork", exact: true })
        .click();
      await expect(page.locator('[data-variant="room"] img')).toHaveCount(1);
      const read = page.getByRole("combobox", {
        name: "Read state",
        exact: true,
      });
      for (const state of ["loading", "error", "empty"]) {
        await read.click();
        await page.getByRole("option", { name: state, exact: true }).click();
        if (state === "loading")
          await expect(page.getByTestId("loading-state")).toHaveCount(2);
        if (state === "error")
          await expect(page.getByRole("alert")).toHaveCount(2);
        if (state === "empty")
          await expect(
            page.getByText("No results in this fixture"),
          ).toHaveCount(2);
      }
      await read.click();
      await page.getByRole("option", { name: "error", exact: true }).click();
      await page
        .getByRole("button", { name: "Retry", exact: true })
        .first()
        .click();
      await expect(page.getByRole("alert")).toHaveCount(0);
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
      expect(requests).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
