import { expect, test } from "./fixtures";
import fixture from "./fixtures/users-1am.json";
import auth from "./fixtures/auth-me.json";
for (const width of [1440, 768, 390])
  for (const reader of [false, true])
    test.describe(`Users Admin ${width} ${reader ? "view-only" : "admin"}`, () => {
      test.use({ viewport: { width, height: 1100 } });
      test("real compact list and modal preserve data, query and capability boundaries", async ({
        page,
        adminApi,
        openAdminPage,
      }) => {
        const requests: string[] = [];
        page.on("request", (request) => requests.push(request.url()));
        adminApi.respondTo("/api/auth/users", fixture.users);
        adminApi.respondTo("/api/auth/users/1", fixture.detail);
        if (reader)
          adminApi.respondTo("/api/auth/me", {
            ...auth,
            id: 999,
            role: "user",
            roles: ["user"],
            capabilities: ["admin.access", "users.view"],
          });
        await openAdminPage("/users?node=sample");
        await expect(
          page.getByRole("table", { name: "Users", exact: true }),
        ).toBeVisible();
        await page.goto("/users?node=sample&inspect=1");
        const dialog = page.getByRole("dialog", {
          name: "User Detail",
          exact: true,
        });
        await expect(
          dialog.getByText("Fictional user for the local preview."),
        ).toBeVisible();
        await expect(dialog.getByText("Marea", { exact: true })).toBeVisible();
        await dialog.evaluate((el) =>
          Promise.all(
            el.getAnimations().map((animation) => animation.finished),
          ),
        );
        expect(
          await dialog.evaluate((el) => el.getBoundingClientRect().width),
        ).toBeGreaterThanOrEqual(Math.min(width * 0.9, 1280));
        if (reader) {
          await expect(
            dialog.getByRole("button", { name: "Save roles", exact: true }),
          ).toHaveCount(0);
          await expect(
            dialog.getByRole("button", { name: "Reset password", exact: true }),
          ).toHaveCount(0);
        } else
          await expect(
            dialog.getByRole("button", { name: "Save roles", exact: true }),
          ).toBeDisabled();
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(page).toHaveURL(/\/users\?node=sample$/);
        const table = page.getByRole("table", { name: "Users", exact: true });
        const header = width >= 1024 ? 1 : 0;
        await expect(table.getByRole("row")).toHaveCount(4 + header);
        await expect(
          table
            .getByRole("row", { name: /Celia Norte/ })
            .getByText("Suspended", { exact: true }),
        ).toBeVisible();
        if (reader) {
          await expect(
            page.getByRole("button", { name: "Add user", exact: true }),
          ).toHaveCount(0);
          await expect(
            table.getByRole("button", { name: "Delete", exact: true }),
          ).toHaveCount(0);
        }
        await page
          .getByRole("textbox", { name: "Search users", exact: true })
          .fill("bandcamp");
        await expect(table.getByRole("row")).toHaveCount(1 + header);
        await table
          .getByRole("row", { name: /Ada Costa/ })
          .getByRole("button", { name: "Inspect", exact: true })
          .press("Enter");
        await expect(
          dialog.getByText("Fictional user for the local preview."),
        ).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        expect(
          requests.some((url) => /presence-map|users\/map|user-map/i.test(url)),
        ).toBe(false);
        expect(
          adminApi.calls.filter(
            (call) =>
              call.path.startsWith("/api/auth/users") ||
              call.path.startsWith("/api/admin/auth/invites"),
          ),
        ).toEqual([]);
      });
    });
