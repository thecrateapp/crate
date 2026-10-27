import { emulateCoarsePointer, expect, test } from "./fixtures";
import fixture from "./fixtures/health-1ad.json";
for (const width of [1440, 768, 390])
  test.describe(`Library Health built ${width}`, () => {
    test.use({ viewport: { width, height: 1100 } });
    test("preserves real controls, confirmation, routes, targets and measurements", async ({
      page,
      openAdminPage,
      adminApi,
    }) => {
      adminApi.respondTo("/api/admin/health-snapshot", fixture.health);
      adminApi.respondTo("/api/manage/repair-catalog", fixture.catalog);
      adminApi.respondTo("/api/admin/tasks-snapshot", fixture.tasks);
      adminApi.respondTo(
        "/api/manage/health-issues/fix-type/artist_layout_fix",
        {
          task_id: "sample-repair",
          task_ids: ["sample-repair"],
          fixable: 1,
          allowed: true,
        },
      );
      await openAdminPage("/health");
      const main = page.getByRole("main");
      const toggle = main.getByRole("button", {
        name: "Review issues: Artist Layout Fix",
        exact: true,
      });
      await expect(toggle).toBeVisible();
      await expect(toggle).toHaveAccessibleDescription(
        /Artist Layout Fix 1 issue high Needs review DB \+ filesystem.*Checked.*Review artist-by-artist before applying this fix\./,
      );
      await main
        .locator("summary")
        .filter({ hasText: /^Latest activity/ })
        .click();
      await expect(
        main.getByText("4 issues found", { exact: true }),
      ).toBeVisible();
      await expect(main.locator("button button,button a")).toHaveCount(0);
      await expect(
        main.getByRole("heading", { name: "Library Health", exact: true }),
      ).toHaveCSS("font-family", /Bricolage Grotesque/);
      await toggle.focus();
      await page.keyboard.press("Space");
      const region = main.getByRole("region", {
        name: "Artist Layout Fix issues",
        exact: true,
      });
      await expect(region).toBeVisible();
      await expect(region).toHaveCSS("border-left-color", "rgb(6, 182, 212)");
      await expect(region).toHaveCSS("border-left-width", "1px");
      await expect(toggle).toHaveCSS("color", "rgb(103, 232, 249)");
      const primary = region.getByRole("link", {
        name: "Review and repair",
        exact: true,
      });
      await expect(primary).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await expect(primary).toHaveCSS("border-top-color", "rgb(6, 182, 212)");
      await expect(primary).toHaveCSS("border-top-width", "1px");
      await expect(primary).toHaveCSS("color", "rgb(6, 182, 212)");
      await main
        .locator("summary")
        .filter({ hasText: /^Filter issues$/ })
        .click();
      expect(
        await region
          .locator(".crate-form-field")
          .evaluateAll((nodes) =>
            nodes.map(
              (n) =>
                n.children[1]!.getBoundingClientRect().top -
                n.children[0]!.getBoundingClientRect().bottom,
            ),
          ),
      ).toEqual([8, 8]);
      await emulateCoarsePointer(page);
      const coarse = await page.evaluate(
        () => matchMedia("(pointer: coarse)").matches,
      );
      for (const c of await main
        .locator("button:visible,a:visible,summary:visible")
        .all()) {
        const box = await c.boundingBox(),
          pill = await c.getAttribute("aria-pressed");
        // Transformed layout can report 43.999992 px for a 44 px target.
        expect(
          Number(Math.min(box!.width, box!.height).toFixed(2)),
        ).toBeGreaterThanOrEqual(pill !== null && !coarse ? 32 : 44);
      }

      const link = region.getByRole("link", {
        name: "Review and repair",
        exact: true,
      });
      await expect(link).toHaveAttribute("href", /\?repair=1$/);
      const fix = toggle
        .locator("xpath=ancestor::article")
        .getByRole("button", {
          name: "Queue repair for Artist Layout Fix",
          exact: true,
        });
      await fix.click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      await expect(fix).toBeFocused();
      await fix.click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Queue repairs", exact: true })
        .click();
      expect(adminApi.calls).toContainEqual({
        method: "POST",
        path: "/api/manage/health-issues/fix-type/artist_layout_fix",
        body: null,
      });
      await region
        .getByRole("button", { name: "Mark as resolved", exact: true })
        .click();
      expect(adminApi.calls).toContainEqual({
        method: "POST",
        path: "/api/manage/health-issues/102/resolve",
        body: null,
      });
      await main
        .getByRole("button", {
          name: "Review issues: Unindexed Files",
          exact: true,
        })
        .click();
      await main
        .getByRole("region", { name: "Unindexed Files issues" })
        .getByRole("button", {
          name: "Dismiss: it stays hidden unless its details change",
          exact: true,
        })
        .click();
      expect(adminApi.calls).toContainEqual({
        method: "POST",
        path: "/api/manage/health-issues/101/dismiss",
        body: null,
      });
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
    });
  });
test("keeps long issue paths and artist text within the mobile layout", async ({
  page,
  openAdminPage,
  adminApi,
}) => {
  await page.setViewportSize({ width: 390, height: 1100 });
  const data = structuredClone(fixture.health),
    long = "LongHealthIssue".repeat(25);
  data.issues[0]!.description = long;
  data.issues[0]!.details_json.artist = long;
  data.issues[0]!.details_json.path = `/music/${long}`;
  adminApi.respondTo("/api/admin/health-snapshot", data);
  adminApi.respondTo("/api/manage/repair-catalog", fixture.catalog);
  adminApi.respondTo("/api/admin/tasks-snapshot", fixture.tasks);
  await openAdminPage("/health");
  await page
    .getByRole("button", {
      name: "Review issues: Unindexed Files",
      exact: true,
    })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Unindexed Files issues" })
      .getByText(long, { exact: true })
      .first(),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
});
