import { test, expect, type Page, type Locator } from "@playwright/test";
const finish = (p: Page) =>
  p.getByRole("button", {
    name: "Completar acción o lectura de muestra",
    exact: true,
  });
async function open(page: Page) {
  const errors: string[] = [],
    unexpected: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (
      u.pathname.startsWith("/api/") ||
      (!["127.0.0.1", "localhost"].includes(u.hostname) &&
        u.protocol !== "data:")
    )
      unexpected.push(r.url());
  });
  await page.clock.setFixedTime(new Date("2026-10-19T09:00:00Z"));
  await page.goto("/admin-playlist-editor-demo.html");
  const root = page.getByRole("region", {
    name: "Página real de PlaylistEditor",
    exact: true,
  });
  await expect(
    root.getByRole("heading", { name: "Costa de noche", exact: true }),
  ).toBeVisible();
  return { root, errors, unexpected };
}
async function geometry(page: Page, root: Locator) {
  const hero = await root
    .getByRole("button", { name: "Back to playlists", exact: true })
    .evaluate((back) => {
      const title = back
        .closest('[aria-label="Página real de PlaylistEditor"]')!
        .querySelector("h1")!;
      const header = title.closest("section")!;
      const art = header.querySelector(".h-28.w-28")!.getBoundingClientRect();
      const copy = title.closest(".min-w-0.space-y-4")!.getBoundingClientRect();
      return {
        backInsideHeader: header.contains(back),
        backBottom: back.getBoundingClientRect().bottom,
        headerTop: header.getBoundingClientRect().top,
        artTop: art.top,
        artWidth: art.width,
        artHeight: art.height,
        copyTop: copy.top,
        wide: header.getBoundingClientRect().width - 42 >= 672,
        copyWidth: copy.width,
        actionTop: header
          .querySelector('[role="group"][aria-label="Playlist actions"]')!
          .getBoundingClientRect().top,
        actionBottom: header
          .querySelector('[role="group"][aria-label="Playlist actions"]')!
          .getBoundingClientRect().bottom,
      };
    });
  expect(hero.backInsideHeader).toBe(false);
  expect(hero.backBottom).toBeLessThan(hero.headerTop);
  expect(hero.artWidth).toBe(112);
  expect(hero.artHeight).toBe(112);
  if (hero.wide) expect(hero.artTop).toBe(hero.copyTop);
  else expect(hero.artTop).toBeLessThan(hero.copyTop);
  if (hero.wide) expect(hero.actionTop).toBe(hero.artTop);
  else expect(hero.actionBottom).toBeLessThan(hero.artTop);
  for (const remove of await root
    .locator('svg[data-admin-ux="editor-remove-rule"]')
    .all()) {
    const { width, tops } = await remove.evaluate((icon) => {
      const rule = icon.closest("button")!.parentElement!.parentElement!;
      const fields = Array.from(rule.querySelectorAll(".crate-form-field"));
      return {
        width: fields[0]!.parentElement!.getBoundingClientRect().width,
        tops: fields.map((field) => field.getBoundingClientRect().top),
      };
    });
    expect(tops).toHaveLength(3);
    if (width >= 576) expect(new Set(tops).size).toBe(1);
    else expect(tops[0]! < tops[1]! && tops[1]! < tops[2]!).toBe(true);
  }
  for (const f of await root.locator(".crate-form-field").all())
    expect(
      await f.evaluate((e) => {
        const [a, b] = Array.from(e.children);
        return (
          b!.getBoundingClientRect().top - a!.getBoundingClientRect().bottom
        );
      }),
    ).toBe(8);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    JSON.stringify(
      await root.evaluate((e) =>
        Array.from(e.querySelectorAll("*"))
          .map((n) => ({
            tag: n.tagName,
            class: n.className,
            right: n.getBoundingClientRect().right,
            width: n.getBoundingClientRect().width,
          }))
          .filter((n) => n.right > innerWidth + 1)
          .slice(0, 12),
      ),
    ),
  ).toBe(true);
  for (const b of await root.locator('button[data-slot="button"]').all())
    expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const formHeight = await page.evaluate(() =>
    matchMedia("(pointer: coarse)").matches ? 44 : 40,
  );
  for (const input of await root
    .locator(
      'input:not([type="checkbox"]):not([type="file"]),button[role="combobox"]',
    )
    .all())
    expect((await input.boundingBox())!.height).toBe(formHeight);
}
for (const { width, touch } of [
  { width: 1310, touch: false },
  { width: 1128, touch: false },
  { width: 768, touch: false },
  { width: 390, touch: false },
  { width: 390, touch: true },
])
  test.describe(`track search ${width}${touch ? " touch" : ""}`, () => {
    test.use({ hasTouch: touch });
    test("centered icon, aligned scope Select and accurate copy", async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1424 });
      const { root, errors, unexpected } = await open(page);
      const search = root.getByRole("textbox", {
        name: "Search tracks",
        exact: true,
      });
      const inputBox = (await search.boundingBox())!;
      const iconBox = (await root
        .locator('svg[data-admin-ux="editor-search"]')
        .boundingBox())!;
      expect(
        Math.abs(
          iconBox.y + iconBox.height / 2 - (inputBox.y + inputBox.height / 2),
        ),
      ).toBeLessThan(0.5);
      const scope = root.getByRole("combobox", {
        name: "Search scope",
        exact: true,
      });
      await expect(scope).toHaveText("Entire library");
      await expect(search).toHaveAttribute(
        "placeholder",
        "Search library tracks...",
      );
      const scopeBox = (await scope.boundingBox())!;
      expect(inputBox.height).toBe(touch ? 44 : 40);
      expect(scopeBox.height).toBe(inputBox.height);
      if (width >= 1024) expect(scopeBox.y).toBe(inputBox.y);
      else expect(scopeBox.y).toBeGreaterThan(inputBox.y + inputBox.height);
      await geometry(page, root);
      const duplicate = root.getByRole("button", {
        name: "Duplicate",
        exact: true,
      });
      await duplicate.focus();
      await expect(
        page.getByRole("tooltip", { name: "Duplicate", exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await duplicate.press("Tab");
      await expect(
        root.getByRole("button", { name: "Preview", exact: true }),
      ).toBeFocused();
      await expect(
        page.getByRole("tooltip", { name: "Preview", exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      const field = root.getByRole("combobox", { name: "Field", exact: true });
      await field.click();
      await page.getByRole("option", { name: "Year", exact: true }).click();
      await root
        .getByRole("combobox", { name: "Operator", exact: true })
        .click();
      await page.getByRole("option", { name: "Between", exact: true }).click();
      await expect(
        root.getByRole("spinbutton", { name: "Rule 1 minimum" }),
      ).toBeVisible();
      await expect(
        root.getByRole("spinbutton", { name: "Rule 1 maximum" }),
      ).toBeVisible();
      await geometry(page, root);
      await field.click();
      await page.getByRole("option", { name: "Title", exact: true }).click();
      await expect(
        root.getByRole("textbox", { name: "Rule 1 value" }),
      ).toBeVisible();
      await geometry(page, root);
      await scope.press("Enter");
      await expect(
        page.getByRole("option", { name: "Entire library", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Home");
      await expect(
        page.getByRole("option", { name: "Matching rules", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(scope).toBeFocused();
      await expect(search).toHaveAttribute(
        "placeholder",
        "Search tracks matching this playlist...",
      );
      await page.getByRole("radio", { name: "Estática", exact: true }).click();
      await expect(scope).toBeDisabled();
      await expect(scope).toHaveText("Entire library");
      await expect(search).toHaveAttribute(
        "placeholder",
        "Search library tracks...",
      );
      expect(errors).toEqual([]);
      expect(unexpected).toEqual([]);
    });
  });

for (const width of [1440, 768, 390])
  test(`PlaylistEditor ${width}: real geometry, fonts, chips, keyboard and preview`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1100 });
    const { root, errors, unexpected } = await open(page);
    await page.waitForFunction(() => document.fonts.status === "loaded");
    expect(
      await root
        .getByRole("heading", { name: "Costa de noche" })
        .evaluate((e) => getComputedStyle(e).fontFamily),
    ).toContain("Bricolage");
    const chips = await root
      .locator("span.rounded-full.font-mono:visible")
      .evaluateAll((es) =>
        es.map((e) => {
          const s = getComputedStyle(e);
          return [
            e.getBoundingClientRect().height,
            s.fontSize,
            s.lineHeight,
            s.fontFamily,
            s.fontWeight,
            s.padding,
          ];
        }),
      );
    expect(chips.length).toBeGreaterThan(10);
    expect(new Set(chips.map((v) => JSON.stringify(v))).size).toBe(1);
    expect(chips[0]).toEqual([
      24,
      "12px",
      "16px",
      expect.stringContaining("JetBrains"),
      "400",
      "3px 8px",
    ]);
    expect(
      await root
        .getByText("Followers", { exact: true })
        .evaluate((e) => getComputedStyle(e).fontFamily),
    ).toContain("JetBrains");
    expect(
      await root
        .locator('[draggable="true"]')
        .first()
        .getByText("3:00", { exact: true })
        .evaluate((e) => [
          getComputedStyle(e).fontFamily,
          getComputedStyle(e).fontWeight,
        ]),
    ).toEqual([expect.stringContaining("JetBrains"), "400"]);
    await geometry(page, root);
    const category = root.getByRole("combobox", {
      name: "Category",
      exact: true,
    });
    await category.press("Enter");
    await expect(
      page.getByRole("option", { name: "Editorial", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Home");
    await expect(
      page.getByRole("option", { name: "None", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(category).toHaveText("None");
    await expect(category).toBeFocused();
    await category.click();
    await page.getByRole("option", { name: "Editorial", exact: true }).click();
    for (const [name, option, reset] of [
      ["Match", "Any rule", "All rules"],
      ["Sort", "Popularity", "Random"],
    ] as const) {
      const select = root.getByRole("combobox", { name, exact: true });
      await select.click();
      await page.getByRole("option", { name: option, exact: true }).click();
      await expect(select).toHaveText(option);
      await select.click();
      await page.getByRole("option", { name: reset, exact: true }).click();
    }
    const operator = root.getByRole("combobox", {
      name: "Operator",
      exact: true,
    });
    await operator.press("Enter");
    await page.keyboard.press("Home");
    await expect(
      page.getByRole("option", { name: "Equals", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(operator).toBeFocused();
    await operator.click();
    await page.getByRole("option", { name: "Contains", exact: true }).click();
    await root.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(
      root.getByRole("button", { name: "Preview", exact: true }),
    ).toBeDisabled();
    await finish(page).click();
    await expect(
      root.getByText("3 matching tracks", { exact: true }),
    ).toBeVisible();
    await expect(root.getByText("Marea", { exact: true })).toBeVisible();
    await geometry(page, root);
    const row = root.locator('[draggable="true"]').first();
    await page.mouse.move(0, 0);
    const bg = await row.evaluate((e) => getComputedStyle(e).backgroundColor);
    await row.hover();
    await expect
      .poll(() => row.evaluate((e) => getComputedStyle(e).backgroundColor))
      .toBe(bg);
    expect(errors).toEqual([]);
    expect(unexpected).toEqual([]);
  });
test("local failure, SSE updates without resetting edits and finite states", async ({
  page,
}) => {
  const { root, errors, unexpected } = await open(page);
  await root
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Borrador local");
  await page
    .getByRole("button", { name: "Enviar cambio SSE de muestra", exact: true })
    .click();
  await expect(root.getByText("Generating", { exact: true })).toBeVisible();
  await expect(
    root.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveValue("Borrador local");
  await page
    .getByRole("checkbox", { name: "Fallar la siguiente acción", exact: true })
    .check();
  await root.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("status").first()).toContainText(
    '"name":"Borrador local"',
  );
  await finish(page).click();
  await expect(
    page.getByText("Failed to save playlist", { exact: true }),
  ).toBeVisible();
  await expect(
    root.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveValue("Borrador local");
  await page.getByRole("radio", { name: "Cargando", exact: true }).click();
  await expect(
    root.getByRole("status", { name: "Loading playlist editor", exact: true }),
  ).toBeVisible();
  await finish(page).click();
  await expect(
    root.getByRole("heading", { name: "Costa de noche" }),
  ).toBeVisible();
  await page.getByRole("radio", { name: "No encontrada", exact: true }).click();
  await expect(
    root.getByText("Playlist not found", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("radio", { name: "Generación fallida", exact: true })
    .click();
  await expect(
    root.getByText("Fallo de generación de muestra. Puedes reintentar.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("radio", { name: "Estática", exact: true }).click();
  await expect(
    root.getByRole("button", { name: "Generate", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("checkbox", { name: "IA disponible en muestra", exact: true })
    .uncheck();
  await expect(
    root.getByRole("button", { name: "Refine tracklist with AI", exact: true }),
  ).toHaveCount(0);
  await root.getByRole("button", { name: "Duplicate", exact: true }).click();
  await finish(page).click();
  await expect(page.getByText("/playlists/99", { exact: true })).toBeVisible();
  await page
    .getByRole("link", { name: "Volver al editor de muestra", exact: true })
    .click();
  await root
    .getByRole("button", { name: "Back to playlists", exact: true })
    .click();
  await expect(page.getByText("/playlists", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  expect(unexpected).toEqual([]);
});
test("cover and track actions, candidate search and staged refinement use local contracts", async ({
  page,
}) => {
  const { root, errors, unexpected } = await open(page);
  const tracks = root.locator('[draggable="true"]');
  await tracks.first().dragTo(tracks.nth(1));
  await expect(page.getByRole("status").first()).toContainText(
    '"track_ids":[2,1]',
  );
  await finish(page).click();
  await expect(tracks.first()).toContainText("Horizonte");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6DgAAAABJRU5ErkJggg==",
    "base64",
  );
  await root
    .locator('input[type="file"]')
    .setInputFiles({ name: "sample.png", mimeType: "image/png", buffer: png });
  await expect(page.getByRole("status").first()).toContainText(
    '"cover_data_url":"data:image/png;base64,',
  );
  await finish(page).click();
  await expect(
    root.getByRole("button", { name: "Remove cover", exact: true }),
  ).toBeVisible();
  await root.getByRole("button", { name: "Remove cover", exact: true }).click();
  await finish(page).click();
  await expect(
    root.getByRole("button", { name: "Remove cover", exact: true }),
  ).toHaveCount(0);
  await root
    .getByRole("textbox", { name: "Search tracks", exact: true })
    .fill("Bruma");
  await expect(finish(page)).toBeEnabled();
  await finish(page).click();
  await root.getByRole("button", { name: "Add locked", exact: true }).click();
  await finish(page).click();
  await expect(
    root.getByRole("button", { name: "Remove Bruma", exact: true }),
  ).toBeVisible();
  await root
    .getByRole("textbox", { name: "Search tracks", exact: true })
    .fill("Bruma");
  await expect(finish(page)).toBeEnabled();
  await finish(page).click();
  await root.getByRole("button", { name: "Add locked", exact: true }).click();
  await finish(page).click();
  await expect(
    root.getByRole("button", { name: "Remove Bruma", exact: true }),
  ).toHaveCount(2);
  await tracks.last().dragTo(tracks.first());
  await expect(page.getByRole("status").first()).toContainText(
    '"track_ids":[4,2,1,3]',
  );
  await finish(page).click();
  await root
    .getByRole("button", { name: "Remove Bruma", exact: true })
    .last()
    .click();
  await finish(page).click();
  await root.getByRole("button", { name: "Remove Bruma", exact: true }).click();
  await finish(page).click();
  await root
    .getByRole("button", { name: "Generate description with AI", exact: true })
    .click();
  await finish(page).click();
  await expect(
    root.getByRole("textbox", { name: "Description", exact: true }),
  ).toHaveValue("Una selección nocturna de ambient y costa.");
  await root
    .getByRole("button", { name: "Refine tracklist with AI", exact: true })
    .click();
  await finish(page).click();
  await expect(
    root.getByText("Una pista duplicada puede retirarse.", { exact: true }),
  ).toBeVisible();
  await root.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(
    root.getByText("Una pista duplicada puede retirarse.", { exact: true }),
  ).toHaveCount(0);
  await root
    .getByRole("button", { name: "Refine tracklist with AI", exact: true })
    .click();
  await finish(page).click();
  await root
    .getByRole("button", { name: "Apply safe fixes", exact: true })
    .click();
  await finish(page).click();
  await expect(
    root.getByRole("button", { name: "Remove Horizonte", exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(unexpected).toEqual([]);
});
test("persistent 1AQ preserves published 1AP and mounts the real editor", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1464, height: 1424 });
  await page.goto("/#editor-playlists-admin");
  await expect(page.locator("#playlists-admin")).toContainText(
    "Checkpoint 1AP · Publicado",
  );
  await expect(page.locator("#editor-playlists-admin")).toContainText(
    "Checkpoint 1AQ · En revisión",
  );
  await page
    .getByText("Inventario de acciones de Admin", { exact: true })
    .click();
  const inventory = page.getByRole("table", {
    name: "Iconos de acciones de Admin",
    exact: true,
  });
  await expect(inventory.getByRole("row")).toHaveCount(14);
  await expect(
    inventory.locator('svg[data-action-icon-family][aria-hidden="true"]'),
  ).toHaveCount(13);
  await page
    .locator('iframe[title="PlaylistEditor real con datos de muestra"]')
    .scrollIntoViewIfNeeded();
  await expect(
    page
      .frameLocator('iframe[title="PlaylistEditor real con datos de muestra"]')
      .getByRole("heading", { name: "Costa de noche", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  const frame = page.frameLocator(
    'iframe[title="PlaylistEditor real con datos de muestra"]',
  );
  const rule = await frame
    .getByRole("button", { name: "Remove rule 1", exact: true })
    .evaluate((button) => {
      const fields = Array.from(
        button.parentElement!.parentElement!.querySelectorAll(
          ".crate-form-field",
        ),
      );
      return {
        frameWidth: window.innerWidth,
        width: fields[0]!.parentElement!.getBoundingClientRect().width,
        tops: fields.map((field) => field.getBoundingClientRect().top),
      };
    });
  expect(rule.frameWidth).toBeLessThan(1280);
  expect(rule.width).toBeGreaterThanOrEqual(576);
  expect(rule.tops).toHaveLength(3);
  expect(new Set(rule.tops).size).toBe(1);
});
