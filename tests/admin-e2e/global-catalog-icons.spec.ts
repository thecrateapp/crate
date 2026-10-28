import { emulateCoarsePointer, expect, test } from "./fixtures";
import fixture from "./fixtures/global-catalog-1ak.json";
for (const width of [1440, 768, 390])
  test.describe(`Global Catalog Admin ${width}`, () => {
    test.use({ viewport: { width, height: 1100 } });
    test("keeps actual reads, policy-gated controls and enqueue/refetch boundaries", async ({
      page,
      adminApi,
      openAdminPage,
    }) => {
      for (const [path, response] of Object.entries(fixture))
        adminApi.respondTo(
          new URL(path, "http://sample.test").pathname,
          response,
        );
      let finishPost: (() => void) | undefined;
      await page.route(
        "**/api/admin/global-catalog/reconcile",
        async (route) => {
          expect(route.request().method()).toBe("POST");
          const body = route.request().postDataJSON();
          expect(body).toEqual({ mode: "incremental" });
          await new Promise<void>((resolve) => {
            finishPost = resolve;
          });
          await route.fulfill({
            json: { task_id: "sample-catalog-task", status: "queued" },
          });
        },
      );
      await openAdminPage("/global-catalog");
      const main = page.getByRole("main");
      await expect(
        main.getByText("Global ready", { exact: true }),
      ).toBeVisible();
      await expect(main.locator("svg:not([data-admin-ux])")).toHaveCount(0);
      for (const field of await main.locator(".crate-form-field").all())
        expect(
          await field.evaluate((el) => {
            const [label, value] = Array.from(el.children);
            return (
              value!.getBoundingClientRect().top -
              label!.getBoundingClientRect().bottom
            );
          }),
        ).toBe(8);
      await emulateCoarsePointer(page);
      for (const button of await main.getByRole("button").all())
        expect(
          Number((await button.boundingBox())!.height.toFixed(2)),
        ).toBeGreaterThanOrEqual(44);
      expect(
        await main
          .getByRole("heading", { level: 1 })
          .evaluate((el) => getComputedStyle(el).fontFamily),
      ).toContain("Bricolage");
      expect(
        await main
          .getByText("Artists", { exact: true })
          .evaluate((el) => getComputedStyle(el).fontFamily),
      ).toContain("JetBrains");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await main.getByRole("tab", { name: "Runs", exact: true }).press("Enter");
      await expect(
        main.getByRole("tab", { name: "Runs", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      await expect(
        main.getByText("Sample peer unavailable", { exact: true }),
      ).toBeVisible();
      let finishStatus: (() => void) | undefined,
        finishRuns: (() => void) | undefined;
      await page.route("**/api/admin/global-catalog/status", async (route) => {
        await new Promise<void>((resolve) => {
          finishStatus = resolve;
        });
        await route.fulfill({
          json: fixture["/api/admin/global-catalog/status"],
        });
      });
      await page.route(
        "**/api/admin/global-catalog/runs?limit=25",
        async (route) => {
          await new Promise<void>((resolve) => {
            finishRuns = resolve;
          });
          await route.fulfill({
            json: fixture["/api/admin/global-catalog/runs?limit=25"],
          });
        },
      );
      const reconcile = main.getByRole("button", {
          name: "Reconcile",
          exact: true,
        }),
        full = main.getByRole("button", { name: "Full rebuild", exact: true });
      await reconcile.press("Enter");
      await expect(reconcile).toHaveAttribute("aria-busy", "true");
      await expect(full).toBeDisabled();
      await expect.poll(() => typeof finishPost).toBe("function");
      finishPost!();
      await expect.poll(() => typeof finishStatus).toBe("function");
      await expect.poll(() => typeof finishRuns).toBe("function");
      await expect(reconcile).toBeEnabled();
      await expect(full).toBeEnabled();
      await expect(reconcile).not.toHaveAttribute("aria-busy", "true");
      finishStatus!();
      finishRuns!();
      await expect(
        page.getByText("Incremental reconciliation queued", { exact: true }),
      ).toBeVisible();
      await expect(
        main.getByRole("tab", { name: "Runs", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      await main.getByRole("tab", { name: "Duplicates", exact: true }).click();
      await expect(
        main.getByText("sample-album:uncertain-match", { exact: true }),
      ).toBeVisible();
      await expect(
        main.getByText("sample-peer-2", { exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
  });
