import { emulateCoarsePointer, expect, test } from "./fixtures";
import fixture from "./fixtures/trash-1ae.json";

for (const width of [1440, 768, 390]) {
  test.describe(`Library Trash built ${width}`, () => {
    test.use({ viewport: { width, height: 1100 } });
    test("preserves real routes, worker requests, confirmation and text controls", async ({
      page,
      openAdminPage,
      adminApi,
    }) => {
      adminApi.respondTo("/api/manage/tracks/quarantine", fixture);
      adminApi.respondTo("/api/tasks/task-e2e", {
        id: "task-e2e",
        status: "completed",
        result: { deleted: 1, bytes_deleted: 2097152 },
      });
      await openAdminPage("/trash");
      const main = page.getByRole("main");
      await expect(
        main.getByRole("heading", { name: "Library Trash", exact: true }),
      ).toHaveCSS("font-family", /Bricolage Grotesque/);
      await expect(main.getByText("Marea", { exact: true })).toBeVisible();
      await expect(main.locator("svg:not(.lucide-loader-circle)")).toHaveCount(
        2,
      );
      await expect(
        main.locator(
          'svg[data-admin-ux="header-refresh"],svg[data-admin-ux="header-empty-trash"]',
        ),
      ).toHaveCount(2);
      await expect(main.locator("button button,button a")).toHaveCount(0);
      await emulateCoarsePointer(page);
      for (const control of await main.getByRole("button").all()) {
        const box = (await control.boundingBox())!;
        expect(
          Number(Math.min(box.width, box.height).toFixed(2)),
        ).toBeGreaterThanOrEqual(44);
      }
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
      const remove = main
        .getByRole("button", { name: "Delete", exact: true })
        .first();
      await remove.focus();
      await page.keyboard.press("Space");
      const dialog = page.getByRole("alertdialog", {
        name: "Delete Quarantined Track",
      });
      await expect(dialog).toHaveAccessibleDescription(
        /Marea.*cannot be undone/,
      );
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(remove).toBeFocused();
      expect(adminApi.calls).not.toContainEqual(
        expect.objectContaining({
          path: "/api/manage/tracks/quarantine/hard-delete",
        }),
      );
      adminApi.respondTo("/api/manage/tracks/quarantine", {
        count: 1,
        items: fixture.items.slice(1),
      });
      await main
        .getByRole("button", { name: "Restore", exact: true })
        .first()
        .click();
      await expect(main.getByText("Marea", { exact: true })).toHaveCount(0);
      expect(adminApi.calls).toContainEqual({
        method: "POST",
        path: "/api/manage/tracks/quarantine/restore",
        body: {
          quarantine_path: fixture.items[0]!.quarantine_path,
          reason: "Manual restore from .crate-trash",
        },
      });
      await main
        .getByRole("button", { name: "Empty trash", exact: true })
        .click();
      await expect(page.getByRole("alertdialog")).toHaveAccessibleDescription(
        /1 quarantined track.*2.0 MB.*cannot be undone/,
      );
      adminApi.respondTo("/api/manage/tracks/quarantine", {
        count: 0,
        items: [],
      });
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Empty Trash", exact: true })
        .click();
      await expect(
        main.getByText(".crate-trash is empty", { exact: true }),
      ).toBeVisible();
      expect(adminApi.calls).toContainEqual({
        method: "POST",
        path: "/api/manage/tracks/quarantine/hard-delete-all",
        body: { reason: "Manual empty trash from admin" },
      });
      await expect(
        main.getByRole("button", { name: "Empty trash", exact: true }),
      ).toBeDisabled();
    });
  });
}
