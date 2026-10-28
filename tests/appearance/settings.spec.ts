import { expect, test, type Page } from "@playwright/test";
import { openAppearanceHarness } from "./fixtures";

const preferencesKey = "crate.interface-preferences.v1";
const obsoleteKeys = [
  "crate.listen.appearance.v2",
  "crate.listen.theme-skin",
  "crate.listen.theme-skin.backup.v1",
  "crate.listen.appearance.corrupt-backup",
];
const functionalPreferences = {
  version: 1,
  motion: "reduced",
  density: "compact",
  effects: "off",
};

async function seed(page: Page, entries: Record<string, string>) {
  await page.addInitScript((values) => {
    if (sessionStorage.getItem("identity-migration-seeded")) return;
    sessionStorage.setItem("identity-migration-seeded", "true");
    for (const [key, value] of Object.entries(values))
      localStorage.setItem(key, value);
  }, entries);
}

async function expectFixedIdentity(page: Page) {
  await expect(page.locator("html")).toHaveAttribute(
    "data-crate-identity",
    "v3",
  );
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  await expect(page.getByTestId("appearance-card")).toHaveCSS(
    "background-color",
    "rgb(13, 14, 20)",
  );
  await expect(page.getByTestId("accent-button")).toHaveCSS(
    "background-color",
    "rgb(6, 182, 212)",
  );
}

for (const mode of ["dark", "light", "system"]) {
  for (const preset of ["default", "crateRed", "aurora"]) {
    test(`migrates ${mode}/${preset} and overrides while preserving functional settings`, async ({
      page,
    }) => {
      await seed(page, {
        "crate.listen.appearance.v2": JSON.stringify({
          version: 2,
          mode,
          preset,
          overrides: {
            accent: "violet",
            surfaceTone: "warm",
            material: "glass",
            radius: "rounded",
            typography: "system",
            effects: "off",
          },
          presentation: { density: "compact" },
          accessibility: { motion: "reduced" },
        }),
        "crate.listen.theme-skin": JSON.stringify({ mode, skin: preset }),
        "crate.listen.theme-skin.backup.v1": "legacy backup",
        "crate.listen.appearance.corrupt-backup": "corrupt backup",
        "crate-listen-locale": "es",
        "listen-viz-use-album-palette": "true",
      });
      await openAppearanceHarness(page);
      await expectFixedIdentity(page);
      await expect(page.getByTestId("motion-select")).toHaveValue("reduced");
      await expect(page.getByTestId("density-select")).toHaveValue("compact");
      await expect(page.getByTestId("effects-select")).toHaveValue("off");
      await expect(page.getByTestId("logo")).toHaveAttribute(
        "data-crate-logo-effects",
        "off",
      );
      const stored = await page.evaluate(
        ({ key, obsolete }) => ({
          preferences: JSON.parse(localStorage.getItem(key)!),
          old: obsolete.map((name) => localStorage.getItem(name)),
          locale: localStorage.getItem("crate-listen-locale"),
          albumPalette: localStorage.getItem("listen-viz-use-album-palette"),
        }),
        { key: preferencesKey, obsolete: obsoleteKeys },
      );
      expect(stored).toEqual({
        preferences: functionalPreferences,
        old: [null, null, null, null],
        locale: "es",
        albumPalette: "true",
      });
      await page.reload();
      await expectFixedIdentity(page);
      expect(
        await page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key)!),
          preferencesKey,
        ),
      ).toEqual(functionalPreferences);
    });
  }
}

for (const mode of ["dark", "light", "system"]) {
  test(`ignores a legacy v1 ${mode}/aurora identity`, async ({ page }) => {
    await seed(page, {
      "crate.listen.theme-skin": JSON.stringify({
        theme: mode,
        skin: "aurora",
      }),
    });
    await openAppearanceHarness(page);
    await expectFixedIdentity(page);
    await expect(page.getByTestId("motion-select")).toHaveValue("system");
    await expect(page.getByTestId("density-select")).toHaveValue("comfortable");
    expect(
      await page.evaluate(() =>
        localStorage.getItem("crate.listen.theme-skin"),
      ),
    ).toBeNull();
  });
}

for (const [name, raw] of [
  ["malformed JSON", "{"],
  ["non-object", "null"],
  [
    "invalid fields",
    JSON.stringify({
      version: 2,
      mode: "unknown",
      preset: "unknown",
      overrides: { effects: "unsafe" },
      presentation: { density: "huge" },
      accessibility: { motion: "always" },
    }),
  ],
]) {
  test(`boots safely with ${name} legacy preferences`, async ({ page }) => {
    await seed(page, { "crate.listen.appearance.v2": raw });
    await openAppearanceHarness(page);
    await expectFixedIdentity(page);
    await expect(page.getByTestId("motion-select")).toHaveValue("system");
    await expect(page.getByTestId("density-select")).toHaveValue("comfortable");
    await expect(page.getByTestId("effects-select")).toHaveValue("subtle");
  });
}

test("prefers the new functional store to conflicting legacy settings", async ({
  page,
}) => {
  const current = {
    version: 1,
    motion: "system",
    density: "comfortable",
    effects: "expressive",
  };
  await seed(page, {
    [preferencesKey]: JSON.stringify(current),
    "crate.listen.appearance.v2": JSON.stringify({
      version: 2,
      accessibility: { motion: "reduced" },
      presentation: { density: "compact" },
      overrides: { effects: "off" },
    }),
  });
  await openAppearanceHarness(page);
  await expectFixedIdentity(page);
  await expect(page.getByTestId("effects-select")).toHaveValue("expressive");
  await expect(page.getByTestId("motion-select")).toHaveValue("system");
  await expect(page.getByTestId("density-select")).toHaveValue("comfortable");
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!),
      preferencesKey,
    ),
  ).toEqual(current);
});

test("protects a future primary preference version from writes and cleanup", async ({
  page,
}) => {
  const future = JSON.stringify({ version: 99, custom: "retain" });
  const legacy = JSON.stringify({ mode: "light", skin: "crateRed" });
  await seed(page, {
    [preferencesKey]: future,
    "crate.listen.theme-skin": legacy,
  });
  await openAppearanceHarness(page);
  await expectFixedIdentity(page);
  await page.getByTestId("density-select").selectOption("compact");
  await page.getByTestId("apply-button").click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), preferencesKey),
  ).toBe(future);
  expect(
    await page.evaluate(() => localStorage.getItem("crate.listen.theme-skin")),
  ).toBe(legacy);
});

test("applies and reloads independent motion, density and effects without repainting the identity", async ({
  page,
}) => {
  await openAppearanceHarness(page);
  await page.getByTestId("motion-select").selectOption("reduced");
  await page.getByTestId("effects-select").selectOption("off");
  await page.getByTestId("density-select").selectOption("compact");
  await page.getByTestId("apply-button").click();
  await expectFixedIdentity(page);
  await expect(page.locator("html")).toHaveAttribute(
    "data-crate-motion",
    "reduced",
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-crate-density",
    "compact",
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-crate-effects",
    "off",
  );
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!),
      preferencesKey,
    ),
  ).toEqual(functionalPreferences);
  await page.reload();
  await expect(page.getByTestId("motion-select")).toHaveValue("reduced");
  await expect(page.getByTestId("density-select")).toHaveValue("compact");
  await expect(page.getByTestId("effects-select")).toHaveValue("off");
});

test("Cancel discards only the unsaved functional draft", async ({ page }) => {
  await openAppearanceHarness(page);
  await page.getByTestId("motion-select").selectOption("reduced");
  await page.getByTestId("density-select").selectOption("compact");
  await page.getByTestId("cancel-button").click();
  await expect(page.getByTestId("motion-select")).toHaveValue("system");
  await expect(page.getByTestId("density-select")).toHaveValue("comfortable");
  await expectFixedIdentity(page);
});
