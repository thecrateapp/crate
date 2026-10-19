import { expect, test } from "./fixtures";
for (const width of [1440, 768, 390]) {
  test.describe(`operational controls ${width}`, () => {
    test.use({ viewport: { width, height: 1100 } });
    test("keeps Logs and Stack usable with text actions and bounded UX glyphs", async ({
      page,
      openAdminPage,
      adminApi,
    }) => {
      await openAdminPage("/logs");
      const main = page.getByRole("main");
      await expect(
        main
          .getByRole("button", { name: "Refresh", exact: true })
          .locator("svg"),
      ).toHaveAttribute("data-admin-ux", "header-refresh");
      await main.getByRole("button", { name: "Pause live" }).click();
      await expect(
        main.getByRole("button", { name: "Resume live" }).locator("svg"),
      ).toHaveCount(1);
      await main.getByRole("button", { name: "Resume live" }).click();
      const search = main.getByRole("textbox", { name: "Search worker logs" });
      await search.fill("Costa Norte");
      await expect(
        main.getByText("Sample analysis needs attention", { exact: true }),
      ).toBeVisible();
      await expect(
        main.getByText("Sample library ready", { exact: true }),
      ).toBeHidden();
      await search.clear();
      await main.getByRole("radio", { name: "Warning", exact: true }).focus();
      await page.keyboard.press("Space");
      await expect(
        main.getByText("Sample sync waiting", { exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      adminApi.respondTo("/api/stack/container/worker/logs", {
        name: "worker",
        logs: "Sample service log",
      });
      await openAdminPage("/stack");
      const filters = main.getByRole("radiogroup", { name: "Service state" });
      const all = filters.getByRole("radio", { name: "All", exact: true });
      await all.focus();
      await all.press("ArrowRight");
      await expect(
        filters.getByRole("radio", { name: "Running", exact: true }),
      ).toHaveAttribute("aria-checked", "true");
      await filters
        .getByRole("radio", { name: "Stopped", exact: true })
        .click();
      await expect(
        main.getByRole("article", { name: "Service worker", exact: true }),
      ).toHaveCount(0);
      await all.click();
      const card = main.getByRole("article", {
        name: "Service worker",
        exact: true,
      });
      await expect(card).toBeVisible();
      const show = card.getByRole("button", {
        name: "Show logs for worker",
        exact: true,
      });
      await show.focus();
      await show.press("Space");
      await expect(
        card.getByRole("region", { name: "Logs for worker", exact: true }),
      ).toContainText("Sample service log");
      const restart = card.getByRole("button", {
        name: "Restart service worker",
        exact: true,
      });
      await expect(restart.locator("svg")).toHaveCount(0);
      await restart.click();
      const dialog = page.getByRole("alertdialog");
      await expect(
        dialog.getByRole("button", { name: "Cancel", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(restart).toBeFocused();
      await restart.click();
      await dialog
        .getByRole("button", { name: "Restart", exact: true })
        .click();
      await expect
        .poll(
          () =>
            adminApi.calls.filter(
              (call) => call.path === "/api/stack/container/worker/restart",
            ).length,
        )
        .toBe(1);
      await card
        .getByRole("button", { name: "Stop service worker", exact: true })
        .click();
      await expect
        .poll(
          () =>
            adminApi.calls.filter(
              (call) => call.path === "/api/stack/container/worker/stop",
            ).length,
        )
        .toBe(1);
      await main
        .getByRole("button", { name: "Start service scanner", exact: true })
        .click();
      await expect
        .poll(
          () =>
            adminApi.calls.filter(
              (call) => call.path === "/api/stack/container/scanner/start",
            ).length,
        )
        .toBe(1);
      for (const button of await card.getByRole("button").all()) {
        const box = await button.boundingBox();
        expect(Math.min(box!.width, box!.height)).toBeGreaterThanOrEqual(44);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
  });
}
