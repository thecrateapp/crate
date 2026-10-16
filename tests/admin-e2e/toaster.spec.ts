import type { Locator, TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";
import { prepareAdminCapture } from "./screenshots";

async function captureToast(toast: Locator, info: TestInfo) {
  const name = "admin-genre-eq-saved-toast.png";
  if (process.env.CRATE_VISUAL_SMOKE === "1") {
    await toast.screenshot({
      path: info.outputPath(name),
      animations: "disabled",
      caret: "hide",
    });
    return;
  }
  await expect(toast).toHaveScreenshot(name);
}

test("presents the saved genre EQ toast through the shared config", async ({
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
    .filter({ has: page.getByText("Hardcore", { exact: true }) })
    .click();
  const editor = page
    .getByRole("heading", {
      name: "Equalizer preset Hardcore",
      exact: true,
    })
    .locator("../../..");
  const band = editor.getByRole("slider", { name: "1K Hz", exact: true });
  await band.press("PageUp");
  await band.blur();
  await editor
    .getByRole("button", { name: "Save preset", exact: true })
    .click();

  const toaster = page.locator(".crate-toaster[data-sonner-toaster]");
  const toast = toaster.locator(".crate-toast[data-sonner-toast]");
  await expect(toaster).toHaveAttribute("data-x-position", "right");
  await expect(toaster).toHaveAttribute("data-y-position", "bottom");
  await expect(toaster).toHaveAttribute("data-sonner-theme", "dark");
  await expect(toast).toHaveAttribute("data-mounted", "true");
  await expect(toast).toHaveAttribute("data-type", "success");
  await expect(toast).not.toHaveAttribute("data-rich-colors", "true");
  await expect(toast).toHaveAttribute("data-styled", "false");
  await expect(toast.locator(".crate-toast-title")).toHaveText(
    "Saved EQ preset for Hardcore",
  );
  await expect(toast.locator(".crate-toast-title")).toHaveCSS(
    "font-size",
    "14px",
  );
  await expect(toast.locator(".crate-toast-title")).toHaveCSS(
    "font-family",
    /sans-serif/,
  );
  await expect(toast.locator("[data-icon]")).toHaveCount(0);
  await expect(toast.locator("[data-description]")).toHaveCount(0);
  const bounds = await toast.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.width).toBeLessThanOrEqual(380);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(
    page.viewportSize()!.height,
  );
  await captureToast(toast, info);
  await page.addStyleTag({
    content: "[data-sonner-toast] { outline: 0; }",
  });
  await page.keyboard.press("Alt+t");
  await expect(toaster).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(toast).toBeFocused();
  const focusOutline = await toast.evaluate((element) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--focus-ring)";
    element.append(probe);
    const expectedColor = getComputedStyle(probe).color;
    probe.remove();
    const style = getComputedStyle(element);
    return {
      width: style.outlineWidth,
      style: style.outlineStyle,
      color: style.outlineColor,
      expectedColor,
    };
  });
  expect(focusOutline).toMatchObject({
    width: "2px",
    style: "solid",
    color: focusOutline.expectedColor,
  });
  expect(adminApi.calls).toEqual([
    {
      method: "PATCH",
      path: "/api/genres/hardcore/eq-preset",
      body: {
        gains: Array.from({ length: 10 }, (_, index) => (index === 5 ? 3 : 0)),
      },
    },
  ]);
});
