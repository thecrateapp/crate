import { expect, test } from "@playwright/test";
for (const host of ["storybook", "standalone"] as const)
  for (const width of [375, 1200]) {
    test(`${host} Radio and Paths ${width}px`, async ({ page }) => {
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
          ? "http://127.0.0.1:6006/iframe.html?id=reviews-1bc-radio-paths--complete&viewMode=story"
          : "http://127.0.0.1:5186/review-1bc-radio-paths.html",
      );
      const journey = page.locator('[data-slot="path-cover-journey"]');
      await expect(journey).toBeVisible({ timeout: 30000 });
      await expect(journey.getByText("3 of 20")).toBeVisible();
      await expect(
        journey.getByRole("button", { name: "Next step", exact: true }),
      ).toHaveCount(0);
      // Keyboard browsing moves focus only; the stage keeps the queue's step.
      await journey.locator(".path-step-thumb[data-focused]").focus();
      await page.keyboard.press("ArrowRight");
      await expect(
        journey.getByRole("button", { name: /Play step 4:/ }),
      ).toBeFocused();
      await expect(journey.getByText("3 of 20")).toBeVisible();
      await expect(page.getByLabel("Radio Paths fixture event")).toHaveText(
        "No action yet",
      );
      await page
        .getByRole("button", { name: "Simulate next track", exact: true })
        .click();
      await expect(journey.locator('[aria-current="step"]')).toHaveAttribute(
        "aria-label",
        /Play step 4:/,
      );
      // Boundary inspection must not leave a request that steals outside focus.
      const simulate = page.getByRole("button", {
        name: "Simulate next track",
        exact: true,
      });
      const cover = journey.locator(".path-step-thumb[data-focused]");
      await cover.focus();
      await page.keyboard.press("Home");
      await page.keyboard.press("ArrowLeft");
      await simulate.click();
      await expect(simulate).toBeFocused();
      await expect(journey.getByText("5 of 20")).toBeVisible();
      // Playback may advance without a pointer event: keep an existing cover focus coherent.
      await cover.focus();
      await simulate.evaluate((node) => (node as HTMLButtonElement).click());
      await expect(journey.getByText("6 of 20")).toBeVisible();
      await expect(cover).toBeFocused();
      await page
        .getByRole("combobox", { name: "Path tracks", exact: true })
        .click();
      await page.getByRole("option", { name: "50", exact: true }).click();
      await expect(journey.getByText("1 of 50")).toBeVisible();
      const first = journey.getByRole("button", { name: /Play step 1:/ });
      await first.focus();
      await page.keyboard.press("End");
      await expect(
        journey.getByRole("button", { name: /Play step 50:/ }),
      ).toBeFocused();
      await expect(journey.getByText("1 of 50")).toBeVisible();
      await page.keyboard.press("Enter");
      await expect(page.getByLabel("Radio Paths fixture event")).toHaveText(
        "Play from step 50",
      );
      await expect(journey.getByText("50 of 50")).toBeVisible();
      await expect(journey.locator(".path-step-thumb")).toHaveCount(50);
      for (const thumb of await journey
        .locator(".path-step-thumb .crate-media-cover")
        .all()) {
        const box = await thumb.boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(48);
        expect(box!.height).toBeGreaterThanOrEqual(48);
      }
      // The transition overlay only exists while a step change is in flight.
      const frame = journey.locator(".path-cover-frame");
      await expect(frame).not.toHaveAttribute("data-transitioning", {
        timeout: 6000,
      });
      await expect
        .poll(() =>
          journey
            .locator('[data-slot="path-cover-stage"]')
            .evaluate(
              (node) =>
                node
                  .getAnimations({ subtree: true })
                  .filter((animation) => animation.playState === "running")
                  .length,
            ),
        )
        .toBe(0);
      await page
        .getByRole("button", { name: "Pause simulation", exact: true })
        .click();
      await expect(journey.getByText("50 of 50")).toBeVisible();
      await expect(frame).not.toHaveAttribute("data-transitioning");
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(journey).toHaveAttribute("data-motion", "off");
      await journey.getByRole("button", { name: /Play step 49:/ }).click();
      await expect(journey.getByText("49 of 50")).toBeVisible();
      await expect(frame).not.toHaveAttribute("data-transitioning");
      await expect(journey.locator(".path-cover-canvas")).toHaveCount(0);
      await expect(journey.locator(".path-cover-art")).toHaveCSS(
        "animation-name",
        "none",
      );
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.getByRole("tab", { name: "Paths", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Music Paths", exact: true }),
      ).toBeVisible();
      const origin = page.getByRole("group", { name: "From", exact: true });
      await origin.getByRole("button", { name: "Change", exact: true }).click();
      await page
        .getByRole("searchbox", { name: "From", exact: true })
        .fill("amb");
      await page.getByRole("button", { name: "Ambient", exact: true }).click();
      await expect(
        page.getByRole("slider", { name: "Path length", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Compute Path", exact: true })
        .click();
      await expect(page.getByLabel("Radio Paths fixture event")).toHaveText(
        "Compute path requested",
      );
      await page.getByRole("tab", { name: "Radio", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Radio", exact: true }),
      ).toBeVisible();
      const search = page.getByRole("searchbox", {
        name: "Start from anything",
        exact: true,
      });
      await search.fill("costa");
      await page
        .getByRole("button", { name: "Costa Norte", exact: true })
        .click();
      await expect(page.getByLabel("Radio Paths fixture event")).toHaveText(
        "Radio requested: Costa Norte",
      );
      const zero = page.getByText("0 plays", { exact: true });
      await expect(zero.first()).toHaveCSS("text-transform", "uppercase");
      await page
        .getByRole("checkbox", { name: "Pending actions", exact: true })
        .click();
      await expect(
        page.getByRole("button", {
          name: "Start artist station 1",
          exact: true,
        }),
      ).toBeDisabled();
      await page
        .getByRole("checkbox", { name: "Pending actions", exact: true })
        .click();
      for (const state of ["loading", "empty", "error", "ready"]) {
        await page
          .getByRole("combobox", { name: "Read state", exact: true })
          .click();
        await page.getByRole("option", { name: state, exact: true }).click();
        if (state === "loading")
          await expect(page.getByTestId("loading-state").first()).toBeVisible();
        if (state === "error")
          await expect(page.getByRole("alert").first()).toBeVisible();
      }
      const gaps = await page
        .locator('[data-slot="form-field"][data-layout="stacked"]:visible')
        .evaluateAll((fields) =>
          fields.map((field) => {
            const caption = field.querySelector(
              '[data-slot="form-field-label"]',
            )!;
            const next = Array.from(field.children).find(
              (child) => child !== caption,
            )!;
            return (
              next.getBoundingClientRect().top -
              caption.getBoundingClientRect().bottom
            );
          }),
        );
      for (const gap of gaps) expect(gap).toBeCloseTo(8, 1);
      for (const action of await page
        .locator('[data-slot="action-group"] [data-slot="button"]:visible')
        .all()) {
        const box = await action.boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
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
