import { expect, test } from "@playwright/test";
for (const host of ["preview", "storybook"])
  for (const width of [390, 1200]) {
    test(`${host} layers, focus, gaps and nested dismissal ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      const errors: string[] = [];
      const requests: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (new URL(request.url()).pathname.startsWith("/api/"))
          requests.push(request.url());
      });
      await page.goto(
        host === "preview"
          ? "http://127.0.0.1:5186/review-1ax-layers.html"
          : "/iframe.html?id=reviews-1ax-layers--complete&viewMode=story",
      );
      await expect(
        page.getByRole("link", { name: "Skip to review content" }),
      ).toBeAttached();
      if (host === "storybook")
        await page
          .getByRole("link", { name: "Skip to review content" })
          .focus();
      else await page.keyboard.press("Tab");
      const skip = page.getByRole("link", { name: "Skip to review content" });
      await expect(skip).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.locator("#layers-main")).toBeFocused();
      await page.evaluate(() => document.fonts.ready);
      for (const field of await page
        .locator('[data-slot="form-field"][data-layout="stacked"]')
        .all()) {
        const gap = await field.evaluate((el) => {
          const caption = el.querySelector('[data-slot="form-field-label"]')!;
          return (
            caption.nextElementSibling!.getBoundingClientRect().top -
            caption.getBoundingClientRect().bottom
          );
        });
        expect(gap).toBeCloseTo(8, 1);
      }
      const trigger = page.getByRole("button", {
        name: "Open playlist settings",
      });
      await trigger.click();
      const dialog = page.getByRole("dialog", {
        name: "Playlist settings",
        includeHidden: true,
      });
      await expect(dialog).toBeVisible();
      await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
      await dialog.locator("[data-app-modal-panel]").evaluate(async (el) => {
        await Promise.all(
          el.getAnimations().map((animation) => animation.finished),
        );
      });
      for (const field of await dialog
        .locator('[data-slot="form-field"][data-layout="stacked"]')
        .all()) {
        const gap = await field.evaluate((el) => {
          const label = el.querySelector('[data-slot="form-field-label"]')!;
          return (
            label.nextElementSibling!.getBoundingClientRect().top -
            label.getBoundingClientRect().bottom
          );
        });
        expect(gap).toBeCloseTo(8, 1);
      }
      const input = dialog.getByRole("textbox", { name: "Playlist name" });
      const select = dialog.getByRole("combobox", { name: "Visibility" });
      expect((await input.boundingBox())!.height).toBe(
        (await select.boundingBox())!.height,
      );
      await select.click();
      const options = page.getByRole("listbox");
      await expect(options).toBeVisible();
      expect(
        await options.evaluate((el) => Number(getComputedStyle(el).zIndex)),
      ).toBeGreaterThan(
        await dialog.evaluate((el) => Number(getComputedStyle(el).zIndex)),
      );
      await page.keyboard.press("End");
      await expect(
        page.getByRole("option", { name: "Review scope 20", exact: true }),
      ).toBeInViewport();
      await page.keyboard.press("Escape");
      await expect(options).not.toBeVisible();
      await expect(dialog).toBeVisible();
      await expect(select).toBeFocused();
      const about = dialog.getByRole("button", { name: "About visibility" });
      await about.focus();
      await about.hover();
      await expect(page.getByRole("tooltip")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("tooltip")).not.toBeVisible();
      await expect(dialog).toBeVisible();
      const nestedTrigger = dialog.getByRole("button", {
        name: "Open nested dialog",
      });
      await nestedTrigger.click();
      const nested = page.getByRole("dialog", {
        name: "Nested dialog",
        exact: true,
      });
      await expect(nested).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(nested).not.toBeVisible();
      await expect(dialog).toBeVisible();
      await expect(nestedTrigger).toBeFocused();
      await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
      const busy = dialog.getByRole("switch", { name: "Simulate saving" });
      await busy.click();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "Close", exact: true }),
      ).toBeDisabled();
      await busy.click();
      const save = dialog.getByRole("button", { name: "Save settings" });
      await save.focus();
      await page.keyboard.press("Tab");
      await expect(
        dialog.getByRole("button", { name: "Close", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await expect(trigger).toBeFocused();
      await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
      await expect(
        page.getByRole("status", { name: "Loading route" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(
        page.getByText("Retry requested.", { exact: true }),
      ).toBeVisible();
      await page.getByRole("tab", { name: "Tracks", exact: true }).click();
      await expect(page.getByRole("tabpanel")).toHaveText("Track collection");
      await page
        .getByRole("button", { name: "Simulate render failure" })
        .click();
      await expect(
        page.getByRole("heading", { name: "Something went wrong", level: 1 }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Go home" }).click();
      await expect(
        page.getByText("Collection restored.", { exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: `.artifacts/review/1ax-${host}-${width}.png`,
        fullPage: true,
      });
      expect(errors).toEqual([]);
      expect(requests).toEqual([]);
    });
  }
for (const width of [390, 1200])
  test(`Listen real sort, playlist, search and URL helper ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const searches: string[] = [];
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/catalog/search")
        searches.push(url.pathname + url.search);
      await route.fulfill({
        json: {
          artists: [{ id: 52, slug: "high-vis", name: "High Vis" }],
          albums: [],
          tracks: [],
        },
      });
    });
    await page.goto(
      "http://127.0.0.1:5174/tests/layers-contract.html?tab=unknown&node=sample&tag=a&tag=b#collection",
    );
    await expect(
      page.getByRole("tab", { name: "Albums", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    expect(page.url()).toContain("tab=unknown");
    await page.getByRole("tab", { name: "Tracks", exact: true }).click();
    await expect(page).toHaveURL(/tab=tracks/);
    expect(page.url()).toContain("node=sample&tag=a&tag=b#collection");
    await page.getByRole("button", { name: "History back" }).click();
    await expect(page).toHaveURL(/tab=unknown/);
    await expect(
      page.getByRole("tab", { name: "Albums", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await page.getByRole("button", { name: "History forward" }).click();
    await expect(page).toHaveURL(/tab=tracks/);
    await expect(
      page.getByRole("tab", { name: "Tracks", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    const sort = page.getByRole("combobox", {
      name: "Sort albums:",
      exact: false,
    });
    await sort.click();
    await page.getByRole("option", { name: "Name", exact: true }).click();
    await expect(page.getByRole("status", { name: "Sort value" })).toHaveText(
      "name",
    );
    await page.getByRole("button", { name: "Create fixture playlist" }).click();
    const dialog = page.getByRole("dialog", {
      name: "Create playlist",
      exact: true,
    });
    await dialog.getByRole("combobox", { name: "Visibility" }).click();
    await page.getByRole("option", { name: "Public", exact: true }).click();
    await dialog.getByRole("switch", { name: "Collaborative" }).click();
    await dialog
      .getByRole("button", { name: "Create playlist", exact: true })
      .click();
    await expect(
      page.getByRole("status", { name: "Submitted playlist" }),
    ).toContainText('"visibility":"public"');
    await expect(
      page.getByRole("status", { name: "Submitted playlist" }),
    ).toContainText('"isCollaborative":true');
    const trigger = page.getByRole("button", { name: "Search", exact: true });
    await trigger.click();
    const search = page.getByRole("combobox", { name: "Search", exact: true });
    await search.dispatchEvent("compositionstart");
    await search.fill("high");
    await page.waitForTimeout(300);
    expect(searches).toEqual([]);
    await search.dispatchEvent("compositionend");
    const option = page.getByRole("option", { name: /High Vis/ });
    await expect(option).toBeVisible();
    await search.press("ArrowDown");
    await expect(search).toHaveAttribute(
      "aria-activedescendant",
      (await option.getAttribute("id")) as string,
    );
    await expect(search).toBeFocused();
    const listbox = page.getByRole("listbox");
    const rect = (await listbox.boundingBox())!;
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(width);
    await search.press("Escape");
    await expect(trigger).toBeFocused();
    await expect(listbox).not.toBeVisible();
  });

test("readonly playlist fields reserve their full text height", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.route("**/api/**", (route) => route.fulfill({ json: {} }));
  await page.goto("http://127.0.0.1:5174/tests/layers-contract.html?long=1");
  await page.getByRole("button", { name: "Create fixture playlist" }).click();
  for (const name of ["Playlist", "Description"]) {
    const value = page.getByRole("button", { name, exact: true });
    await expect(value).toBeVisible();
    expect(
      await value.evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
    ).toBe(true);
  }
});
test("keyboard search keeps the active result visible while input retains focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 480 });
  await page.route("**/api/**", (route) =>
    route.fulfill({
      json: {
        artists: Array.from({ length: 12 }, (_, i) => ({
          id: i + 1,
          slug: `artist-${i}`,
          name: `Artist ${i}`,
        })),
        albums: [],
        tracks: [],
      },
    }),
  );
  await page.goto("http://127.0.0.1:5174/tests/layers-contract.html");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const input = page.getByRole("combobox", { name: "Search", exact: true });
  await input.fill("artist");
  await expect(page.getByRole("option")).toHaveCount(12);
  for (let i = 0; i < 12; i++) await input.press("ArrowDown");
  const active = page.locator(
    `[id="${await input.getAttribute("aria-activedescendant")}"]`,
  );
  const popup = (await page.getByRole("listbox").locator("..").boundingBox())!;
  const row = (await active.boundingBox())!;
  expect(row.y + row.height).toBeLessThanOrEqual(popup.y + popup.height + 1);
  await expect(input).toBeFocused();
});
for (const host of ["preview", "storybook"])
  test(`${host} review includes all functional search feedback states`, async ({
    page,
  }) => {
    const api: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/"))
        api.push(request.url());
    });
    await page.goto(
      host === "preview"
        ? "http://127.0.0.1:5186/review-1ax-layers.html"
        : "/iframe.html?id=reviews-1ax-layers--complete&viewMode=story",
    );
    const input = page.getByRole("combobox", { name: "Review search" });
    await expect(input).toBeVisible();
    for (const mode of ["Loading", "Empty", "Error", "Recent", "Results"]) {
      await page
        .getByRole("combobox", { name: "Search feedback state" })
        .click();
      await page.getByRole("option", { name: mode, exact: true }).click();
      await input.focus();
      if (mode === "Loading")
        await expect(
          page.getByRole("status", { name: "Loading Crate..." }),
        ).toBeVisible();
      if (mode === "Empty")
        await expect(
          page.getByText("No music found", { exact: true }),
        ).toBeVisible();
      if (mode === "Error")
        await expect(
          page.getByText("Search unavailable", { exact: true }),
        ).toBeVisible();
      if (mode === "Recent")
        await expect(
          page.getByRole("option", { name: "Costa de noche", exact: true }),
        ).toBeVisible();
      if (mode === "Results") {
        await expect(page.getByRole("option")).toHaveCount(12);
        await input.press("ArrowDown");
        await expect(input).toBeFocused();
        await input.press("Enter");
        await expect(
          page.getByRole("status", { name: "Search review action" }),
        ).toHaveText("Selected Luz de octubre.");
      }
      await input.press("Escape");
    }
    expect(api).toEqual([]);
  });
