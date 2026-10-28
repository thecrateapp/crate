import { expect, test, type Page } from "@playwright/test";
async function open(page: Page) {
  const unexpected: string[] = [],
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (
      u.pathname.startsWith("/api/") ||
      u.port === "5174" ||
      (!["127.0.0.1", "localhost"].includes(u.hostname) &&
        u.protocol !== "data:")
    )
      unexpected.push(r.url());
  });
  await page.goto("/admin-translations-demo.html");
  const root = page.getByRole("region", {
    name: "Página real de Translations",
    exact: true,
  });
  await expect(
    root.getByRole("article", { name: "es locale health" }),
  ).toBeVisible();
  return { root, unexpected, errors };
}
async function editor(page: Page) {
  const root = page.getByRole("region", {
    name: "Página real de Translations",
    exact: true,
  });
  await root.getByRole("tab", { name: "Bundles", exact: true }).click();
  await root.getByRole("button", { name: "Review es", exact: true }).click();
  await expect(
    root.getByRole("textbox", { name: "Translation for player.play" }),
  ).toBeVisible();
  return root;
}
const finish = (page: Page) =>
  page.getByRole("button", {
    name: "Completar acción o lectura de muestra",
    exact: true,
  });
for (const width of [1440, 768, 390])
  test(`Translations specimen ${width}: typography, responsive editor and actual 8px fields`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1100 });
    const { root, unexpected, errors } = await open(page);
    await page.waitForFunction(() => document.fonts.status === "loaded");
    await expect(root.locator("svg")).toHaveCount(1);
    await expect(
      root.locator('svg[data-admin-ux="header-refresh"]'),
    ).toHaveCount(1);
    expect(
      await root
        .getByRole("heading", { level: 1 })
        .evaluate((e) => getComputedStyle(e).fontFamily),
    ).toContain("Bricolage Grotesque");
    expect(
      await root
        .getByRole("article", { name: "es locale health" })
        .getByRole("group", { name: "1 draft" })
        .locator(".crate-mono-label")
        .evaluate((e) => getComputedStyle(e).fontFamily),
    ).toContain("JetBrains");
    expect(
      await root
        .locator("p")
        .first()
        .evaluate((e) => getComputedStyle(e).fontFamily),
    ).toContain("Roboto");
    await root
      .getByRole("tab", { name: "Bundles", exact: true })
      .press("Enter");
    await root.getByRole("combobox", { name: "Locale", exact: true }).click();
    await page.getByRole("option", { name: "fr", exact: true }).click();
    await expect(
      root.getByRole("button", { name: "Review es", exact: true }),
    ).toHaveCount(0);
    await root.getByRole("combobox", { name: "Locale", exact: true }).click();
    await page
      .getByRole("option", { name: "All locales", exact: true })
      .click();
    for (const field of await root.locator(".crate-form-field").all())
      expect(
        await field.evaluate((e) => {
          const [l, v] = Array.from(e.children);
          return (
            v!.getBoundingClientRect().top - l!.getBoundingClientRect().bottom
          );
        }),
      ).toBe(8);
    await root.getByRole("button", { name: "Review es", exact: true }).click();
    await expect(
      root.getByRole("textbox", { name: "Translation for player.play" }),
    ).toBeVisible();
    for (const field of await root.locator(".crate-form-field").all())
      expect(
        await field.evaluate((e) => {
          const [l, v] = Array.from(e.children);
          return (
            v!.getBoundingClientRect().top - l!.getBoundingClientRect().bottom
          );
        }),
      ).toBe(8);
    for (const b of await root.getByRole("button").all())
      expect(
        await b.evaluate((e) => e.getBoundingClientRect().height),
      ).toBeGreaterThanOrEqual(44);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(root.locator("svg")).toHaveCount(1);
    await expect(
      root.locator('svg[data-admin-ux="header-refresh"]'),
    ).toHaveCount(1);
    await root
      .getByRole("textbox", { name: "Translation for player.play" })
      .fill("Dale");
    await root
      .getByRole("button", { name: "Save player.play", exact: true })
      .click();
    await expect(
      root.locator('[data-admin-ux="translations-save"]'),
    ).toBeVisible();
    await finish(page).click();
    await expect(
      root.getByRole("button", { name: "Save player.play", exact: true }),
    ).toBeEnabled();
    await root
      .getByRole("button", { name: "Publish bundle", exact: true })
      .click();
    await expect(
      root.locator('[data-admin-ux="translations-publish"]'),
    ).toBeVisible();
    await finish(page).click();
    await expect(
      root.getByRole("button", { name: "Publish bundle", exact: true }),
    ).toBeDisabled();
    await root
      .getByRole("button", { name: "Export JSON", exact: true })
      .click();
    await finish(page).click();
    await expect(root.locator("pre")).toContainText('"player.play": "Dale"');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(unexpected).toEqual([]);
    expect(errors).toEqual([]);
  });
test("Translations local draft, reject, workspace simulation, loading/empty/no-AI and failure", async ({
  page,
}) => {
  const { root, unexpected, errors } = await open(page);
  await root
    .getByRole("button", { name: "Draft missing/stale with AI for es" })
    .click();
  await expect(
    root.locator('[data-admin-ux="translations-draft"]'),
  ).toBeVisible();
  await finish(page).click();
  await page
    .getByRole("checkbox", { name: "Catálogo JSON de muestra disponible" })
    .check();
  await editor(page);
  await root
    .getByRole("button", {
      name: "Save player.play to workspace JSON",
      exact: true,
    })
    .click();
  await expect(
    root.locator('[data-admin-ux="translations-workspace-save"]'),
  ).toBeVisible();
  await finish(page).click();
  await expect(
    root.getByRole("button", {
      name: "Save player.play to workspace JSON",
      exact: true,
    }),
  ).toBeEnabled();
  await page
    .getByRole("checkbox", { name: "Fallar la siguiente acción" })
    .check();
  await root
    .getByRole("button", { name: "Reject bundle", exact: true })
    .click();
  await expect(
    root.locator('[data-admin-ux="translations-reject"]'),
  ).toBeVisible();
  await finish(page).click();
  await expect(
    page.getByText("Failed to reject translation bundle", { exact: true }),
  ).toBeVisible();
  await expect(
    root.getByRole("button", { name: "Reject bundle", exact: true }),
  ).toBeEnabled();
  await root
    .getByRole("button", { name: "Reject bundle", exact: true })
    .click();
  await finish(page).click();
  await expect(
    root.getByRole("button", { name: "Reject bundle", exact: true }),
  ).toBeDisabled();
  await page.getByRole("radio", { name: "Cargando", exact: true }).click();
  await expect(
    root.getByRole("status", { name: "Loading translations" }),
  ).toBeVisible();
  await finish(page).click();
  await expect(
    root.getByRole("article", { name: "es locale health" }),
  ).toBeVisible();
  await page.getByRole("radio", { name: "Sin IA", exact: true }).click();
  await expect(
    root.getByRole("button", { name: "Draft missing/stale with AI for es" }),
  ).toBeDisabled();
  await page.getByRole("radio", { name: "Vacío", exact: true }).click();
  await root.getByRole("tab", { name: "Bundles", exact: true }).click();
  await expect(
    root.getByText("No bundles match filters", { exact: true }),
  ).toBeVisible();
  await root.getByRole("tab", { name: "Editor", exact: true }).click();
  await expect(
    root.getByText("Select a bundle to review", { exact: true }),
  ).toBeVisible();
  await expect(root.locator("svg")).toHaveCount(1);
  await expect(root.locator('svg[data-admin-ux="header-refresh"]')).toHaveCount(
    1,
  );
  expect(unexpected).toEqual([]);
  expect(errors).toEqual([]);
});
test("Translations persistent checkpoint keeps published Users and prior checkpoints", async ({
  page,
}) => {
  await page.goto("/#traducciones-admin");
  await expect(
    page.getByRole("region", {
      name: "Checkpoint 1AN, Translations de Admin",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page
      .frameLocator('iframe[title="Translations real con datos de muestra"]')
      .getByRole("heading", { name: "Listen Translations", exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("footer")).toContainText("1AM publicado");
  await expect(page.locator("footer")).toContainText("1AN publicado");
  await expect(
    page.locator('iframe[src="./admin-users-demo.html"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('iframe[src="./admin-timeline-demo.html"]'),
  ).toHaveCount(0);
});

test("French specimen counter matches its real editor rows", async ({
  page,
}) => {
  const { root, unexpected, errors } = await open(page);
  await root.getByRole("tab", { name: "Bundles", exact: true }).click();
  await expect(
    root.getByRole("button", { name: "Review fr", exact: true }),
  ).toContainText("1 strings");
  await root.getByRole("button", { name: "Review fr", exact: true }).click();
  await expect(
    root.getByRole("textbox", { name: "Translation for player.play" }),
  ).toHaveValue("Lire");
  await expect(root.getByRole("textbox")).toHaveCount(1);
  expect(unexpected).toEqual([]);
  expect(errors).toEqual([]);
});
