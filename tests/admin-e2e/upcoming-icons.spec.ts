import { expect, test } from "./fixtures";
import shows from "./fixtures/shows-cached.json";
import auth from "./fixtures/auth-me.json";
const image =
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#13343d"/></svg>';
for (const width of [1440, 768, 390])
  for (const setlistOnly of [false, true])
    test.describe(`Show Management built Admin ${width} ${setlistOnly ? "setlist-only" : "admin"}`, () => {
      test.use({ viewport: { width, height: 1100 } });
      test("retains actual route, gates, show/card/calendar, links and responsive geometry", async ({
        page,
        adminApi,
        openAdminPage,
      }) => {
        await page.clock.setFixedTime(new Date("2026-10-18T12:00:00Z"));
        adminApi.respondTo("/api/shows/cached", shows);
        if (setlistOnly)
          adminApi.respondTo("/api/auth/me", {
            ...auth,
            role: "editor",
            roles: ["editor"],
            capabilities: ["library.metadata.write"],
          });
        await page.route(
          /\/api\/(artists|artist-slugs)\/[^/]+\/photo/,
          (route) =>
            route.fulfill({ contentType: "image/svg+xml", body: image }),
        );
        await openAdminPage("/upcoming");
        const main = page.getByRole("main");
        const show = main.getByRole("button", {
          name: /^Costa Norte Sala Puerto Valencia/,
        });
        await expect(show).toBeVisible();
        await expect(main.getByText("2 shows", { exact: true })).toBeVisible();
        expect(
          await main
            .getByRole("heading", { name: "Show Management", exact: true })
            .evaluate((e) => getComputedStyle(e).fontFamily),
        ).toContain("Bricolage");
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
        await expect(
          main.getByRole("button", { name: "Sync shows", exact: true }),
        ).toHaveCount(setlistOnly ? 0 : 1);
        await expect(
          main.getByRole("button", { name: "Refresh setlists", exact: true }),
        ).toBeEnabled();
        await show.press("Enter");
        const actions = main.getByRole("group", {
          name: "Actions for Costa Norte show",
          exact: true,
        });
        await expect(
          actions.getByRole("link", { name: "Open show listing", exact: true }),
        ).toHaveAttribute("href", "https://example.invalid/tickets/1");
        await expect(
          actions.getByRole("link", { name: "Open artist", exact: true }),
        ).toHaveAttribute("href", "/artists/costa-norte");
        await expect(
          main.getByRole("list", {
            name: "Probable setlists by artist",
            exact: true,
          }),
        ).toContainText("14 songs");
        await expect(
          main.getByRole("button", {
            name: "Merge duplicates of this show",
            exact: true,
          }),
        ).toHaveCount(setlistOnly ? 0 : 1);
        await main
          .getByRole("button", { name: "Close show details", exact: true })
          .click();
        await main
          .getByRole("button", { name: "Calendar view", exact: true })
          .click();
        await main
          .getByRole("button", { name: "Next month", exact: true })
          .click();
        await expect(
          main.getByRole("heading", { name: "November 2026", exact: true }),
        ).toBeVisible();
        await main
          .getByRole("button", { name: "Previous month", exact: true })
          .click();
        await expect(
          main.getByRole("heading", { name: "October 2026", exact: true }),
        ).toBeVisible();
        await expect(
          main.getByRole("button", { name: "Costa Norte", exact: true }),
        ).toBeVisible();
        expect(
          adminApi.calls.filter((call) => call.path.startsWith("/api/shows")),
        ).toEqual([]);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      });
    });

test("actual route denies Show Management without a show or setlist capability", async ({
  page,
  adminApi,
  openAdminPage,
}) => {
  adminApi.respondTo("/api/auth/me", {
    ...auth,
    role: "acquirer",
    roles: ["acquirer"],
    capabilities: ["library.tidal.manage"],
  });
  const reads: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/shows/cached")
      reads.push(request.url());
  });
  await openAdminPage("/upcoming");
  await expect(
    page.getByRole("heading", { name: "Permission required", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Show Management", exact: true }),
  ).toHaveCount(0);
  expect(reads).toEqual([]);
});
