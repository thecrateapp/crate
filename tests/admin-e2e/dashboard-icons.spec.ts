import { expect, test } from "./fixtures";
import fixture from "./fixtures/dashboard-snapshot.json";
test("keeps long task names and progress inside the mobile report", async ({
  page,
  openAdminPage,
  adminApi,
}) => {
  await page.setViewportSize({ width: 390, height: 1100 });
  const snapshot = structuredClone(fixture),
    now = Date.now(),
    name = "LongTaskName".repeat(24);
  snapshot.snapshot.built_at = new Date(now - 15000).toISOString();
  snapshot.snapshot.stale_after = new Date(now + 60000).toISOString();
  snapshot.live.running_tasks[0]!.type = name;
  snapshot.live.running_tasks[0]!.progress = JSON.stringify({
    done: 3,
    total: 12,
    item: "LongProgressItem".repeat(24),
  });
  adminApi.respondTo("/api/admin/ops-snapshot", snapshot);
  await openAdminPage("/");
  await expect(
    page.getByRole("main").getByRole("link", { name, exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
for (const width of [1440, 768, 390])
  test.describe(`Dashboard operational summary ${width}`, () => {
    test.use({ viewport: { width, height: 1100 } });
    test("keeps three built regions and intercepted maintenance confirmations", async ({
      page,
      openAdminPage,
      adminApi,
    }) => {
      const snapshot = structuredClone(fixture),
        now = Date.now();
      snapshot.snapshot.built_at = new Date(now - 15000).toISOString();
      snapshot.snapshot.stale_after = new Date(now + 60000).toISOString();
      // A healthy cache cannot stand in for the independent durable event bus (or vice versa).
      snapshot.eventing.redis_connected = false;
      snapshot.eventing.domain_events.redis_connected = true;
      snapshot.live.running_tasks[0]!.status = "running";
      snapshot.live.running_tasks[0]!.progress = JSON.stringify({
        done: 3,
        total: 12,
        phase: "processing",
      });
      adminApi.respondTo("/api/admin/ops-snapshot", snapshot);
      await openAdminPage("/");
      const main = page.getByRole("main");
      await expect(main.getByRole("region")).toHaveCount(3);
      await expect(
        main.getByText("Reported services responding", { exact: true }),
      ).toBeVisible();
      await expect(
        main.getByRole("heading", { name: "Dashboard", exact: true }),
      ).toHaveCSS("font-family", /Bricolage Grotesque/);
      await expect(
        main.getByRole("progressbar", {
          name: "Reported progress: Artist enrichment",
        }),
      ).toHaveAttribute("aria-valuenow", "25");
      await expect(main.locator("svg.lucide")).toHaveCount(1);
      const gaps = await main
        .locator(".crate-form-field")
        .evaluateAll((nodes) =>
          nodes.map(
            (n) =>
              n.children[1]!.getBoundingClientRect().top -
              n.children[0]!.getBoundingClientRect().bottom,
          ),
        );
      expect(gaps).toEqual([8, 8]);
      const maintenance = main.getByRole("button", {
        name: "Maintenance",
        exact: true,
      });
      await maintenance.focus();
      await maintenance.press("Space");
      const panel = page.getByRole("dialog", {
        name: "Library maintenance",
        exact: true,
      });
      await panel
        .getByRole("button", { name: "Sync library", exact: true })
        .click();
      for (const [trigger, confirm, word, path, body] of [
        [
          "Rebuild library",
          "Rebuild Library",
          "REBUILD",
          "/api/manage/rebuild",
          null,
        ],
        [
          "Wipe database",
          "Wipe Database",
          "WIPE",
          "/api/manage/wipe",
          { rebuild: false },
        ],
      ] as const) {
        const open = panel.getByRole("button", { name: trigger, exact: true });
        await open.click();
        let dialog = page.getByRole("alertdialog");
        await expect(
          dialog.getByRole("button", { name: confirm, exact: true }),
        ).toBeDisabled();
        await dialog
          .getByRole("button", { name: "Cancel", exact: true })
          .click();
        await expect(open).toBeFocused();
        await open.click();
        dialog = page.getByRole("alertdialog");
        await dialog.getByLabel(`Type ${word} to confirm`).fill(word);
        await dialog
          .getByRole("button", { name: confirm, exact: true })
          .click();
        await expect(dialog).toHaveCount(0);
        await expect(panel).toBeVisible();
        await expect
          .poll(() => adminApi.calls.filter((c) => c.path === path))
          .toEqual([{ method: "POST", path, body }]);
      }
      await panel
        .getByRole("button", { name: "Close maintenance", exact: true })
        .click();
      await expect(maintenance).toBeFocused();
      expect(
        adminApi.calls.filter((c) => c.path === "/api/tasks/sync-library"),
      ).toEqual([
        { method: "POST", path: "/api/tasks/sync-library", body: null },
      ]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
  });
