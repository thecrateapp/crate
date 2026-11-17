import { expect, test } from "@playwright/test";

// The tour is cratemusic.app's chaptered screencast fed with Ryoku's clips. The
// clips live on the host's media mount, so nothing here waits for them to load.
const CHAPTERS = ["01 Music", "02 Bar", "03 Panels", "04 Rashin", "05 Desktop"];
const IDS = ["music", "bar", "panels", "rashin", "desktop"];

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("the tour section follows the hero under its own heading", async ({
  page,
}) => {
  const tour = page.locator("#tour");
  await expect(tour).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "Ninety seconds on Crate for Ryoku." }),
  ).toHaveAttribute("id", "tour-title");
  await expect(tour).toHaveAttribute("aria-labelledby", "tour-title");
  const order = await page
    .locator("main > section")
    .evaluateAll((sections) => sections.map((section) => section.id));
  expect(order.slice(0, 3)).toEqual(["hero", "tour", "crate-ui"]);
  await expect(tour.locator("[data-screencast]")).toHaveAttribute(
    "aria-label",
    "Crate for Ryoku tour",
  );
});

test("the tour has five chapter tabs in order, the first one active", async ({
  page,
}) => {
  const tabs = page.locator("#tour [data-tab]");
  await expect(tabs).toHaveCount(5);
  await expect(tabs).toHaveText(CHAPTERS);
  await expect(tabs.first()).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#tour [data-chapter]")).toHaveCount(5);
  await expect(page.locator("#tour [data-toggle]")).toHaveAttribute(
    "aria-label",
    /^(Play|Pause) the tour$/,
  );
});

test("a chapter tab shows its chapter", async ({ page }) => {
  const tour = page.locator("#tour");
  await tour.getByRole("button", { name: "03 Panels" }).click();
  await expect(tour.getByRole("button", { name: "03 Panels" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(tour.locator('[data-chapter="panels"]')).toHaveAttribute(
    "data-active",
    "",
  );
  await expect(tour.locator('[data-chapter="music"]')).not.toHaveAttribute(
    "data-active",
  );
});

test("every chapter plays from the host's media mount", async ({ page }) => {
  for (const id of IDS) {
    const video = page.locator(`#tour [data-chapter="${id}"] video`);
    await expect(video).toHaveAttribute(
      "poster",
      new RegExp(`^/media/tour/${id}\\.jpg\\?v=`),
    );
    const sources = await video
      .locator("source")
      .evaluateAll((nodes) =>
        nodes.map((node) => [
          node.getAttribute("src"),
          node.getAttribute("type"),
        ]),
      );
    expect(sources).toHaveLength(2);
    for (const [src, type] of sources) {
      expect(src).toMatch(new RegExp(`^/media/tour/${id}\\.(webm|mp4)\\?v=`));
      expect(type).toBe(src?.includes(".webm") ? "video/webm" : "video/mp4");
    }
  }
});

test("the bar links to the tour", async ({ page }) => {
  const anchors = page.locator('.nav .links a[href^="#"]');
  const hrefs = await anchors.evaluateAll((links) =>
    links.map((link) => link.getAttribute("href")),
  );
  expect(hrefs.slice(0, 2)).toEqual(["#screenshots", "#tour"]);
  await expect(
    page.locator('.nav .links a[href="#tour"]', { hasText: "Tour" }),
  ).toHaveCount(1);
});

test("the chapter tabs scramble their titles like the bar's links", async ({
  page,
}) => {
  await page.goto("/");
  const titles = page.locator("#tour [data-tab] [data-hover-scramble]");
  await expect(titles).toHaveText([
    "Music",
    "Bar",
    "Panels",
    "Rashin",
    "Desktop",
  ]);
  await expect(page.locator("#tour [data-tab] b").first()).toHaveText("01");
});
