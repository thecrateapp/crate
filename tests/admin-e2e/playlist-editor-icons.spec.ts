import { test, expect } from "./fixtures";
import fixture from "./fixtures/playlist-editor-1aq.json";
import auth from "./fixtures/auth-me.json";
const prefix = "/api/admin/system-playlists/42";
for (const width of [1440, 768, 390])
  test.describe(`PlaylistEditor built ${width}`, () => {
    test.use({ viewport: { width, height: 1100 } });
    test("curator capability keeps real editor, forms, preview and save payloads", async ({
      page,
      adminApi,
      openAdminPage,
    }) => {
      adminApi.respondTo("/api/auth/me", {
        ...auth,
        role: "curator",
        roles: ["curator"],
        capabilities: ["curation.playlists.write"],
      });
      adminApi.respondTo(`${prefix}/editor-snapshot`, fixture.surface);
      adminApi.respondTo(
        "/api/playlists/filter-options",
        fixture.filterOptions,
      );
      adminApi.respondTo(`${prefix}/preview`, fixture.preview);
      await openAdminPage("/playlists/42");
      const main = page.getByRole("main");
      await expect(
        main.getByRole("heading", { name: "Costa de noche", exact: true }),
      ).toBeVisible();
      expect(
        await main
          .getByRole("heading", { name: "Costa de noche", exact: true })
          .evaluate((e) => getComputedStyle(e).fontFamily),
      ).toContain("Bricolage");
      for (const [name, option] of [
        ["Category", "Genre"],
        ["Match", "Any rule"],
        ["Sort", "Popularity"],
      ]) {
        await main.getByRole("combobox", { name, exact: true }).click();
        await page.getByRole("option", { name: option, exact: true }).click();
      }
      const operator = main.getByRole("combobox", {
        name: "Operator",
        exact: true,
      });
      await operator.press("Enter");
      await expect(
        page.getByRole("option", { name: "Contains", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Home");
      await expect(
        page.getByRole("option", { name: "Equals", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(operator).toHaveText("Equals");
      await expect(operator).toBeFocused();
      const genre = main.getByRole("combobox", {
        name: "Select genre",
        exact: true,
      });
      await expect(genre).toHaveText("Select genre");
      await genre.click();
      await page.getByRole("option", { name: "Ambient", exact: true }).click();
      await main.getByRole("button", { name: "Preview", exact: true }).click();
      await expect(
        main.getByText("3 matching tracks", { exact: true }),
      ).toBeVisible();
      expect(adminApi.calls.find((c) => c.path.endsWith("/preview"))).toEqual({
        method: "POST",
        path: `${prefix}/preview`,
        body: {
          smart_rules: {
            ...fixture.surface.playlist.smart_rules,
            match: "any",
            sort: "popularity",
            rules: [{ field: "genre", op: "eq", value: "Ambient" }],
          },
        },
      });
      await main
        .getByRole("textbox", { name: "Name", exact: true })
        .fill("Costa editada");
      await main
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await expect
        .poll(() => adminApi.calls.find((c) => c.method === "PUT"))
        .toEqual({
          method: "PUT",
          path: prefix,
          body: {
            name: "Costa editada",
            description: fixture.surface.playlist.description,
            category: "genre",
            featured_rank: 1,
            is_active: true,
            is_curated: true,
            smart_rules: {
              ...fixture.surface.playlist.smart_rules,
              match: "any",
              sort: "popularity",
              rules: [{ field: "genre", op: "eq", value: "Ambient" }],
            },
            auto_refresh_enabled: true,
          },
        });
      for (const field of await main.locator(".crate-form-field").all())
        expect(
          await field.evaluate((e) => {
            const [a, b] = Array.from(e.children);
            return (
              b!.getBoundingClientRect().top - a!.getBoundingClientRect().bottom
            );
          }),
        ).toBe(8);
      const rule = await main
        .getByRole("button", { name: "Remove rule 1", exact: true })
        .evaluate((button) => {
          const fields = Array.from(
            button.parentElement!.parentElement!.querySelectorAll(
              ".crate-form-field",
            ),
          );
          return {
            width: fields[0]!.parentElement!.getBoundingClientRect().width,
            tops: fields.map((field) => field.getBoundingClientRect().top),
          };
        });
      expect(rule.tops).toHaveLength(3);
      if (rule.width >= 576) expect(new Set(rule.tops).size).toBe(1);
      else
        expect(
          rule.tops[0]! < rule.tops[1]! && rule.tops[1]! < rule.tops[2]!,
        ).toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await expect(
        main.getByRole("button", { name: "Remove rule 1", exact: true }),
      ).toBeEnabled();
      await expect(
        main.getByRole("button", { name: "Remove Marea", exact: true }),
      ).toBeEnabled();
    });
  });
test("actual route denies users without the curator capability", async ({
  page,
  adminApi,
  openAdminPage,
}) => {
  adminApi.respondTo("/api/auth/me", {
    ...auth,
    role: "curator",
    roles: ["curator"],
    capabilities: ["ops.health.view"],
  });
  await openAdminPage("/playlists/42");
  await expect(
    page.getByRole("heading", { name: "Costa de noche", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Permission required", exact: true }),
  ).toBeVisible();
  expect(adminApi.calls.filter((call) => call.path.startsWith(prefix))).toEqual(
    [],
  );
});
