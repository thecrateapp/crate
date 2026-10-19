import { expect, test } from "@playwright/test";
const hosts = [
  {
    name: "storybook",
    url: "/iframe.html?id=reviews-1ba-album-access--complete&viewMode=story",
  },
  {
    name: "standalone",
    url: "http://127.0.0.1:5186/review-1ba-album-access.html",
  },
];
for (const host of hosts) {
  for (const mobile of [false, true])
    test.describe(`${host.name} ${mobile ? "mobile" : "desktop"}`, () => {
      test.use({
        viewport: mobile
          ? { width: 375, height: 812 }
          : { width: 1200, height: 900 },
        hasTouch: mobile,
        isMobile: mobile,
      });
      test("access forms, album permissions/import and verified offline controls", async ({
        page,
      }) => {
        await page.goto(host.url);
        await expect(
          page.getByRole("heading", {
            name: "1BA · Album, access and offline",
          }),
        ).toBeVisible();
        for (const [testId, size] of [
          ["album-artist-identity", 24],
          ["player-artist-identity", 28],
          ["missing-artist-identity", 28],
        ] as const) {
          const avatar = page
            .getByTestId(testId)
            .locator('[data-slot="avatar"]');
          const box = (await avatar.boundingBox())!;
          expect(box.width).toBe(size);
          expect(box.height).toBe(size);
        }
        const artistThumbnail = page
          .getByTestId("standalone-artist-thumbnail")
          .locator('[data-slot="media-cover"]');
        expect((await artistThumbnail.boundingBox())!.width).toBe(48);
        await expect(
          page.getByRole("heading", { name: "Sample artist · Albums" }),
        ).toBeVisible();
        await expect(
          page.getByRole("heading", { name: "Sample artist · Top Tracks" }),
        ).toBeVisible();
        const show = page.getByRole("group", {
          name: "Show genres · real profile retained",
          exact: true,
        });
        await expect(show.getByText("100%", { exact: true })).toBeVisible();
        await expect(show.getByText("72%", { exact: true })).toBeVisible();
        await expect(show.getByText("0%", { exact: true })).toBeVisible();
        const ticket = await show
          .locator(".setlist-ticket-top")
          .evaluate((el) => ({
            borderWidth: getComputedStyle(el).borderTopWidth,
            background: getComputedStyle(el).backgroundColor,
            expected: getComputedStyle(document.documentElement)
              .getPropertyValue("--surface-object")
              .trim(),
            mask: getComputedStyle(el).maskImage,
          }));
        expect(ticket.borderWidth).toBe("1px");
        expect(ticket.background).not.toBe("rgba(0, 0, 0, 0)");
        expect(ticket.mask).toContain("radial-gradient");
        const monthGap = await show
          .getByRole("group", { name: "November 2026", exact: true })
          .evaluate((group) => {
            const label =
              group.parentElement!.firstElementChild!.getBoundingClientRect();
            const firstShow = group.firstElementChild!.getBoundingClientRect();
            return firstShow.top - label.bottom;
          });
        expect(monthGap).toBeCloseTo(8, 1);
        await page.getByRole("button", { name: "Show pending access" }).click();
        await expect(
          page.getByRole("button", { name: "Signing in...", exact: true }),
        ).toBeDisabled();
        await page.getByRole("button", { name: "Show ready access" }).click();
        await page
          .getByRole("button", { name: "Add to playlist", exact: true })
          .click();
        const playlist = page.getByRole("button", {
          name: "Night listening",
          exact: true,
        });
        const menuBase = await playlist.evaluate(
          (el) => getComputedStyle(el).backgroundColor,
        );
        if (!mobile) {
          await playlist.hover();
          await expect
            .poll(() =>
              playlist.evaluate((el) => getComputedStyle(el).backgroundColor),
            )
            .not.toBe(menuBase);
        }
        await playlist.click();
        await expect(
          page.getByText("Sample tracks added to playlist."),
        ).toBeVisible();
        const albumState = page.getByLabel("Album state");
        await albumState.click();
        await page
          .getByRole("option", { name: "Pre-release · no playable tracks" })
          .click();
        const album = page
          .getByRole("region", { name: "Luz de octubre" })
          .first();
        await expect(
          album.getByRole("heading", { name: "Luz de octubre" }),
        ).toBeVisible();
        await expect(page.getByTestId("release-countdown")).toBeVisible();
        await expect(
          page
            .getByTestId("album-action-row")
            .getByRole("button", { name: "Play", exact: true }),
        ).toBeDisabled();
        expect(
          await page
            .getByTestId("release-countdown")
            .evaluate((el) => getComputedStyle(el).backdropFilter),
        ).toBe("none");
        await albumState.click();
        await page
          .getByRole("option", { name: "Remote album", exact: true })
          .click();
        await expect(
          page
            .getByTestId("album-action-row")
            .getByRole("button", { name: "Make available offline" }),
        ).toHaveCount(0);
        await page
          .getByRole("button", { name: "Make available locally" })
          .click();
        const dialog = page.getByRole("alertdialog");
        await expect(dialog).toBeVisible();
        await dialog.getByRole("button", { name: "Confirm import" }).click();
        await expect(dialog).toBeHidden();
        await expect(
          page.getByText("Waiting for administrator approval", { exact: true }),
        ).toBeVisible();
        await page.getByRole("tab", { name: "Login", exact: true }).click();
        await page
          .getByLabel("Email", { exact: true })
          .fill("listener@example.test");
        await page
          .getByLabel("Password", { exact: true })
          .fill("sample-password");
        await page
          .getByRole("button", { name: "Sign in", exact: true })
          .click();
        await expect(page.getByRole("alert")).toHaveText(
          "Sample authentication error. No request was sent.",
        );
        await page.getByRole("tab", { name: "Register", exact: true }).click();
        await expect(
          page.getByRole("button", { name: "Create Account", exact: true }),
        ).toBeDisabled();
        await expect(
          page.getByLabel("Password", { exact: true }),
        ).toHaveAttribute("autocomplete", "new-password");
        await page.getByRole("tab", { name: "Server", exact: true }).click();
        const input = page.getByLabel("Server URL");
        await expect(input).toHaveAttribute("type", "url");
        await page
          .getByRole("button", { name: "Continue", exact: true })
          .click();
        await expect(
          page.getByText("Sample probe failure. No request was sent."),
        ).toBeVisible();
        const fieldHeight = await input.evaluate(
          (el) => el.getBoundingClientRect().height,
        );
        expect(fieldHeight).toBe(mobile ? 44 : 40);
        await page.getByRole("tab", { name: "Callback", exact: true }).click();
        await expect(
          page.getByRole("link", { name: "Open Crate" }),
        ).toHaveAttribute("href", "#sample-callback");
        const offline = page.getByRole("group", {
          name: "Offline · verified local tracks, no clock subscription in the list",
          exact: true,
        });
        const transport = offline.getByRole("region", {
          name: "Queue",
          exact: true,
        });
        await expect(
          transport.getByRole("button", { name: "Play", exact: true }),
        ).toBeDisabled();
        await offline
          .getByRole("button", { name: "Play all", exact: true })
          .click();
        await expect(
          transport.getByRole("button", { name: "Pause", exact: true }),
        ).toBeEnabled();
        await expect(
          offline.getByRole("listitem").filter({ hasText: "Marea" }),
        ).toHaveAttribute("aria-current", "true");
        const seek = transport.getByRole("slider");
        await seek.focus();
        await page.keyboard.press("End");
        await expect(seek).toHaveAttribute("aria-valuenow", "180");
        const rowCover = offline.locator('[data-slot="media-cover"]').first();
        expect((await rowCover.boundingBox())!.width).toBeGreaterThanOrEqual(
          48,
        );
        const clear = page.getByRole("button", {
          name: "Clear selected tracks",
        });
        const clearBox = (await clear.boundingBox())!;
        expect(clearBox.height).toBe(44);
        expect(clearBox.width).toBe(44);
        await offline
          .getByRole("button", { name: "Toggle empty library" })
          .click();
        await expect(offline.getByTestId("empty-state")).toBeVisible();
        await expect(
          transport.getByRole("button", { name: "Play", exact: true }),
        ).toBeDisabled();
        const metrics = await page.evaluate(() => {
          const fields = Array.from(
            document.querySelectorAll(
              '[data-slot="form-field"][data-layout="stacked"]',
            ),
          ).filter((el) => el.getBoundingClientRect().height > 0);
          const gaps = fields.map((el) => {
            const a = el.children[0]!.getBoundingClientRect(),
              b = el.children[1]!.getBoundingClientRect();
            return b.top - a.bottom;
          });
          const formInputs = Array.from(
            document.querySelectorAll('[data-slot="auth-frame"] input'),
          ).filter((el) => el.getBoundingClientRect().height > 0);
          const inputHeights = formInputs.map(
            (el) => el.getBoundingClientRect().height,
          );
          const widths = Array.from(
            document.querySelectorAll('[data-slot="media-cover"]'),
          ).map((el) => el.getBoundingClientRect().width);
          return {
            gaps,
            inputHeights,
            widths,
            overflow: document.documentElement.scrollWidth > innerWidth + 1,
          };
        });
        expect(metrics.overflow).toBe(false);
        for (const gap of metrics.gaps) expect(gap).toBeCloseTo(8, 0);
        for (const height of metrics.inputHeights)
          expect(height).toBe(mobile ? 44 : 40);
        for (const width of metrics.widths)
          expect(width).toBeGreaterThanOrEqual(48);
      });
    });
}
