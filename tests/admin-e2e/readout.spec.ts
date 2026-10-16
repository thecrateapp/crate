import type { Locator, TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";
import { prepareAdminCapture } from "./screenshots";

async function captureEditor(editor: Locator, info: TestInfo) {
  const name = "admin-genre-eq-readout.png";
  if (process.env.CRATE_VISUAL_SMOKE === "1") {
    await editor.screenshot({
      path: info.outputPath(name),
      animations: "disabled",
      caret: "hide",
    });
    return;
  }
  await expect(editor).toHaveScreenshot(name);
}

test("announces committed genre EQ changes without writing to the API", async ({
  adminApi,
  openAdminPage,
  page,
}, info) => {
  await prepareAdminCapture(page);
  adminApi.respondTo("/api/genres/taxonomy/tree", {
    top_level_slugs: ["hardcore"],
    nodes: [
      {
        slug: "hardcore",
        name: "Hardcore",
        description: "Urgent guitars and direct rhythms.",
        musicbrainz_mbid: null,
        wikidata_url: null,
        top_level: true,
        parent_slugs: [],
        children_slugs: [],
        related_slugs: [],
        influenced_by_slugs: [],
        influences_slugs: [],
        fusion_of_slugs: [],
        fusion_genre_slugs: [],
        alias_names: [],
        artist_count: 12,
        album_count: 25,
        eq_gains: Array.from({ length: 10 }, () => 0),
        eq_preset_source: "direct",
        eq_preset_inherited_from: null,
      },
    ],
  });
  await openAdminPage("/genres");
  await page.getByRole("button", { name: "Tree view", exact: true }).click();
  await page
    .getByRole("button")
    .filter({
      has: page.getByText("Hardcore", { exact: true }),
    })
    .click();

  const editor = page
    .getByRole("heading", {
      name: "Equalizer preset Hardcore",
      exact: true,
    })
    .locator("../../..");
  await expect(editor).toBeVisible();
  const status = editor.getByRole("status");
  const initialStatus = await status.elementHandle();
  await expect(status).toHaveText("In sync with database");
  await expect(editor.locator(".crate-readout")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await expect(
    editor.getByRole("button", { name: "Save preset", exact: true }),
  ).toBeDisabled();
  await editor.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  await captureEditor(editor, info);

  const band = editor.getByRole("slider", { name: "1K Hz", exact: true });
  await band.press("PageUp");
  await band.blur();
  await expect(band).toHaveAttribute("aria-valuenow", "3");
  await expect(status).toHaveText("Unsaved changes");
  await expect(
    editor.getByRole("button", { name: "Save preset", exact: true }),
  ).toBeEnabled();
  expect(
    await status.evaluate((node, initial) => node === initial, initialStatus),
  ).toBe(true);

  await editor
    .getByRole("button", { name: "Reset sliders to flat", exact: true })
    .click();
  await expect(band).toHaveAttribute("aria-valuenow", "0");
  await expect(status).toHaveText("In sync with database");
  await expect(
    editor.getByRole("button", { name: "Save preset", exact: true }),
  ).toBeDisabled();
  expect(
    await status.evaluate((node, initial) => node === initial, initialStatus),
  ).toBe(true);
  expect(
    adminApi.calls,
    "Editing and resetting the local curve does not mutate the API",
  ).toEqual([]);
});
