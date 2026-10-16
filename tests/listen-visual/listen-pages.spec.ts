import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { capturePage } from "../visual/screenshots";

async function expectStablePage(page: Page, name: string) {
  await capturePage(page, test.info(), name);
}

test("renders the home shell with the restored player", async ({
  openListenPage,
  page,
}) => {
  await openListenPage("/", { player: true });
  await expect(page.getByTestId("hero-result-artist-name")).toHaveText(
    "High Vis",
  );
  await expect(page.getByText("Mob DLA", { exact: true })).toBeVisible();
  await expectStablePage(page, "home-player-default-dark");
});

test("renders the Smart EQ curve and source chain", async ({
  openListenPage,
  page,
}, info) => {
  await openListenPage("/", { player: true, smartEq: true });
  if (info.project.name === "mobile") {
    await page
      .getByRole("button", { name: "Open fullscreen player", exact: true })
      .click();
  }
  await page.getByRole("button", { name: "Equalizer", exact: true }).click();
  await expect(
    page.locator('[data-source="genre_taxonomy_preset"][aria-current="true"]'),
  ).toBeVisible();
  await expect(page.getByText("from Rock", { exact: true })).toBeVisible();
  await expect(page.getByRole("slider", { name: / Hz$/ })).toHaveCount(10);
  await expectStablePage(page, "equalizer-smart-default-dark");
});

test("renders the complete artist hero and follow controls", async ({
  openListenPage,
  page,
}) => {
  await openListenPage("/artists/high-vis");
  await expect(page.getByRole("heading", { name: "High Vis" })).toBeVisible();
  await expect(page.getByText("Top Tracks")).toBeVisible();
  await expectStablePage(page, "artist-default-dark");
});

test("renders genre cards and badges from the real Explore route", async ({
  openListenPage,
  page,
}) => {
  await openListenPage("/explore?genre=hardcore");
  await expect(page.getByRole("heading", { name: "hardcore" })).toBeVisible();
  await expect(page.getByText("High Vis", { exact: true })).toBeVisible();
  await expectStablePage(page, "genre-default-dark");
});

for (const interaction of ["click", "Enter"] as const) {
  test(`navigates from an artist card with ${interaction}`, async ({
    openListenPage,
    page,
  }) => {
    await openListenPage("/explore?genre=hardcore");
    const target = page.getByRole("link", { name: "Open High Vis" });

    if (interaction === "click") {
      const bounds = await target.boundingBox();
      expect(bounds).not.toBeNull();
      await target.click({
        position: { x: 10, y: Math.max(1, (bounds?.height ?? 1) - 10) },
      });
    } else {
      await target.press(interaction);
    }

    await expect(page).toHaveURL(/\/artists\/high-vis$/);
    await expect(page.getByRole("heading", { name: "High Vis" })).toBeVisible();
  });
}

test("does not navigate from an artist card with Space", async ({
  openListenPage,
  page,
}) => {
  await openListenPage("/explore?genre=hardcore");
  const target = page.getByRole("link", { name: "Open High Vis" });

  await target.press("Space");

  await expect(page).toHaveURL(/\/explore\?genre=hardcore$/);
});

test("keeps artist card actions from triggering navigation", async ({
  openListenPage,
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Inline actions need hover");
  await openListenPage("/explore?genre=hardcore");
  const target = page.getByRole("link", { name: "Open High Vis" });
  const card = target.locator("..");

  await card.hover();
  const unfollow = card.getByRole("button", { name: "Unfollow High Vis" });
  await expect(unfollow).toBeVisible();
  await unfollow.click();
  await expect(page).toHaveURL(/\/explore\?genre=hardcore$/);
  await expect(
    card.getByRole("button", { name: "Follow High Vis" }),
  ).toBeVisible();

  await card.hover();
  await card
    .getByRole("button", { name: "Play top tracks from High Vis" })
    .click();
  await expect(page).toHaveURL(/\/explore\?genre=hardcore$/);
  await expect(page.getByText("Mob DLA", { exact: true })).toBeVisible();
});

test("renders Radar release and show rows", async ({
  openListenPage,
  page,
}) => {
  await openListenPage("/upcoming");
  await expect(page.getByRole("heading", { name: "Radar" })).toBeVisible();
  await expect(
    page.getByText("Electric Ballroom", { exact: true }),
  ).toBeVisible();
  await expectStablePage(page, "radar-default-dark");
});

test("renders the Stats signal page", async ({ openListenPage, page }) => {
  await openListenPage("/stats");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "30 days of signal",
  );
  await expect(
    page.getByRole("group", { name: /of listening across 30 bars/ }),
  ).toBeVisible();
  await expectStablePage(page, "stats-default-dark");
});

async function expectFixedCrateIdentity(page: Page) {
  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-crate-identity", "v3");
  await expect(root).toHaveCSS("color-scheme", "dark");
  expect(await root.getAttribute("data-crate-mode")).toBeNull();
  expect(await root.getAttribute("data-crate-skin")).toBeNull();
  await expect
    .poll(() =>
      root.evaluate((element) =>
        getComputedStyle(element).getPropertyValue("--accent-action").trim(),
      ),
    )
    .toBe("#06b6d4");
}

test("renders independent interface preferences without visual theme controls or native selects", async ({
  openListenPage,
  page,
}) => {
  await openListenPage("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expectFixedCrateIdentity(page);
  const preferences = page.getByRole("region", {
    name: "Interface",
    exact: true,
  });
  await expect(preferences).toBeVisible();
  await expect(preferences.getByRole("combobox")).toHaveCount(3);
  for (const name of ["Motion", "Effects", "Content density"]) {
    await expect(
      preferences.getByRole("combobox", { name, exact: true }),
    ).toBeVisible();
  }
  await expect(page.getByText("Visual skin", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Color mode", { exact: true })).toHaveCount(0);
  await expect(page.locator("select")).toHaveCount(0);
  await expectStablePage(page, "settings-default-dark");
});

for (const mode of ["dark", "light", "system"] as const) {
  for (const preset of ["default", "crateRed"] as const) {
    test(`migrates legacy ${preset}/${mode} to the fixed identity and retains functional preferences`, async ({
      openListenPage,
      page,
    }) => {
      await openListenPage("/settings", {
        mode,
        preset,
        preferences: { motion: "reduced", effects: "off", density: "compact" },
      });
      await expectFixedCrateIdentity(page);
      const preferences = page.getByRole("region", {
        name: "Interface",
        exact: true,
      });
      await expect(
        preferences.getByRole("combobox", { name: "Motion", exact: true }),
      ).toHaveText("Reduce motion");
      await expect(
        preferences.getByRole("combobox", { name: "Effects", exact: true }),
      ).toHaveText("Off");
      await expect(
        preferences.getByRole("combobox", {
          name: "Content density",
          exact: true,
        }),
      ).toHaveText("Compact");
      const stored = await page.evaluate(() => ({
        preferences: JSON.parse(
          localStorage.getItem("crate.interface-preferences.v1")!,
        ),
        appearance: localStorage.getItem("crate.listen.appearance.v2"),
        legacy: localStorage.getItem("crate.listen.theme-skin"),
        locale: localStorage.getItem("crate-listen-locale"),
      }));
      expect(stored).toEqual({
        preferences: {
          version: 1,
          motion: "reduced",
          effects: "off",
          density: "compact",
        },
        appearance: null,
        legacy: null,
        locale: "en",
      });
      await page.goto("/artists/high-vis");
      await expect(
        page.getByRole("heading", { name: "High Vis" }),
      ).toBeVisible();
      await expect(page.getByText("Top Tracks")).toBeVisible();
      await expectFixedCrateIdentity(page);
      expect(
        await page.evaluate(() =>
          JSON.parse(localStorage.getItem("crate.interface-preferences.v1")!),
        ),
      ).toEqual(stored.preferences);
      expect(
        await page.evaluate(() =>
          localStorage.getItem("crate.listen.theme-skin"),
        ),
      ).toBeNull();
    });
  }
}
