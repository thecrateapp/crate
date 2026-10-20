import { expect, test } from "@playwright/test";
import en from "../../app/listen/src/i18n/catalogs/en.json";
for (const host of ["storybook", "standalone"] as const)
  for (const width of [375, 1200]) {
    test(`${host} Settings ${width}px`, async ({ browser }) => {
      test.setTimeout(60000);
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
        hasTouch: width === 375,
        isMobile: width === 375,
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      const errors: string[] = [],
        requests: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (new URL(request.url()).pathname.startsWith("/api/"))
          requests.push(request.url());
      });
      await page.goto(
        host === "storybook"
          ? "http://127.0.0.1:6006/iframe.html?id=reviews-1bd-settings--complete&viewMode=story"
          : "http://127.0.0.1:5186/review-1bd-settings.html",
      );
      await expect(
        page.getByRole("heading", { name: "Settings", exact: true }),
      ).toBeVisible({ timeout: 30000 });
      const tabs = page.getByRole("tablist", { name: "Settings", exact: true });
      await expect(tabs.getByRole("tab")).toHaveCount(5);
      await expect(page.getByRole("tabpanel")).toHaveCount(1);
      await tabs.getByRole("tab", { name: "Preferences", exact: true }).focus();
      await page.keyboard.press("End");
      await expect(
        tabs.getByRole("tab", { name: "Offline", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      await expect(
        page.getByRole("heading", { name: "Offline mirror", exact: true }),
      ).toBeVisible();
      const listBounds = (await tabs.boundingBox())!;
      const selectedBounds = (await tabs
        .getByRole("tab", { name: "Offline", exact: true })
        .boundingBox())!;
      expect(selectedBounds.x + selectedBounds.width).toBeLessThanOrEqual(
        listBounds.x + listBounds.width + 1,
      );
      expect(selectedBounds.height).toBeGreaterThanOrEqual(44);
      if (width === 1200) {
        await page.setViewportSize({ width: 375, height: 1000 });
        await expect
          .poll(async () => {
            const list = (await tabs.boundingBox())!;
            const current = (await tabs
              .getByRole("tab", { name: "Offline", exact: true })
              .boundingBox())!;
            return current.x + current.width <= list.x + list.width + 1;
          })
          .toBe(true);
        await page.setViewportSize({ width, height: 1000 });
      }
      await page.keyboard.press("Home");
      await expect(
        tabs.getByRole("tab", { name: "Preferences", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      const motion = page.getByRole("combobox", {
        name: en["settings.interface.motionLabel"],
        exact: true,
      });
      const effects = page.getByRole("combobox", {
        name: en["settings.interface.effectsLabel"],
        exact: true,
      });
      const density = page.getByRole("combobox", {
        name: en["settings.interface.densityLabel"],
        exact: true,
      });
      const motionY = (await motion.boundingBox())!.y;
      const effectsY = (await effects.boundingBox())!.y;
      const densityY = (await density.boundingBox())!.y;
      if (width === 1200) {
        expect(effectsY).toBeCloseTo(motionY, 1);
        expect(densityY).toBeCloseTo(motionY, 1);
        await page.setViewportSize({ width: 600, height: 1000 });
        expect((await effects.boundingBox())!.y).toBeCloseTo(
          (await motion.boundingBox())!.y,
          1,
        );
        expect((await density.boundingBox())!.y).toBeGreaterThan(
          (await motion.boundingBox())!.y,
        );
        await page.setViewportSize({ width, height: 1000 });
      } else {
        expect(effectsY).toBeGreaterThan(motionY);
        expect(densityY).toBeGreaterThan(effectsY);
      }
      const accent = await page
        .getByText("1BD · Settings", { exact: true })
        .evaluate((node) => getComputedStyle(node).color);
      await expect(
        page.getByRole("heading", { name: "Interface", exact: true }),
      ).toHaveCSS("color", accent);
      await expect(
        page.getByText("Current language: English", { exact: true }),
      ).toHaveCSS("text-transform", "none");
      const storageBefore = await page.evaluate(() =>
        JSON.stringify(Object.entries(localStorage).sort()),
      );
      const choose = async (label: string, option: string) => {
        await page.getByRole("combobox", { name: label, exact: true }).click();
        await page.getByRole("option", { name: option, exact: true }).click();
      };
      const measure = async () => {
        const gaps = await page
          .locator('[data-slot="form-field"][data-layout="stacked"]:visible')
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
        expect(gaps.length).toBeGreaterThan(0);
        gaps.forEach((gap) => expect(gap).toBeCloseTo(8, 1));
        for (const caption of await page
          .locator('[data-slot="form-field-label"] > .uppercase:visible')
          .all()) {
          await expect(caption).toHaveCSS("text-transform", "uppercase");
          await expect(caption).toHaveCSS("font-weight", "400");
          expect(
            await caption.evaluate((node) => getComputedStyle(node).fontFamily),
          ).toMatch(/JetBrains/i);
        }
        const controls = await page
          .locator(
            '[data-slot="input"]:visible, [data-slot="select-trigger"]:visible',
          )
          .all();
        for (const control of controls) {
          expect((await control.boundingBox())!.height).toBeCloseTo(
            width === 375 ? 44 : 40,
            1,
          );
          await expect(control).toHaveCSS("font-size", "15px");
        }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      };
      await measure();
      await choose(
        en["settings.interface.densityLabel"],
        en["settings.interface.values.compact"],
      );
      await tabs.getByRole("tab", { name: "Playback", exact: true }).click();
      await measure();
      const quality = page.getByRole("combobox", {
        name: en["settings.playback.streamQuality"],
        exact: true,
      });
      const before = (await quality.boundingBox())!.width;
      await quality.click();
      const balanced = page.getByRole("option", {
        name: en["settings.playback.delivery.balanced"],
        exact: true,
      });
      await expect(
        balanced.getByText(
          en["settings.playback.delivery.balancedDescription"],
          { exact: true },
        ),
      ).toBeVisible();
      await expect(balanced).toHaveAccessibleDescription(
        en["settings.playback.delivery.balancedDescription"],
      );
      await page.keyboard.press("Escape");
      await choose(
        en["settings.playback.streamQuality"],
        en["settings.playback.delivery.original"],
      );
      expect((await quality.boundingBox())!.width).toBeCloseTo(before, 1);
      await page
        .getByRole("switch", {
          name: en["settings.playback.smartPlaylistSuggestions"],
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("slider", {
          name: en["settings.playback.suggestionCadence"],
          exact: true,
        }),
      ).toBeDisabled();
      await choose("Runtime", "Mobile web / iOS");
      await expect(
        page.getByRole("slider", {
          name: en["settings.playback.crossfade"],
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("switch", { name: en["player.equalizer"], exact: true }),
      ).toHaveCount(0);
      await choose("Runtime", "Android native");
      await expect(
        page.getByRole("switch", { name: en["player.equalizer"], exact: true }),
      ).toBeVisible();
      await page.getByRole("tab", { name: "Account", exact: true }).click();
      await measure();
      await expect(
        page.getByText(en["settings.account.timezone"], { exact: true }),
      ).toHaveCount(0);
      const email = page.getByRole("textbox", { name: "Email", exact: true });
      await expect(email).toHaveAttribute("readonly", "");
      await expect(email).toBeEnabled();
      const profile = page.getByRole("region", {
        name: "Profile",
        exact: true,
      });
      await expect(profile.getByRole("textbox").first()).toHaveAttribute(
        "type",
        "email",
      );
      if (width === 1200)
        expect((await email.boundingBox())!.y).toBeCloseTo(
          (await profile
            .getByRole("textbox", { name: "Display name", exact: true })
            .boundingBox())!.y,
          1,
        );
      for (const heading of [
        "Listening preferences",
        "Connected accounts",
        "Security",
      ]) {
        await expect(
          page.getByRole("heading", { name: heading, exact: true }),
        ).toBeVisible();
      }
      const connected = page.getByRole("region", {
        name: "Connected accounts",
        exact: true,
      });
      await expect(
        connected.getByText("Google", { exact: true }),
      ).toBeVisible();
      await expect(connected.getByText("Apple", { exact: true })).toBeVisible();
      for (const row of await connected
        .locator('[data-slot="entity-row"]')
        .all()) {
        expect((await row.boundingBox())!.width).toBeLessThanOrEqual(576);
      }
      const name = page.getByRole("textbox", {
        name: en["settings.account.displayName"],
        exact: true,
      });
      await name.fill("Mixed Case Name");
      await expect(name).toHaveValue("Mixed Case Name");
      await page.getByRole("tab", { name: "Preferences", exact: true }).click();
      await expect(name).toBeHidden();
      await page.getByRole("tab", { name: "Account", exact: true }).click();
      await expect(name).toHaveValue("Mixed Case Name");
      await page
        .getByRole("button", {
          name: en["settings.account.saveProfile"],
          exact: true,
        })
        .click();
      await expect(page.getByLabel("Settings fixture event")).toHaveText(
        "Profile save requested locally",
      );
      await page
        .getByRole("button", {
          name: en["settings.account.changePassword"],
          exact: true,
        })
        .click();
      await measure();
      await page
        .getByLabel(en["settings.account.currentPassword"], { exact: true })
        .fill("fixture only");
      await page
        .getByRole("button", { name: en["common.cancel"], exact: true })
        .click();
      await page
        .getByRole("button", {
          name: en["settings.account.changePassword"],
          exact: true,
        })
        .click();
      await expect(
        page.getByLabel(en["settings.account.currentPassword"], {
          exact: true,
        }),
      ).toHaveValue("");
      await page
        .getByRole("checkbox", {
          name: "Pending account/device action",
          exact: true,
        })
        .check();
      await expect(
        page.getByRole("button", { name: en["common.saving"], exact: true }),
      ).toBeDisabled();
      await page
        .getByRole("checkbox", {
          name: "Pending account/device action",
          exact: true,
        })
        .uncheck();
      await page.getByRole("tab", { name: "Connections", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Revoke Crate Web", exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByText("Desktop app · Linux", { exact: true }),
      ).toHaveCSS("text-transform", "none");
      await expect(
        page.getByText("Last seen Oct 20, 2026, 14:29", { exact: true }),
      ).toHaveCSS("text-transform", "none");
      await page
        .getByRole("checkbox", { name: "Long values", exact: true })
        .check();
      await measure();
      await page
        .getByRole("checkbox", { name: "Long values", exact: true })
        .uncheck();
      for (const state of ["loading", "empty", "error", "cached error"]) {
        await choose("Device read state", state);
        if (state === "loading")
          await expect(page.getByTestId("loading-state")).toBeVisible();
        if (state === "empty")
          await expect(page.getByTestId("empty-state")).toBeVisible();
        if (state.includes("error")) {
          await expect(page.getByRole("alert")).toHaveText(
            new RegExp(en["settings.connectDevices.toasts.loadFailed"]),
          );
          await expect(page.getByTestId("empty-state")).toHaveCount(0);
          if (state === "cached error")
            await expect(
              page.getByText("Living room desktop", { exact: true }),
            ).toBeVisible();
        }
      }
      await page
        .getByRole("button", { name: en["common.retry"], exact: true })
        .click();
      await page
        .getByRole("button", {
          name: "Revoke Living room desktop",
          exact: true,
        })
        .click();
      await page
        .getByRole("button", {
          name: en["settings.connectDevices.revoke"],
          exact: true,
        })
        .click();
      await expect(
        page.getByText("Living room desktop", { exact: true }),
      ).toHaveCount(0);
      await page
        .getByRole("checkbox", { name: "Connect feature", exact: true })
        .uncheck();
      await expect(
        page.getByRole("region", {
          name: en["settings.connectDevices.title"],
          exact: true,
        }),
      ).toHaveCount(0);
      expect(
        await page.evaluate(() =>
          JSON.stringify(Object.entries(localStorage).sort()),
        ),
      ).toBe(storageBefore);
      expect(errors).toEqual([]);
      expect(requests).toEqual([]);
      await context.close();
    });
  }
