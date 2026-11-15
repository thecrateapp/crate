import { expect, test } from "./fixtures";
import auth from "./fixtures/auth-me.json";
import fixture from "./fixtures/backups-bk5.json";

const { now, ...responses } = fixture;

for (const width of [1440, 390])
  test.describe(`Backups Admin ${width}`, () => {
    test.use({ viewport: { width, height: 1100 } });
    test.beforeEach(async ({ page, adminApi }) => {
      await page.clock.setFixedTime(new Date(now));
      adminApi.respondTo("/api/auth/me", {
        ...auth,
        capabilities: [...auth.capabilities, "system.backups.manage"],
      });
      for (const [path, value] of Object.entries(responses))
        adminApi.respondTo(path, value);
    });

    test("shows backup health with failing in red and late in amber", async ({
      page,
      openAdminPage,
    }) => {
      await openAdminPage("/backups");
      const main = page.getByRole("main").last();
      await expect(main.getByRole("heading", { level: 1 })).toHaveText(
        "Backups",
      );
      await expect(main.getByRole("alert")).toContainText(
        "4 of 6 destinations have repository passwords",
      );
      const failing = main
        .getByRole("article", { name: "Hetzner Storage Box" })
        .getByText("Failing", { exact: true });
      const late = main
        .getByRole("article", { name: "Google Drive" })
        .getByText("Late", { exact: true });
      const color = (locator: typeof failing) =>
        locator.evaluate((node) => getComputedStyle(node).color);
      expect(await color(failing)).not.toEqual(await color(late));
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test("opens a destination in a side drawer with its snapshots tab", async ({
      page,
      openAdminPage,
    }) => {
      await openAdminPage("/backups?view=destinations");
      const main = page.getByRole("main").last();
      await expect(
        main.getByRole("switch", { name: "Dropbox enabled" }),
      ).toBeDisabled();
      await main.getByRole("button", { name: "Edit Cloudflare R2" }).click();
      const drawer = page.locator("[data-slot=sheet-content]");
      await expect(
        drawer.getByRole("heading", { name: "Cloudflare R2" }),
      ).toBeVisible();
      await expect(drawer.getByText("Saved", { exact: true })).toHaveCount(2);
      await drawer.getByRole("tab", { name: "Snapshots" }).click();
      await expect(drawer.getByText("a91f03c2", { exact: true })).toBeVisible();
      const box = await drawer.boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    });
  });
