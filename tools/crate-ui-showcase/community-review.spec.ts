import { expect, test } from "@playwright/test";
for (const host of ["storybook", "standalone"] as const)
  for (const width of [375, 1200]) {
    test(`${host} community ${width}px`, async ({ browser }) => {
      test.setTimeout(60000);
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
        hasTouch: width === 375,
        isMobile: width === 375,
        reducedMotion: "reduce",
      });
      const page = await context.newPage(),
        errors: string[] = [],
        requests: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (new URL(request.url()).pathname.startsWith("/api/"))
          requests.push(request.url());
      });
      await page.goto(
        host === "storybook"
          ? "/iframe.html?id=reviews-1bd-community--complete&viewMode=story"
          : "http://127.0.0.1:5186/review-1bd-community.html",
      );
      await expect(
        page.getByRole("heading", {
          name: "Listeners and connections",
          exact: true,
        }),
      ).toBeVisible({ timeout: 30000 });
      const storage = await page.evaluate(() =>
        JSON.stringify(Object.entries(localStorage).sort()),
      );
      const tab = (name: string) =>
        page.getByRole("tab", { name, exact: true });
      async function measure() {
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        for (const metric of await page
          .locator('[data-slot="profile-metric"]:visible')
          .all()) {
          expect(
            await metric.evaluate((el) => {
              const value = el.querySelector(".font-display")!;
              return (
                value.getBoundingClientRect().right <=
                el.getBoundingClientRect().right + 1
              );
            }),
          ).toBe(true);
        }
        for (const field of await page
          .locator('[data-slot="form-field"][data-layout="stacked"]:visible')
          .all()) {
          expect(
            await field.evaluate((el) => {
              const caption = el.querySelector(
                '[data-slot="form-field-label"]',
              )!;
              const body = Array.from(el.children).find(
                (child) => child !== caption,
              )!;
              return (
                body.getBoundingClientRect().top -
                caption.getBoundingClientRect().bottom
              );
            }),
          ).toBeCloseTo(8, 1);
        }
        for (const caption of await page
          .locator('[data-slot="form-field-label"] > .uppercase:visible')
          .all()) {
          await expect(caption).toHaveCSS("text-transform", "uppercase");
          await expect(caption).toHaveCSS("font-weight", "400");
        }
      }
      async function choose(label: string, value: string) {
        await page.getByRole("combobox", { name: label, exact: true }).click();
        await page.getByRole("option", { name: value, exact: true }).click();
      }
      await measure();
      const search = page.getByRole("searchbox", {
        name: "Search",
        exact: true,
      });
      expect((await search.boundingBox())!.height).toBeCloseTo(
        width === 375 ? 44 : 40,
        1,
      );
      await search.fill("no-such-listener");
      await expect(
        page.getByText("No users matched “no-such-listener”.", { exact: true }),
      ).toBeVisible();
      await search.fill("Jane");
      await expect(
        page.getByRole("link", { name: /Jane Doe @jane/ }),
      ).toBeVisible();
      await choose("Read state", "error");
      await expect(page.getByRole("alert")).toHaveCount(2);
      await page
        .getByRole("region", { name: "Search by username or display name" })
        .getByRole("button", { name: "Retry" })
        .click();
      await expect(page.getByRole("alert")).toHaveCount(0);
      await tab("Public profile").click();
      await expect(
        page.getByRole("heading", { name: "Jane Doe", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "View Crate DNA", exact: true }),
      ).toHaveAttribute("href", "/users/jane/stats");
      const profileCard = page.getByRole("region", {
        name: "Jane Doe",
        exact: true,
      });
      const header = profileCard.getByTestId("page-header");
      await expect(header.getByText("Affinity", { exact: true })).toBeVisible();
      const affinity = header.locator('[data-slot="profile-affinity"]');
      const headerBox = (await header.boundingBox())!,
        affinityBox = (await affinity.boundingBox())!;
      expect(affinityBox.x + affinityBox.width).toBeCloseTo(
        headerBox.x + headerBox.width,
        1,
      );
      if (width === 1200) expect(affinityBox.y).toBeCloseTo(headerBox.y, 1);
      await expect(affinity.locator(".font-display")).toHaveClass(
        /text-numeral-md/,
      );
      const affinitySize = await affinity
        .locator(".font-display")
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      const metricSize = await profileCard
        .getByText("126", { exact: true })
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(affinitySize).toBeGreaterThan(metricSize);
      const followerX = (await profileCard
        .getByRole("link", { name: "Followers: 12", exact: true })
        .boundingBox())!.x;
      const followingX = (await profileCard
        .getByRole("link", { name: "Following: 9", exact: true })
        .boundingBox())!.x;
      const friendsX = (await profileCard
        .getByText("3", { exact: true })
        .boundingBox())!.x;
      expect(
        (await profileCard.getByText("126", { exact: true }).boundingBox())!.x,
      ).toBeCloseTo(followerX, 1);
      expect(
        (await profileCard.getByText("10h 40m", { exact: true }).boundingBox())!
          .x,
      ).toBeCloseTo(followingX, 1);
      expect(
        (await profileCard.getByText("8", { exact: true }).boundingBox())!.x,
      ).toBeCloseTo(friendsX, 1);
      expect(
        (await profileCard
          .getByText("Top sound", { exact: true })
          .boundingBox())!.x,
      ).toBeCloseTo(followerX, 1);
      await page.getByRole("button", { name: "Follow", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Following", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("checkbox", { name: "Own profile", exact: true })
        .check();
      await expect(
        page.getByRole("button", { name: "Following", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("link", { name: "Edit account", exact: true }),
      ).toHaveAttribute("href", "/settings?tab=account");
      await expect(
        page.getByRole("link", { name: "View Crate DNA", exact: true }),
      ).toHaveAttribute("href", "/stats");
      await page
        .getByRole("checkbox", { name: "Long content", exact: true })
        .check();
      await measure();
      await page
        .getByRole("checkbox", { name: "Empty / zero", exact: true })
        .check();
      await expect(
        page.getByText("No public playlists yet.", { exact: true }),
      ).toBeVisible();
      await measure();
      await tab("Connections").click();
      await expect(
        page.getByText("No followers yet.", { exact: true }),
      ).toBeVisible();
      await choose("Read state", "loading");
      await expect(page.locator('[data-slot="skeleton-user-row"]')).toHaveCount(
        5,
      );
      await choose("Read state", "error");
      await expect(page.getByRole("alert")).toHaveCount(1);
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      await choose("Connections", "Following");
      await expect(
        page.getByText("Not following anyone yet.", { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("checkbox", { name: "Empty / zero", exact: true })
        .uncheck();
      await tab("Profile card").click();
      await measure();
      const avatar = page.locator('[data-slot="avatar"][data-size="lg"]');
      await expect(avatar).toHaveCount(1);
      expect((await avatar.boundingBox())!.width).toBe(56);
      await expect(
        page.getByRole("link", { name: "Crate DNA", exact: true }),
      ).toHaveAttribute("href", "/stats");
      await expect(
        page.getByRole("button", { name: "Following", exact: true }),
      ).toHaveCount(0);
      await page
        .getByRole("checkbox", { name: "Own profile", exact: true })
        .uncheck();
      await page.getByRole("checkbox", { name: "Busy", exact: true }).check();
      await expect(
        page.getByRole("button", { name: "Following", exact: true }),
      ).toBeDisabled();
      await measure();
      await expect(
        page.getByRole("link", { name: "View profile", exact: true }),
      ).toHaveAttribute("href", "/users/jane");
      expect(
        await page.evaluate(() =>
          JSON.stringify(Object.entries(localStorage).sort()),
        ),
      ).toBe(storage);
      expect(requests).toEqual([]);
      expect(errors).toEqual([]);
      await context.close();
    });
  }
