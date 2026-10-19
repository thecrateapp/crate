import { test, expect } from "./fixtures";
import fixture from "./fixtures/playlists-1ap.json";
import auth from "./fixtures/auth-me.json";
for (const width of [1440, 768, 390])
  for (const curatorOnly of [false, true])
    test.describe(`System Playlists built ${width} ${curatorOnly ? "curator" : "admin"}`, () => {
      test.use({ viewport: { width, height: 1100 } });
      test("keeps real route/capability, artwork, forms, status and confirmation requests", async ({
        page,
        adminApi,
        openAdminPage,
      }) => {
        adminApi.respondTo("/api/admin/system-playlists", fixture.items);
        adminApi.respondTo(
          "/api/playlists/filter-options",
          fixture.filterOptions,
        );
        if (curatorOnly)
          adminApi.respondTo("/api/auth/me", {
            ...auth,
            role: "curator",
            roles: ["curator"],
            capabilities: ["curation.playlists.write"],
          });
        await openAdminPage("/playlists");
        const main = page.getByRole("main");
        await expect(
          main.getByRole("heading", { name: "Costa de noche", exact: true }),
        ).toBeVisible();
        expect(
          await main
            .getByRole("heading", { name: "System Playlists", exact: true })
            .evaluate((e) => getComputedStyle(e).fontFamily),
        ).toContain("Bricolage");
        await expect(
          main.locator(".playlist-artwork-placeholder svg"),
        ).toHaveCount(0);
        expect(
          await main
            .locator('img[src="/assets/logo.svg"]')
            .first()
            .evaluate((e) => (e as HTMLImageElement).naturalWidth),
        ).toBeGreaterThan(0);
        await main
          .getByRole("button", {
            name: "Deactivate Costa de noche",
            exact: true,
          })
          .click();
        await expect
          .poll(() =>
            adminApi.calls.find((c) => c.path.endsWith("/11/deactivate")),
          )
          .toEqual({
            method: "POST",
            path: "/api/admin/system-playlists/11/deactivate",
            body: null,
          });
        await main
          .getByRole("button", { name: "Delete Costa de noche", exact: true })
          .click();
        await page
          .getByRole("alertdialog")
          .getByRole("button", { name: "Delete", exact: true })
          .click();
        await expect
          .poll(() => adminApi.calls.find((c) => c.method === "DELETE"))
          .toEqual({
            method: "DELETE",
            path: "/api/admin/system-playlists/11",
            body: null,
          });
        await main
          .getByRole("button", { name: "New static", exact: true })
          .click();
        await main
          .getByRole("textbox", { name: "Name", exact: true })
          .fill("Puerto");
        await expect(
          main.getByRole("button", { name: "Create & open", exact: true }),
        ).toBeEnabled();
        await main.getByRole("button", { name: "Close", exact: true }).click();
        await main
          .getByRole("button", { name: "New smart", exact: true })
          .click();
        const operator = main.getByRole("combobox", {
          name: "Operator",
          exact: true,
        });
        await expect(operator).toContainText("Contains");
        await operator.click();
        await page
          .getByRole("option", { name: "Not contains", exact: true })
          .click();
        await expect(operator).toContainText("Not contains");
        await main
          .getByRole("combobox", { name: "Select genre", exact: true })
          .click();
        await page
          .getByRole("option", { name: "Ambient", exact: true })
          .click();
        await main
          .getByRole("button", { name: "Add rule", exact: true })
          .click();
        await main
          .getByRole("button", { name: "Remove rule 2", exact: true })
          .click();
        for (const field of await main.locator(".crate-form-field").all())
          expect(
            await field.evaluate((e) => {
              const [l, v] = Array.from(e.children);
              return (
                v!.getBoundingClientRect().top -
                l!.getBoundingClientRect().bottom
              );
            }),
          ).toBe(8);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      });
    });
