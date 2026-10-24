import { expect, test } from "./fixtures";

const longTitle =
  "A Small Collection of Unreasonably Long Album Titles (Complete Expanded Edition)";
const album = {
  id: 68,
  entity_uid: null,
  slug: "crystallize",
  title: longTitle,
  artist: "Quicksand",
  artist_slug: "quicksand",
  year: "2024",
  has_cover: false,
  tracks: 12,
  played_tracks: 4,
  minutes: 35,
  last_day: "2026-10-22",
};
const category = {
  key: "post-hardcore",
  label: "post-hardcore",
  genre_slug: "post-hardcore",
  tracks: 40,
  albums: 4,
  played_tracks: 4,
  plays: 7,
  minutes: 35,
  catalogue_share: 4,
  listening_share: 12,
  previous_listening_share: 8,
  examples: [album],
};
const report = {
  ready: true,
  window: "30d",
  period: {
    start: "2026-09-25",
    end: "2026-10-24",
    previous_start: "2026-08-26",
    previous_end: "2026-09-24",
    history_start: "2026-04-06",
    calendar: "listener_local_days",
    previous_complete: true,
    history_complete: true,
  },
  catalogue: { tracks: 1000, albums: 100 },
  current: {
    plays: 70,
    minutes: 350,
    tracks: 48,
    albums: 8,
    concentration_pct: 42,
  },
  previous: {
    plays: 60,
    minutes: 300,
    tracks: 40,
    albums: 7,
    concentration_pct: 50,
  },
  excluded: { plays: 2, minutes: 5 },
  timeline: Array.from({ length: 30 }, (_, i) => ({
    day: new Date(Date.UTC(2026, 8, 25 + i)).toISOString().slice(0, 10),
    minutes: i === 5 ? 60 : i,
    previous_minutes: i === 9 ? 45 : i / 2,
  })),
  genres: [
    category,
    {
      ...category,
      key: "ambient",
      label: "ambient",
      genre_slug: "ambient",
      catalogue_share: 12,
      listening_share: 2,
    },
    ...Array.from({ length: 23 }, (_, i) => ({
      ...category,
      key: `genre-${i}`,
      label: `Genre ${i}`,
      genre_slug: `genre-${i}`,
      catalogue_share: 1,
      listening_share: 2,
    })),
  ],
  decades: [{ ...category, key: "2020", label: "2020s", genre_slug: null }],
  rising: [
    {
      id: 23,
      entity_uid: null,
      slug: "quicksand",
      name: "Quicksand",
      has_photo: false,
      current_minutes: 60,
      previous_minutes: 30,
      delta_minutes: 30,
    },
  ],
  falling: [
    {
      id: 24,
      entity_uid: null,
      slug: "other-artist",
      name: "Other artist",
      has_photo: false,
      current_minutes: 10,
      previous_minutes: 30,
      delta_minutes: -20,
    },
  ],
  unheard: {
    total: 30,
    items: [{ ...album, id: 69, played_tracks: 0, minutes: 0, last_day: null }],
  },
  rediscover: {
    total: 10,
    items: [{ ...album, id: 71, last_day: "2026-04-10" }],
  },
  improvements: [
    { key: "full", tracks: 4, minutes: 35, albums: [album] },
    { key: "bliss", tracks: 0, minutes: 0, albums: [] },
  ],
  snapshot: {
    scope: "admin:collection-insights",
    subject_key: "v1:30d",
    version: 1,
    built_at: "2026-10-24T18:00:00Z",
    stale_after: "2099-01-01T00:00:00Z",
    stale: false,
  },
};

for (const width of [1440, 390, 320]) {
  test.describe(`Insights ${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, hasTouch: width < 768 });
    test("collection readings, graph selection and entity links remain usable", async ({
      adminApi,
      openAdminPage,
      page,
    }) => {
      adminApi.respondTo("/api/admin/agent-plans/summary", {
        awaiting_approval: 0,
      });
      adminApi.respondTo("/api/capabilities", {
        smart_mix: { available: true },
      });
      adminApi.respondTo("/api/admin/collection-insights", report);
      await openAdminPage("/insights");
      await expect(
        page.getByRole("heading", { name: "Insights", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("group", { name: "Catalogue reach", exact: true }),
      ).toContainText("4.8%");
      const columns = await page
        .locator('section[aria-label="Collection listening summary"] > div')
        .first()
        .evaluate(
          (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
        );
      expect(columns).toBe(width >= 1024 ? 4 : 2);
      await page.getByRole("button", { name: /Inspect ambient:/ }).click();
      const reading = page.getByRole("group", {
        name: "Selected collection category",
        exact: true,
      });
      await expect(reading).toContainText("ambient");
      await expect(
        page.getByRole("link", { name: "Explore ambient", exact: true }),
      ).toHaveAttribute("href", "/genres?genre=ambient");
      const lastCategory = page.getByRole("button", {
        name: /Inspect Genre 22:/,
      });
      await lastCategory.click();
      await expect(reading).toContainText("Genre 22");
      const scroll = await lastCategory.evaluate((element) => {
        let parent = element.parentElement;
        while (parent && getComputedStyle(parent).overflowY !== "auto")
          parent = parent.parentElement;
        return parent
          ? { top: parent.scrollTop, height: parent.clientHeight }
          : null;
      });
      expect(scroll?.top).toBeGreaterThan(0);
      expect(scroll?.height).toBeLessThanOrEqual(520);
      await page.getByRole("button", { name: "Decades", exact: true }).click();
      await expect(reading).toContainText("2020s");
      const trace = page.getByRole("slider", { name: "Inspect listening day" });
      await trace.focus();
      await trace.press("Home");
      await expect(trace).toHaveAttribute("aria-valuenow", "1");
      await trace.press("ArrowRight");
      await expect(trace).toHaveAttribute("aria-valuetext", /2026-09-26/);
      await expect(
        page.getByRole("link", { name: /Quicksand 60 min/i }),
      ).toHaveAttribute("href", "/artists/quicksand");
      await expect(
        page.getByRole("heading", {
          name: "Improvements with listening impact",
        }),
      ).toBeVisible();
      expect(await page.locator("main [title]").count()).toBe(0);
      const geometry = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        width: window.innerWidth,
      }));
      expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1);
      await page
        .getByRole("heading", { name: "Insights", exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({ path: `/tmp/crate-insights-${width}-oct24.png` });
    });
  });
}
