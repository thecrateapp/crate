import { test, expect, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const finish = (page: Page) =>
  page.getByRole("button", {
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
  await page.clock.setFixedTime(new Date("2026-10-18T12:00:00Z"));
  await page.goto("/admin-playlists-demo.html");
  const root = page.getByRole("region", {
    name: "Página real de System Playlists",
    exact: true,
  });
  await expect(
    root.getByRole("heading", { name: "Costa de noche", exact: true }),
  ).toBeVisible();
  return { root, errors, unexpected };
}
async function geometry(page: Page, root: Locator) {
  for (const remove of await root
    .locator('svg[data-admin-ux="playlists-remove-rule"]')
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
  for (const field of await root.locator(".crate-form-field").all())
    expect(
      await field.evaluate((e) => {
        const [l, v] = Array.from(e.children);
        return (
          v!.getBoundingClientRect().top - l!.getBoundingClientRect().bottom
        );
      }),
    ).toBe(8);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const formHeight = await page.evaluate(() =>
    matchMedia("(pointer: coarse)").matches ? 44 : 40,
  );
  for (const control of await root
    .locator(
      'input:not([type="checkbox"]):not([type="file"]),button[role="combobox"]',
    )
    .all())
    expect((await control.boundingBox())!.height).toBe(formHeight);
}
for (const width of [1440, 768, 390])
  test(`System Playlists ${width}: identity, filters, forms and local payloads`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1100 });
    const { root, errors, unexpected } = await open(page);
    await page.waitForFunction(() => document.fonts.status === "loaded");
    expect(
      await root
        .getByRole("heading", { name: "System Playlists", exact: true })
        .evaluate((e) => getComputedStyle(e).fontFamily),
    ).toContain("Bricolage Grotesque");
    const metadata = root.getByText("12 tracks", { exact: true }).first();
    expect(
      await metadata.evaluate((e) => [
        getComputedStyle(e).fontFamily,
        getComputedStyle(e).fontWeight,
      ]),
    ).toEqual([expect.stringContaining("JetBrains"), "400"]);
    await expect(root.locator(".playlist-artwork-placeholder svg")).toHaveCount(
      0,
    );
    expect(
      await root
        .locator('img[src="/assets/logo.svg"]')
        .first()
        .evaluate((e) => (e as HTMLImageElement).naturalWidth),
    ).toBeGreaterThan(0);
    await geometry(page, root);
    await root
      .getByRole("textbox", { name: "Search playlists", exact: true })
      .fill("Archivo");
    await expect(
      root.getByRole("heading", { name: "Costa de noche", exact: true }),
    ).toHaveCount(0);
    await root
      .getByRole("textbox", { name: "Search playlists", exact: true })
      .fill("");
    await root.getByRole("button", { name: /^Inactive\s*1$/ }).click();
    await expect(
      root.getByRole("heading", { name: "Archivo pausado", exact: true }),
    ).toBeVisible();
    await root.getByRole("button", { name: /^All\s*5$/ }).click();
    await root
      .getByRole("combobox", { name: "All categories", exact: true })
      .click();
    await page.getByRole("option", { name: "editorial", exact: true }).click();
    await expect(
      root.getByRole("heading", { name: "Ambient en marcha", exact: true }),
    ).toHaveCount(0);
    await root
      .getByRole("combobox", { name: "All categories", exact: true })
      .click();
    await page
      .getByRole("option", { name: "All categories", exact: true })
      .click();
    await root.getByRole("button", { name: "New static", exact: true }).click();
    await geometry(page, root);
    await root
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("  Puerto  ");
    await root.getByRole("combobox", { name: "Category", exact: true }).click();
    await page.getByRole("option", { name: "Genre", exact: true }).click();
    await root
      .getByRole("button", { name: "Create & open", exact: true })
      .click();
    await expect(
      root.getByRole("button", { name: "Create & open", exact: true }),
    ).toBeDisabled();
    await expect(page.getByRole("status").first()).toContainText(
      '"generation_mode":"static"',
    );
    await expect(page.getByRole("status").first()).toContainText(
      '"category":"genre"',
    );
    await finish(page).click();
    await expect(page).toHaveURL(/\/playlists\/99$/);
    await page
      .getByRole("link", { name: "Volver a playlists de muestra", exact: true })
      .click();
    await root.getByRole("button", { name: "New smart", exact: true }).click();
    await geometry(page, root);
    for (const [name, option] of [
      ["Category", "Genre"],
      ["Match", "Any rule"],
      ["Sort", "Popularity"],
    ]) {
      await root.getByRole("combobox", { name, exact: true }).click();
      await page.getByRole("option", { name: option, exact: true }).click();
    }
    const operator = root.getByRole("combobox", {
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
    await expect(operator).toContainText("Equals");
    await expect(operator).toBeFocused();
    await operator.click();
    await page.getByRole("option", { name: "Contains", exact: true }).click();
    await expect(
      root.getByRole("button", { name: "Remove rule 1", exact: true }),
    ).toBeDisabled();
    await root.getByRole("button", { name: "Add rule", exact: true }).click();
    await root
      .getByRole("button", { name: "Remove rule 2", exact: true })
      .click();
    await root
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Ambient mix");
    await root
      .getByRole("combobox", { name: "Select genre", exact: true })
      .click();
    await page.getByRole("option", { name: "Ambient", exact: true }).click();
    await root
      .getByRole("button", { name: "Create & open", exact: true })
      .click();
    await expect(page.getByRole("status").first()).toContainText(
      '"generation_mode":"smart"',
    );
    await expect(page.getByRole("status").first()).toContainText(
      '"value":"Ambient"',
    );
    await finish(page).click();
    await expect(page).toHaveURL(/\/playlists\/99$/);
    expect(errors).toEqual([]);
    expect(unexpected).toEqual([]);
  });
test("loading, empty, failure, status/deletion and row keyboard navigation remain local", async ({
  page,
}) => {
  const { root, errors, unexpected } = await open(page);
  await root
    .getByRole("button", { name: "Deactivate Costa de noche", exact: true })
    .click();
  await expect(page.getByRole("status").first()).toContainText(
    "/11/deactivate",
  );
  await finish(page).click();
  await expect(
    root.getByRole("button", { name: "Activate Costa de noche", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("checkbox", { name: "Fallar la siguiente acción", exact: true })
    .check();
  await root
    .getByRole("button", { name: "Delete Costa de noche", exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await finish(page).click();
  await expect(
    page.getByText("Failed to delete system playlist", { exact: true }),
  ).toBeVisible();
  await expect(
    root.getByRole("heading", { name: "Costa de noche", exact: true }),
  ).toBeVisible();
  await root
    .getByRole("button", { name: "Delete Costa de noche", exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await finish(page).click();
  await expect(
    root.getByRole("heading", { name: "Costa de noche", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("radio", { name: "Cargando", exact: true }).click();
  await expect(
    root.getByRole("status", { name: "Loading playlists", exact: true }),
  ).toBeVisible();
  await finish(page).click();
  await expect(
    root.getByRole("heading", { name: "Costa de noche", exact: true }),
  ).toBeVisible();
  await page.getByRole("radio", { name: "Vacío", exact: true }).click();
  await expect(
    root.getByRole("heading", {
      name: "No playlists for this view yet",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("radio", { name: "Con datos", exact: true }).click();
  await root
    .getByRole("link")
    .filter({ hasText: "Archivo pausado" })
    .press("Enter");
  await expect(page).toHaveURL(/\/playlists\/13$/);
  expect(errors).toEqual([]);
  expect(unexpected).toEqual([]);
});
test("persistent 1AP keeps all earlier checkpoints and the exact existing brand asset", async ({
  page,
}) => {
  expect(
    readFileSync(resolve("tools/design-system-preview/public/assets/logo.svg")),
  ).toEqual(readFileSync(resolve("app/ui/public/assets/logo.svg")));
  await page.goto("/#playlists-admin");
  await expect(page.locator("#playlists-admin")).toContainText(
    "Checkpoint 1AP · Publicado",
  );
  await expect(page.locator("#proximamente-admin")).toContainText(
    "Checkpoint 1AO · Publicado",
  );
  await page
    .locator('iframe[title="System Playlists real con datos de muestra"]')
    .scrollIntoViewIfNeeded();
  await expect(
    page
      .frameLocator(
        'iframe[title="System Playlists real con datos de muestra"]',
      )
      .getByRole("heading", { name: "System Playlists", exact: true }),
  ).toBeVisible();
});

test("row chips share one height, font and padding", async ({ page }) => {
  const { root } = await open(page);
  await page.waitForFunction(() => document.fonts.status === "loaded");
  const geometry = await root
    .locator('[role="link"] span.font-mono.rounded-full')
    .evaluateAll((elements) =>
      elements.map((e) => {
        const s = getComputedStyle(e);
        return {
          height: e.getBoundingClientRect().height,
          font: s.fontSize,
          line: s.lineHeight,
          weight: s.fontWeight,
          padding: [
            s.paddingTop,
            s.paddingRight,
            s.paddingBottom,
            s.paddingLeft,
          ],
        };
      }),
    );
  expect(geometry.length).toBeGreaterThan(10);
  expect(new Set(geometry.map((g) => JSON.stringify(g))).size).toBe(1);
});

test("playlist row hover keeps the resting background", async ({ page }) => {
  const { root } = await open(page);
  const row = root.getByRole("link").filter({ hasText: "Costa de noche" });
  await page.mouse.move(0, 0);
  const resting = await row.evaluate(
    (e) => getComputedStyle(e).backgroundColor,
  );
  await row.hover();
  await expect
    .poll(() => row.evaluate((e) => getComputedStyle(e).backgroundColor))
    .toBe(resting);
});

test("shared row bases keep backgrounds stable, selection visible and keyboard actions", async ({
  page,
}) => {
  await open(page);
  const section = page.getByRole("region", {
    name: "Filas compartidas sin iluminación",
    exact: true,
  });
  for (const row of [
    section.locator("article").first(),
    section.locator("article").last(),
    section.getByRole("listitem").first(),
    section.getByRole("listitem").last(),
    section.getByRole("row").first(),
    section.getByRole("row").last(),
  ]) {
    await page.mouse.move(0, 0);
    const resting = await row.evaluate(
      (e) => getComputedStyle(e).backgroundColor,
    );
    await row.hover();
    await expect
      .poll(() => row.evaluate((e) => getComputedStyle(e).backgroundColor))
      .toBe(resting);
  }
  expect(
    await section
      .locator("article")
      .last()
      .evaluate((e) => getComputedStyle(e).backgroundColor),
  ).not.toBe(
    await section
      .locator("article")
      .first()
      .evaluate((e) => getComputedStyle(e).backgroundColor),
  );
  await section
    .getByRole("button", { name: "Entidad de muestra", exact: true })
    .press("Enter");
  await section
    .getByRole("button", { name: "Fila de lista", exact: true })
    .press("Space");
  await expect(section.getByRole("status")).toHaveText(
    "Aperturas de muestra: 2",
  );
  await page.goto("/#pistas");
  const tracks = page.locator("#pistas .track-row");
  for (const row of [tracks.first(), tracks.nth(1)]) {
    await page.mouse.move(0, 0);
    const resting = await row.evaluate(
      (e) => getComputedStyle(e).backgroundColor,
    );
    await row.hover();
    await expect
      .poll(() => row.evaluate((e) => getComputedStyle(e).backgroundColor))
      .toBe(resting);
  }
  await expect(
    page.locator('#pistas [data-testid="track-row-playback-progress"]'),
  ).toBeVisible();
});

test("1AP uses display face only at the specified title size", async ({
  page,
}) => {
  const { root } = await open(page);
  await root.getByRole("button", { name: "New smart", exact: true }).click();
  await page.waitForFunction(() => document.fonts.status === "loaded");
  for (const heading of await root.getByRole("heading").all()) {
    const style = await heading.evaluate((e) => ({
      size: parseFloat(getComputedStyle(e).fontSize),
      family: getComputedStyle(e).fontFamily,
    }));
    if (style.size < 20)
      expect(style.family.split(",")[0]!.replace(/"/g, "").trim()).toBe(
        "IBM Plex Sans",
      );
    else expect(style.family).toContain("Bricolage Grotesque");
  }
});
