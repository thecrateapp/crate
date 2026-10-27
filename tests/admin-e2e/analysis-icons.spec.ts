import { emulateCoarsePointer, expect, test } from "./fixtures";
import snapshot from "./fixtures/ops-snapshot.json";
import analysis from "./fixtures/analysis-status.json";
for (const width of [1440, 768, 390]) {
  test.describe(`Analysis text controls ${width}`, () => {
    test.use({ viewport: { width, height: 1100 } });
    test("preserves real page actions, coverage, keyboard and responsive geometry", async ({
      page,
      openAdminPage,
      adminApi,
    }) => {
      adminApi.respondTo("/api/admin/ops-snapshot", { ...snapshot, analysis });
      await openAdminPage("/analysis");
      const main = page.getByRole("main");
      await expect(
        main.getByRole("heading", { name: "Analysis", exact: true }),
      ).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expect(
        main.getByRole("heading", { name: "Analysis", exact: true }),
      ).toHaveCSS("font-family", /Bricolage Grotesque/);
      await expect(
        main.getByRole("heading", { name: "Pipeline coverage", exact: true }),
      ).toHaveCSS("font-family", /JetBrains Mono/);
      await expect(
        main.getByRole("button", { name: "Refresh", exact: true }),
      ).toHaveCSS("font-family", /^Roboto/);
      const loaded = await page.evaluate(() =>
        Array.from(document.fonts)
          .filter((face) => face.status === "loaded")
          .map((face) => face.family),
      );
      for (const family of ["Bricolage Grotesque", "JetBrains Mono", "Roboto"])
        expect(loaded).toContain(family);
      for (const field of await main.locator(".crate-form-field").all()) {
        await expect(field.locator(":scope > :first-child")).toHaveCSS(
          "font-family",
          /JetBrains Mono/,
        );
        const reading = field.locator(":scope > :nth-child(2)");
        await expect(reading).toHaveCSS("font-family", /JetBrains Mono/);
        await expect(reading).toHaveCSS("font-variant-numeric", "tabular-nums");
      }
      await expect(main.locator("svg")).toHaveCount(6);
      await expect(main.locator('svg[data-admin-ux^="header-"]')).toHaveCount(
        5,
      );
      await expect(main.locator("svg:not([data-admin-ux])")).toHaveClass(
        /solar-magnifier-outline/,
      );
      await expect(
        main.getByText("1,200 tracks", { exact: true }),
      ).toBeVisible();
      await expect(main.getByText("4 failed", { exact: true })).toHaveAttribute(
        "data-tone",
        "danger",
      );
      await expect(main.getByText("Marea", { exact: true })).toBeVisible();
      await expect(
        main.getByRole("article", {
          name: "Last audio fingerprint",
          exact: true,
        }),
      ).toContainText("Bruma");
      await expect(
        main.getByRole("article", {
          name: "Last audio fingerprint",
          exact: true,
        }),
      ).toContainText("Chromaprint");
      const queue = main.getByRole("button", {
        name: "Sync lyrics",
        exact: true,
      });
      await queue.focus();
      await queue.press("Enter");
      await expect
        .poll(() =>
          adminApi.calls.some(
            (call) =>
              call.path === "/api/manage/sync-lyrics" && call.method === "POST",
          ),
        )
        .toBe(true);
      expect(
        adminApi.calls.filter(
          (call) => call.path === "/api/manage/sync-lyrics",
        ),
      ).toEqual([
        {
          method: "POST",
          path: "/api/manage/sync-lyrics",
          body: { limit: 1000 },
        },
      ]);
      await expect(queue).toBeEnabled();
      await expect(queue.locator("svg")).toHaveCount(0);
      const refresh = main.getByRole("button", {
        name: "Refresh",
        exact: true,
      });
      await refresh.focus();
      await refresh.press("Space");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const fields = await main
        .locator(".crate-form-field")
        .evaluateAll((nodes) =>
          nodes.map(
            (node) =>
              node.children[1]!.getBoundingClientRect().top -
              node.children[0]!.getBoundingClientRect().bottom,
          ),
        );
      expect(fields).toHaveLength(27);
      expect(new Set(fields)).toEqual(new Set([8]));
      await emulateCoarsePointer(page);
      for (const action of await main.getByRole("button").all()) {
        const box = await action.boundingBox();
        expect(Math.min(box!.height, box!.width)).toBeGreaterThanOrEqual(44);
      }
    });
  });
}
