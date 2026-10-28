import { expect, test } from "./fixtures";
import fixture from "./fixtures/roles-1al.json";
import auth from "./fixtures/auth-me.json";
for (const width of [1440, 768, 390])
  for (const reader of [false, true])
    test.describe(`Roles Admin ${width} ${reader ? "roles-view-only" : "admin"}`, () => {
      test.use({ viewport: { width, height: 1100 } });
      test("keeps actual Roles page readable without editing controls", async ({
        page,
        adminApi,
        openAdminPage,
      }) => {
        adminApi.respondTo("/api/auth/roles", fixture);
        if (reader)
          adminApi.respondTo("/api/auth/me", {
            ...auth,
            role: "observer",
            roles: ["observer"],
            capabilities: ["admin.access", "roles.view"],
          });
        await openAdminPage("/roles");
        const main = page.getByRole("main");
        await expect(
          main.getByRole("heading", {
            name: "Roles & Permissions",
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          main.getByRole("heading", { name: "Librarian", exact: true }),
        ).toBeVisible();
        await expect(
          main.getByRole("heading", { name: "Observer", exact: true }),
        ).toBeVisible();
        await expect(
          main
            .getByRole("article")
            .filter({ has: page.getByRole("heading", { name: "Librarian" }) }),
        ).toContainText("3 grants");
        await expect(
          main
            .getByRole("article")
            .filter({ has: page.getByRole("heading", { name: "Observer" }) }),
        ).toContainText("2 grants");
        await expect(
          main.getByRole("row", { name: "library.view Yes Yes", exact: true }),
        ).toBeVisible();
        await expect(main.locator("svg")).toHaveCount(0);
        await expect(main.getByRole("button")).toHaveCount(0);
        await expect(main.getByRole("textbox")).toHaveCount(0);
        await expect(main.getByRole("link")).toHaveCount(0);
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
        expect(
          await main
            .getByRole("heading", { level: 1 })
            .evaluate((el) => getComputedStyle(el).fontFamily),
        ).toContain("Bricolage");
        expect(
          await main
            .getByText("librarian", { exact: true })
            .evaluate((el) => getComputedStyle(el).fontFamily),
        ).toContain("JetBrains");
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        expect(
          adminApi.calls.filter((call) => call.path === "/api/auth/roles"),
        ).toEqual([]);
      });
    });
