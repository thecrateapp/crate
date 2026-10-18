import { expect, test } from "./fixtures";
import fixture from "./fixtures/upcoming-1ao.json";
import auth from "./fixtures/auth-me.json";
const image =
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#13343d"/></svg>';
for (const width of [1440, 768, 390])
  for (const acquireOnly of [false, true])
    test.describe(`Upcoming built Admin ${width} ${acquireOnly ? "acquire-only" : "admin"}`, () => {
      test.use({ viewport: { width, height: 1100 } });
      test("retains actual route, gates, show/card/calendar, payloads and responsive geometry", async ({
        page,
        adminApi,
        openAdminPage,
      }) => {
        await page.clock.setFixedTime(new Date("2026-10-18T12:00:00Z"));
        adminApi.respondTo("/api/upcoming", fixture);
        if (acquireOnly)
          adminApi.respondTo("/api/auth/me", {
            ...auth,
            role: "acquirer",
            roles: ["acquirer"],
            capabilities: ["library.tidal.manage"],
          });
        await page.route("**/api/**", async (route) => {
          const u = new URL(route.request().url());
          if (
            route.request().resourceType() === "image" &&
            /^\/api\/(artists|artist-slugs)\//.test(u.pathname)
          )
            await route.fulfill({ contentType: "image/svg+xml", body: image });
          else await route.fallback();
        });
        await openAdminPage("/upcoming");
        const main = page.getByRole("main");
        await expect(
          main.getByRole("link", { name: "Luz de octubre", exact: true }),
        ).toBeVisible();
        expect(
          await main
            .getByRole("heading", { name: "Upcoming", exact: true })
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
        if (acquireOnly) {
          await expect(
            main.getByRole("button", { name: "Sync shows", exact: true }),
          ).toHaveCount(0);
          await expect(
            main.getByRole("button", { name: "Clear caches", exact: true }),
          ).toHaveCount(0);
          await expect(
            main.getByRole("button", { name: "Dismiss release", exact: true }),
          ).toHaveCount(0);
        } else
          await expect(
            main.getByRole("button", { name: "Clear caches", exact: true }),
          ).toHaveText("Clear caches");
        await main
          .locator('[role="button"][aria-expanded="false"]')
          .filter({ hasText: "Sala Puerto" })
          .press("Enter");
        await expect(
          main.getByRole("link", { name: "Get Tickets", exact: true }),
        ).toHaveAttribute("href", "https://example.invalid/tickets/1");
        await expect(
          main.getByRole("link", { name: "Open Artist", exact: true }),
        ).toHaveAttribute("href", "/artists/costa-norte");
        await main
          .getByRole("button", { name: "Close show details", exact: true })
          .click();
        await main
          .getByRole("button", { name: "Calendar", exact: true })
          .click();
        await main
          .getByRole("button", { name: "Next month", exact: true })
          .click();
        await main
          .getByRole("button", { name: "Previous month", exact: true })
          .click();
        await main
          .getByRole("button", { name: "Costa Norte", exact: true })
          .last()
          .click();
        await page
          .getByRole("button", { name: "View full details", exact: true })
          .click();
        await main
          .getByRole("button", { name: "Close show details", exact: true })
          .click();
        await main
          .getByRole("button", { name: "Download release", exact: true })
          .click();
        await expect
          .poll(() =>
            adminApi.calls.find((c) => c.path.endsWith("/71/download")),
          )
          .toEqual({
            method: "POST",
            path: "/api/acquisition/new-releases/71/download",
            body: null,
          });
        await expect(
          main.getByRole("button", { name: "Download release", exact: true }),
        ).toHaveCount(0);
        if (!acquireOnly) {
          await main
            .getByRole("button", { name: "Dismiss release", exact: true })
            .click();
          await expect
            .poll(() =>
              adminApi.calls.find((c) => c.path.endsWith("/72/dismiss")),
            )
            .toEqual({
              method: "POST",
              path: "/api/acquisition/new-releases/72/dismiss",
              body: null,
            });
          await expect(main.getByText("Niebla", { exact: true })).toHaveCount(
            0,
          );
        }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      });
    });
