import { expect, test } from "./fixtures";

const track = (id: number, title: string) => ({
  id,
  entity_uid: `track-${id}`,
  title,
  album_id: 68,
  album_entity_uid: null,
  album:
    "A Small Collection of Unreasonably Long Album Titles (Complete Expanded Edition)",
  album_slug: "crystallize",
  artist: "Quicksand",
  artist_slug: "quicksand",
  year: "2024",
  has_cover: true,
  heard: id === 1,
  plays: id === 1 ? 4 : 0,
  minutes: id === 1 ? 20 : 0,
  bpm: 120,
  bpm_confidence: 0.9,
  energy: 0.4,
  integrated_lufs: -14,
  true_peak_dbfs: -1.2,
  key_camelot: "8A",
  key_confidence: 0.7,
  tempo_stability: 0.8,
  quality: "partial",
  has_bliss: true,
  acousticness: 0.1,
  instrumentalness: 0.8,
  valence: 0.3,
});
const cell = {
  id: "tempo_energy:5:3",
  column: 5,
  row: 3,
  x_min: 100,
  x_max: 120,
  y_min: 0.375,
  y_max: 0.5,
  tracks: 600,
  albums: 60,
  heard_tracks: 8,
  heard_albums: 2,
  plays: 20,
  minutes: 100,
  catalogue_share: 75,
  listening_share: 80,
  examples: [track(1, "Waves"), track(2, "Echoes")],
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
  excluded: { plays: 0, minutes: 0 },
  timeline: [],
  genres: [],
  decades: [],
  rising: [],
  falling: [],
  unheard: { total: 0, items: [] },
  rediscover: { total: 0, items: [] },
  improvements: [],
  snapshot: { built_at: "2026-10-24T18:00:00Z", stale: false },
  sonic: {
    version: 1,
    source: {
      analyzer_version: "analyzer-4",
      profile_version: 3,
      measurement_version: "measure-2",
    },
    planes: [
      {
        key: "tempo_energy",
        x: { label: "Tempo", unit: "BPM", min: 0, max: 200, bins: 10 },
        y: { label: "Smart Mix energy", unit: "", min: 0, max: 1, bins: 8 },
        coverage: {
          catalogue_tracks: 1000,
          paired_tracks: 800,
          heard_tracks: 48,
          paired_heard_tracks: 10,
        },
        cells: [
          cell,
          {
            ...cell,
            id: "tempo_energy:6:4",
            column: 6,
            row: 4,
            x_min: 120,
            x_max: 140,
            y_min: 0.5,
            y_max: 0.625,
            tracks: 200,
            albums: 30,
            heard_tracks: 2,
            heard_albums: 1,
            plays: 2,
            minutes: 10,
            catalogue_share: 25,
            listening_share: 20,
            examples: [track(3, "Tides")],
          },
        ],
      },
      {
        key: "tempo_lufs",
        x: { label: "Tempo", unit: "BPM", min: 0, max: 200, bins: 10 },
        y: {
          label: "Integrated loudness",
          unit: "LUFS",
          min: -30,
          max: 0,
          bins: 8,
        },
        coverage: {
          catalogue_tracks: 1000,
          paired_tracks: 700,
          heard_tracks: 48,
          paired_heard_tracks: 5,
        },
        cells: [
          {
            ...cell,
            id: "tempo_lufs:5:4",
            row: 4,
            y_min: -15,
            y_max: -11.25,
            tracks: 700,
            albums: 80,
            heard_tracks: 5,
            catalogue_share: 100,
            listening_share: 100,
          },
        ],
      },
    ],
  },
};

for (const width of [1440, 390, 320]) {
  test.describe(`Sonic insights ${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, hasTouch: width < 768 });
    test("exact regions, cohort controls and persistent readings work by keyboard and pointer", async ({
      adminApi,
      openAdminPage,
      page,
    }) => {
      adminApi.respondTo("/api/admin/agent-plans/summary", {
        awaiting_approval: 0,
      });
      adminApi.respondTo("/api/capabilities", {
        smart_mix: { available: false },
      });
      adminApi.respondTo("/api/admin/collection-insights", report);
      for (const id of [1, 2, 3])
        adminApi.respondTo(
          `/api/admin/collection-insights/sonic-neighbors/${id}`,
          {
            seed_track_id: id,
            available: true,
            items: [{ track: track(4, "Nearby sound"), distance: 0.138 }],
          },
        );
      const neighborRequests: string[] = [];
      page.on("request", (request) => {
        if (request.url().includes("/sonic-neighbors/"))
          neighborRequests.push(request.url());
      });
      await openAdminPage("/insights");
      await expect(
        page.getByRole("tab", { name: "Listening", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      expect(neighborRequests).toHaveLength(0);
      await page
        .getByRole("tab", { name: "Sonic explorer", exact: true })
        .click();
      const sonic = page.getByRole("region", {
        name: "Sonic explorer",
        exact: true,
      });
      await sonic.scrollIntoViewIfNeeded();
      await expect(
        sonic.getByRole("group", { name: "Sonic measurement coverage" }),
      ).toContainText("800 / 1,000 indexed tracks");
      await expect(
        sonic.getByRole("group", { name: "Sonic measurement coverage" }),
      ).toContainText("10 / 48 heard tracks");
      const map = sonic.getByRole("slider", { name: "Inspect sonic region" });
      await expect(map).toHaveAttribute("aria-valuetext", /0.375–0.5/);
      await map.focus();
      await map.press("End");
      await expect(map).toHaveAttribute("aria-valuenow", "2");
      await expect(
        sonic.getByRole("button", { name: "Inspect Tides by Quicksand" }),
      ).toHaveAttribute("aria-pressed", "true");
      await map.press("Home");
      await map.scrollIntoViewIfNeeded();
      const bounds = await map.boundingBox();
      expect(bounds).not.toBeNull();
      const point = {
        x: 42 + (bounds!.width - 54) * 0.65,
        y: 16 + (bounds!.height - 60) * (1 - 4.5 / 8),
      };
      if (width < 768) await map.tap({ position: point });
      else await map.click({ position: point });
      await expect(map).toHaveAttribute("aria-valuenow", "2");
      await sonic
        .getByRole("radio", { name: "Heard tracks", exact: true })
        .click();
      await expect(
        sonic.locator('[data-sonic-cohort="catalogue"]'),
      ).toHaveCount(0);
      await expect(
        sonic.locator('[data-sonic-cohort="listening"]'),
      ).toHaveCount(2);
      await sonic
        .getByRole("radio", { name: "Catalogue", exact: true })
        .click();
      await expect(
        sonic.locator('[data-sonic-cohort="listening"]'),
      ).toHaveCount(0);
      await sonic.getByRole("radio", { name: "Tempo × LUFS" }).click();
      await expect(
        sonic.getByRole("group", { name: "Sonic measurement coverage" }),
      ).toContainText("700 / 1,000 indexed tracks");
      await expect(map).toHaveAttribute("aria-valuetext", /-15–-11.25 LUFS/);
      await sonic
        .getByRole("button", { name: "Inspect Echoes by Quicksand" })
        .click();
      const trackReading = sonic.getByRole("group", {
        name: "Selected sonic track",
        exact: true,
      });
      await expect(trackReading).toContainText("Echoes");
      await expect(trackReading).toContainText("120 BPM");
      for (const link of [
        trackReading.getByRole("link", { name: "Open Quicksand" }),
        trackReading.getByRole("link", { name: /^Open A Small Collection/ }),
      ]) {
        await expect(link).toHaveAttribute("data-variant", "secondary");
      }
      const readingHeading = await trackReading
        .getByRole("heading", { name: "Track reading", exact: true })
        .boundingBox();
      const trackTitle = await trackReading
        .getByRole("heading", { name: "Echoes", exact: true })
        .boundingBox();
      expect(
        trackTitle!.y - (readingHeading!.y + readingHeading!.height),
      ).toBeGreaterThanOrEqual(16);
      const nearby = sonic.getByRole("group", { name: "Sound nearby" });
      const nearbyHeading = await nearby
        .getByRole("heading", { name: "Sound nearby", exact: true })
        .boundingBox();
      const nearbyCopy = await nearby
        .locator('[data-slot="instrument-panel-description"]')
        .boundingBox();
      expect(
        nearbyCopy!.y - (nearbyHeading!.y + nearbyHeading!.height),
      ).toBeGreaterThanOrEqual(16);
      const nearbyRow = await nearby
        .getByRole("link", { name: /Nearby sound/ })
        .boundingBox();
      expect(
        nearbyRow!.y - (nearbyCopy!.y + nearbyCopy!.height),
      ).toBeGreaterThanOrEqual(16);
      await expect(
        trackReading.getByRole("link", { name: "Open Quicksand" }),
      ).toHaveAttribute("href", "/artists/quicksand");
      await expect(
        trackReading.getByRole("link", { name: /^Open A Small Collection/ }),
      ).toHaveAttribute(
        "href",
        "/artists/quicksand/a-small-collection-of-unreasonably-long-album-titles-complete-expanded-edition",
      );
      await expect(
        sonic.getByRole("group", { name: "Sound nearby" }),
      ).toContainText("Cosine distance 0.138");
      await expect(
        sonic.getByRole("group", { name: "Sound nearby" }),
      ).toContainText("not mixing compatibility");
      await page.getByRole("tab", { name: "Listening", exact: true }).click();
      await expect(
        page.getByRole("region", { name: "Sonic explorer", exact: true }),
      ).toHaveCount(0);
      await page
        .getByRole("tab", { name: "Sonic explorer", exact: true })
        .click();
      await expect(
        sonic.getByRole("radio", { name: "Tempo × LUFS" }),
      ).toHaveAttribute("aria-checked", "true");
      await expect(trackReading).toContainText("Echoes");
      expect(await page.locator("main [title]").count()).toBe(0);
      const geometry = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        width: window.innerWidth,
      }));
      expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1);
      await sonic
        .getByRole("heading", { name: "Sonic explorer", exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `/tmp/crate-sonic-insights-${width}-oct24.png`,
      });
    });
  });
}

test("nearby sound exposes retry and an unavailable vector without an empty success claim", async ({
  adminApi,
  openAdminPage,
  page,
}) => {
  adminApi.respondTo("/api/admin/agent-plans/summary", {
    awaiting_approval: 0,
  });
  adminApi.respondTo("/api/capabilities", { smart_mix: { available: false } });
  adminApi.respondTo("/api/admin/collection-insights", report);
  const path = "/api/admin/collection-insights/sonic-neighbors/1";
  adminApi.respondTo(path, { seed_track_id: 999, available: true, items: [] });
  await openAdminPage("/insights");
  await page.getByRole("tab", { name: "Sonic explorer", exact: true }).click();
  await expect(
    page.getByText("Nearby sound could not be loaded."),
  ).toBeVisible();
  adminApi.respondTo(path, { seed_track_id: 1, available: false, items: [] });
  await page.getByRole("button", { name: "Retry nearby sound" }).click();
  await expect(
    page.getByText("No valid stored Bliss vector for this track."),
  ).toBeVisible();
  await expect(page.getByText("No eligible nearby tracks found.")).toHaveCount(
    0,
  );
});

test("changing the pinned example rejects a late nearby-sound response", async ({
  adminApi,
  openAdminPage,
  page,
}) => {
  adminApi.respondTo("/api/admin/agent-plans/summary", {
    awaiting_approval: 0,
  });
  adminApi.respondTo("/api/capabilities", { smart_mix: { available: false } });
  adminApi.respondTo("/api/admin/collection-insights", report);
  adminApi.respondTo("/api/admin/collection-insights/sonic-neighbors/1", {
    seed_track_id: 1,
    available: true,
    items: [],
  });
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    "**/api/admin/collection-insights/sonic-neighbors/2?**",
    async (route) => {
      await waiting;
      await route.fulfill({
        json: {
          seed_track_id: 2,
          available: true,
          items: [{ track: track(9, "Obsolete nearby track"), distance: 0.1 }],
        },
      });
    },
  );
  await openAdminPage("/insights");
  await page.getByRole("tab", { name: "Sonic explorer", exact: true }).click();
  await page
    .getByRole("button", { name: "Inspect Echoes by Quicksand" })
    .click();
  await expect(page.getByText("Loading nearby sound…")).toBeVisible();
  await page
    .getByRole("button", { name: "Inspect Waves by Quicksand" })
    .click();
  release();
  await expect(
    page.getByText("No eligible nearby tracks found."),
  ).toBeVisible();
  await expect(page.getByText("Obsolete nearby track")).toHaveCount(0);
});
