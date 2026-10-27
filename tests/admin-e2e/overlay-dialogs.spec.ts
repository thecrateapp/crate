import { expect, test } from "./fixtures";

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "390px", width: 390, height: 844 },
]) {
  test.describe(`shared destructive overlays at ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const operation of [
      {
        trigger: "Wipe database",
        title: "Wipe Library Database",
        action: "Wipe Database",
        word: "WIPE",
        path: "/api/manage/wipe",
        body: { rebuild: false },
        notice: "Library database wiped",
      },
      {
        trigger: "Rebuild library",
        title: "Rebuild Library",
        action: "Rebuild Library",
        word: "REBUILD",
        path: "/api/manage/rebuild",
        body: null,
        notice: "Library rebuild started",
      },
    ]) {
      test(`requires exact ${operation.word} confirmation and sends one intercepted action`, async ({
        page,
        openAdminPage,
        adminApi,
      }) => {
        adminApi.respondTo(operation.path, { task_id: "task-overlay-e2e" });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await openAdminPage("/");
        await page
          .getByRole("button", { name: "Maintenance", exact: true })
          .click();
        const trigger = page
          .getByRole("dialog", { name: "Library maintenance", exact: true })
          .getByRole("button", {
            name: operation.trigger,
            exact: true,
          });
        await trigger.click();
        const dialog = page.getByRole("alertdialog", {
          name: operation.title,
          exact: true,
        });
        await expect(dialog).toBeVisible();
        await expect(dialog).toHaveAttribute("aria-describedby", /.+/);
        const panel = dialog.locator("[data-app-modal-panel]");
        await expect(panel).toHaveCSS("background-color", "rgb(17, 18, 24)");
        await expect(panel).toHaveCSS("border-top-left-radius", "14px");
        await expect(panel).toHaveCSS("backdrop-filter", "none");
        const box = (await panel.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(-1);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(viewport.width);

        const typed = dialog.getByRole("textbox");
        const confirm = dialog.getByRole("button", {
          name: operation.action,
          exact: true,
        });
        const cancel = dialog.getByRole("button", {
          name: "Cancel",
          exact: true,
        });
        await expect(cancel).toBeFocused();
        await expect(confirm).toBeDisabled();
        for (const key of ["Tab", "Tab", "Shift+Tab", "Shift+Tab"]) {
          await page.keyboard.press(key);
          expect(
            await dialog.evaluate((element) =>
              element.contains(document.activeElement),
            ),
          ).toBe(true);
        }
        for (const invalid of [
          operation.word.toLowerCase(),
          `${operation.word} `,
        ]) {
          await typed.fill(invalid);
          await expect(confirm).toBeDisabled();
        }
        await typed.fill(operation.word);
        await expect(confirm).toBeEnabled();
        expect(
          adminApi.calls.filter((call) => call.path === operation.path),
        ).toEqual([]);
        await page.keyboard.press("Escape");
        await expect(dialog).not.toBeVisible();
        await expect(trigger).toBeFocused();
        await trigger.click();
        await expect(typed).toHaveValue("");
        await expect(confirm).toBeDisabled();
        await typed.fill(operation.word);
        await confirm.click();
        await expect(dialog).not.toBeVisible();
        await expect(
          page.getByText(operation.notice, { exact: true }),
        ).toBeVisible();
        expect(
          adminApi.calls.filter((call) => call.path === operation.path),
        ).toEqual([
          { method: "POST", path: operation.path, body: operation.body },
        ]);
      });
    }
  });
}
