import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";

async function expectStablePage(page: Page, name: string) {
  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: false,
  });
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

test("renders the appearance editor without native selects", async ({
  openListenPage,
  page,
}) => {
  await openListenPage("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByText("Visual skin")).toBeVisible();
  await expect(page.locator("select")).toHaveCount(0);
  await expectStablePage(page, "settings-default-dark");
});

test("renders the default skin in light mode", async ({
  openListenPage,
  page,
}) => {
  await openListenPage("/settings", { mode: "light" });
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "data-crate-mode",
    "light",
  );
  await expectStablePage(page, "settings-default-light");
});

test("renders Crate Red as a complete skin", async ({
  openListenPage,
  page,
}) => {
  await openListenPage("/settings", { preset: "crateRed" });
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "data-crate-skin",
    "crateRed",
  );
  await expectStablePage(page, "settings-crate-red-dark");
});

const richAppearanceVariants = [
  {
    label: "default light",
    mode: "light",
    preset: "default",
    snapshot: "artist-default-light",
  },
  {
    label: "Crate Red dark",
    mode: "dark",
    preset: "crateRed",
    snapshot: "artist-crate-red-dark",
  },
  {
    label: "Crate Red light",
    mode: "light",
    preset: "crateRed",
    snapshot: "artist-crate-red-light",
  },
] as const;

for (const variant of richAppearanceVariants) {
  test(`renders the rich artist surface in ${variant.label}`, async ({
    openListenPage,
    page,
  }) => {
    await openListenPage("/artists/high-vis", {
      mode: variant.mode,
      preset: variant.preset,
    });
    await expect(page.getByRole("heading", { name: "High Vis" })).toBeVisible();
    await expect(page.getByText("Top Tracks")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute(
      "data-crate-mode",
      variant.mode,
    );
    await expect(page.locator("html")).toHaveAttribute(
      "data-crate-skin",
      variant.preset,
    );
    await expectStablePage(page, variant.snapshot);
  });
}
