import { expect, test } from "@playwright/test";
for (const host of ["storybook", "standalone"] as const)
  for (const width of [375, 1200])
    test(`${host} remaining Settings ${width}px`, async ({ browser }) => {
      test.setTimeout(60000);
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
        hasTouch: width === 375,
        isMobile: width === 375,
        reducedMotion: "reduce",
      });
      const page = await context.newPage(),
        errors: string[] = [],
        writes: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (new URL(request.url()).pathname.startsWith("/api/"))
          writes.push(request.url());
      });
      await page.goto(
        host === "storybook"
          ? "http://127.0.0.1:6006/iframe.html?id=reviews-1bd-settings-remaining--complete&viewMode=story"
          : "http://127.0.0.1:5186/review-1bd-settings-remaining.html",
      );
      await expect(
        page.getByRole("heading", {
          name: "Settings integrations",
          exact: true,
        }),
      ).toBeVisible({ timeout: 30000 });
      const storage = await page.evaluate(() =>
        JSON.stringify(Object.entries(localStorage).sort()),
      );
      async function choose(label: string, option: string) {
        await page.getByRole("combobox", { name: label, exact: true }).click();
        await page.getByRole("option", { name: option, exact: true }).click();
      }
      async function measure() {
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        for (const field of await page
          .locator('[data-slot="form-field"][data-layout="stacked"]:visible')
          .all()) {
          const gap = await field.evaluate((field) => {
            const caption = field.querySelector(
                '[data-slot="form-field-label"]',
              )!,
              control = Array.from(field.children).find(
                (child) => child !== caption,
              )!;
            return (
              control.getBoundingClientRect().top -
              caption.getBoundingClientRect().bottom
            );
          });
          expect(gap).toBeCloseTo(8, 1);
        }
        for (const caption of await page
          .locator('[data-slot="form-field-label"] > .uppercase:visible')
          .all()) {
          await expect(caption).toHaveCSS("text-transform", "uppercase");
          await expect(caption).toHaveCSS("font-weight", "400");
          expect(
            await caption.evaluate((el) => getComputedStyle(el).fontFamily),
          ).toMatch(/JetBrains/i);
        }
        for (const control of await page
          .locator(
            '[data-slot="input"]:visible,[data-slot="select-trigger"]:visible',
          )
          .all()) {
          expect((await control.boundingBox())!.height).toBeCloseTo(
            width === 375 ? 44 : 40,
            1,
          );
          await expect(control).toHaveCSS("font-size", "15px");
        }
        for (const control of await page
          .locator('[data-slot="button"][data-size="default"]:visible')
          .all())
          expect((await control.boundingBox())!.height).toBeCloseTo(
            width === 375 ? 44 : 40,
            1,
          );
      }
      await measure();
      const scrobbling = page.getByRole("region", {
        name: "Scrobbling",
        exact: true,
      });
      await expect(
        scrobbling.getByText("Record Collector", { exact: true }),
      ).toHaveCSS("text-transform", "none");
      await page
        .getByRole("checkbox", {
          name: "Bandcamp totals unavailable",
          exact: true,
        })
        .check();
      const bandcamp = page.getByRole("region", {
        name: "Bandcamp",
        exact: true,
      });
      await expect(
        bandcamp.getByRole("button", { name: "Disconnect", exact: true }),
      ).toBeEnabled();
      await bandcamp
        .getByRole("button", { name: "Retry", exact: true })
        .click();
      await expect(page.getByLabel("Settings fixture event")).toHaveText(
        "Bandcamp totals retry requested locally",
      );
      await page
        .getByRole("checkbox", {
          name: "Bandcamp totals unavailable",
          exact: true,
        })
        .uncheck();

      await page
        .getByRole("checkbox", { name: "Long values", exact: true })
        .check();
      await measure();
      await page
        .getByRole("checkbox", { name: "Long values", exact: true })
        .uncheck();
      await choose("Read state", "error");
      await expect(page.getByRole("alert")).toHaveCount(3);
      await expect(
        page.getByRole("button", { name: "Retry", exact: true }),
      ).toHaveCount(3);
      await expect(page.getByLabel("API token", { exact: true })).toHaveCount(
        0,
      );
      await choose("Read state", "loading");
      await expect(page.getByTestId("loading-state")).toHaveCount(2);
      await expect(
        page.getByText("Checking OpenSubsonic credential…"),
      ).toBeVisible();
      await choose("Read state", "ready");
      await page
        .getByRole("button", { name: "Rotate key", exact: true })
        .click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      const token = page.getByLabel("API token", { exact: true });
      await token.fill("fixture-only");
      await token.press("Enter");
      await expect(page.getByLabel("Settings fixture event")).toHaveText(
        "ListenBrainz connected locally",
      );
      await expect(token).toHaveCount(0);
      await page
        .getByRole("checkbox", { name: "Linked services", exact: true })
        .uncheck();
      const cookie = page.getByLabel("Session cookie", { exact: true });
      await expect(cookie).toBeVisible();
      await measure();
      await choose("Runtime", "Native desktop");
      await expect(
        page.getByRole("button", {
          name: "Connect in Bandcamp window",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Finish connection", exact: true }),
      ).toBeVisible();
      await page.getByRole("checkbox", { name: "Busy", exact: true }).check();
      await expect(
        page.getByRole("button", {
          name: "Connect in Bandcamp window",
          exact: true,
        }),
      ).toBeDisabled();
      await expect(page.getByRole("switch")).toBeDisabled();
      await page.getByRole("checkbox", { name: "Busy", exact: true }).uncheck();
      await page.getByRole("tab", { name: "Location", exact: true }).click();
      await measure();
      const radius = page.getByRole("combobox", {
          name: "Search radius",
          exact: true,
        }),
        before = (await radius.boundingBox())!.width;
      await choose("Search radius", "100 km");
      expect((await radius.boundingBox())!.width).toBeCloseTo(before, 1);
      const city = page.getByRole("combobox", { name: "City", exact: true });
      await city.fill("Ma");
      await expect(
        page.getByRole("option", {
          name: "Manchester, United Kingdom",
          exact: true,
        }),
      ).toBeVisible();
      await city.press("ArrowDown");
      const firstOption = page.getByRole("option", {
        name: "Madrid, Spain",
        exact: true,
      });
      const inactiveColor = await page
        .getByRole("option", {
          name: "Manchester, United Kingdom",
          exact: true,
        })
        .evaluate((el) => getComputedStyle(el).color);
      await expect(firstOption).toHaveAttribute("data-active", "true");
      await expect
        .poll(() => firstOption.evaluate((el) => getComputedStyle(el).color))
        .not.toBe(inactiveColor);
      await city.press("ArrowDown");
      await city.press("Enter");
      await expect(city).toHaveValue("Manchester");
      await expect(page.getByRole("listbox")).toHaveCount(0);
      await choose("Location for shows", "Near me");
      await expect(city).toHaveCount(0);
      await measure();
      await page.getByRole("tab", { name: "Offline", exact: true }).click();
      await measure();
      await page
        .getByRole("button", { name: "Sync offline copy now", exact: true })
        .click();
      await expect(page.getByLabel("Settings fixture event")).toHaveText(
        "Offline sync requested locally",
      );
      await page
        .getByRole("checkbox", { name: "Empty mirror", exact: true })
        .check();
      await expect(
        page.getByRole("group", { name: "Tracks", exact: true }),
      ).toHaveAccessibleDescription("0/0");
      await expect(
        page.getByRole("button", {
          name: "Remove offline copies",
          exact: true,
        }),
      ).toBeDisabled();
      await page
        .getByRole("checkbox", { name: "Browser quota available", exact: true })
        .uncheck();
      await expect(
        page.getByRole("meter", { name: "Storage", exact: true }),
      ).toHaveCount(0);
      await page
        .getByRole("checkbox", { name: "Offline supported", exact: true })
        .uncheck();
      await measure();
      await page.getByRole("tab", { name: "Servers", exact: true }).click();
      await measure();
      await expect(
        page.getByRole("button", { name: "Home server", exact: true }),
      ).toBeDisabled();
      await page
        .getByRole("button", { name: "Studio server", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Studio server", exact: true }),
      ).toBeDisabled();
      await page
        .getByRole("button", { name: "Remove Home server", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Home server", exact: true }),
      ).toHaveCount(0);
      await page
        .getByRole("checkbox", { name: "Long values", exact: true })
        .check();
      await measure();
      expect(
        await page.evaluate(() =>
          JSON.stringify(Object.entries(localStorage).sort()),
        ),
      ).toBe(storage);
      expect(errors).toEqual([]);
      expect(writes).toEqual([]);
      await context.close();
    });
