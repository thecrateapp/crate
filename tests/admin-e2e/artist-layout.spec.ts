import { expect, test } from "./fixtures";

const laterTitle =
  "Later (The Complete 2020 Sessions and Unabridged Expanded Remastered Edition)";
const dominantGenre = "experimental electroacoustic post-industrial";
const trackAnalysis = {
  first: {
    track_id: 1,
    tempo: 90,
    smart_mix: { is_current_full_profile: true },
    bliss: { available: true },
  },
  second: {
    track_id: 2,
    tempo: 120,
    smart_mix: { quality: "full", is_current_full_profile: false },
    bliss: { available: true },
  },
  third: {
    track_id: 3,
    tempo: 150,
    smart_mix: { is_current_full_profile: true },
    bliss: { available: false },
  },
  fourth: {
    track_id: 4,
    tempo: 0,
    smart_mix: null,
    bliss: { available: false },
  },
  alias: {
    track_id: 1,
    tempo: 90,
    smart_mix: { is_current_full_profile: true },
    bliss: { available: true },
  },
};

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, hasTouch: viewport.width < 768 });
    test("artist tabs keep their shared header and content geometry", async ({
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
      adminApi.respondTo("/api/artists/23/analysis-data", trackAnalysis);
      adminApi.respondTo("/api/artist-slugs/quicksand", {
        id: 23,
        slug: "quicksand",
        name: "Quicksand",
        albums: [],
        genres: [],
        total_tracks: 20,
        genre_profile: [
          { name: "dark ambient", weight: 0.1 },
          { name: dominantGenre, weight: 0.9 },
        ],
        total_size_mb: 0,
        issue_count: 0,
      });
      adminApi.respondTo("/api/artists/23/enrichment", {
        lastfm: {
          bio: "Artist biography for the layout regression.",
          listeners: 6000,
        },
      });
      adminApi.respondTo("/api/artists/23/top-tracks", []);
      adminApi.respondTo("/api/artists/23/shows", {
        events: [
          {
            id: "show-fixture",
            name: "Fixture concert",
            date: "2026-11-10",
            local_date: "2026-11-10",
            venue: "Fixture venue",
            city: "Madrid",
            country: "Spain",
            country_code: "ES",
            region: "",
            url: "https://example.test/tickets",
            image: "",
            lineup: ["Quicksand"],
            status: "onsale",
          },
        ],
        configured: true,
      });
      adminApi.respondTo("/api/artists/23/track-titles", []);
      adminApi.respondTo("/api/artists/23/stats", {
        formats: [
          { id: "FLAC", value: 3 },
          { id: "MP3", value: 1 },
        ],
        albums_timeline: [
          {
            name: "Arrival",
            year: "2000",
            track_count: 4,
            total_duration: 1200,
            popularity: 30,
            lastfm_listeners: 800,
          },
          {
            name: "Arrival",
            year: "2001",
            track_count: 6,
            total_duration: null,
            popularity: 0,
            lastfm_listeners: 1200,
          },
          {
            name: laterTitle,
            year: "2020",
            track_count: 8,
            total_duration: 2400,
            popularity: 70,
            lastfm_listeners: 200,
          },
          {
            name: "Undated",
            year: null,
            track_count: 2,
            popularity: null,
            lastfm_listeners: null,
          },
        ],
        audio_by_album: [
          {
            album: "Arrival",
            avg_bpm: 110,
            avg_energy: 0,
            avg_danceability: 0.2,
            avg_valence: 0.4,
            avg_acousticness: null,
          },
          {
            album: "Arrival",
            avg_bpm: 140,
            avg_energy: 0.8,
            avg_loudness: -9,
            avg_danceability: 0.7,
            avg_valence: 0.5,
            avg_acousticness: 0.1,
          },
          {
            album: "Unanalyzed",
            avg_bpm: null,
            avg_energy: null,
            avg_danceability: null,
            avg_valence: null,
            avg_acousticness: null,
          },
        ],
        top_tracks_by_popularity: [
          {
            title: "Popular song",
            album: "Arrival",
            popularity_score: 0.82,
            popularity: 12,
            lastfm_listeners: 900,
          },
          {
            title: "Zero score",
            album: "Later",
            popularity_score: 0,
            popularity: 90,
            lastfm_listeners: 2000,
          },
        ],
        genres: [{ name: "dark ambient", weight: 0.65 }],
      });
      adminApi.respondTo("/api/artists/23/network", {
        nodes: [
          {
            id: "Quicksand",
            group: 0,
            in_library: true,
            score: 1,
            artist_id: 23,
          },
        ],
        links: [],
      });
      adminApi.respondTo("/api/shows/artists-with-shows", { artists: [] });
      adminApi.respondTo("/api/artwork/artists/23/assets", { assets: [] });
      const heroRecipe = {
        mode: "crop",
        crop: { x: 0, y: 0, width: 1600, height: 1000 },
        position_x: 0.5,
        position_y: 0.5,
        scale: 1,
        flip_horizontal: false,
        rotation: 0,
        blur: 32,
        feather: 28,
        gradient: 0.45,
        grayscale: false,
        brightness: 1,
        contrast: 1,
      };
      adminApi.respondTo("/api/artwork/artists/23/hero-profile", {
        artist_id: 23,
        provenance: "manual",
        review_status: "unreviewed",
        source_width: 1600,
        source_height: 1000,
        desktop_recipe: heroRecipe,
        mobile_recipe: heroRecipe,
        revision: "fixture",
        updated_at: "2026-10-24T12:00:00Z",
      });
      adminApi.respondTo(
        "/api/admin/ai/actions/artwork.hero.analyze/availability",
        { action_id: "artwork.hero.analyze", available: false },
      );
      adminApi.respondTo("/api/artists/23/missing", { missing: [] });
      adminApi.respondTo("/api/tidal/missing/artists/23", {
        albums: [],
        authenticated: false,
      });
      adminApi.respondTo(
        "/api/admin/ai/actions/artists.bio.research/availability",
        {
          action_id: "artists.bio.research",
          available: true,
          status: "configured",
          provider: "fixture",
          model_id: "fixture",
          fingerprint: null,
          error_code: null,
        },
      );
      await page.route(
        /\/api\/artists\/23\/(photo|background|hero)(\?|$)/,
        (route) =>
          route.fulfill({
            contentType: "image/svg+xml",
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#13343d"/></svg>',
          }),
      );
      await page.route("**/api/artwork/artists/23/hero-source*", (route) =>
        route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><rect width="1600" height="1000" fill="#13343d"/></svg>',
        }),
      );
      await openAdminPage("/artists/quicksand");
      const biography = page.getByRole("region", {
        name: "Biography",
        exact: true,
      });
      await expect(
        biography.getByRole("button", {
          name: "Research with AI",
          exact: true,
        }),
      ).toBeVisible();
      const heading = await biography
        .getByRole("heading", { name: "Biography", exact: true })
        .boundingBox();
      const body = await biography
        .getByText("Artist biography for the layout regression.", {
          exact: true,
        })
        .locator("..")
        .boundingBox();
      expect(body!.y - (heading!.y + heading!.height)).toBeGreaterThan(0);
      expect(body!.y - (heading!.y + heading!.height)).toBeLessThanOrEqual(28);
      const actions = page.getByRole("group", {
        name: "Artist actions",
        exact: true,
      });
      expect(
        await actions.evaluate(
          (node) => getComputedStyle(node.parentElement!).borderBottomWidth,
        ),
      ).toBe("0px");
      await page.screenshot({
        path: `/tmp/crate-artist-biography-fixed-${viewport.width}-oct24.png`,
      });

      await page.getByRole("tab", { name: "Discography", exact: true }).click();
      const panel = page.getByRole("tabpanel");
      const empty = panel.getByRole("status", {
        name: "No albums in library",
        exact: true,
      });
      await expect(empty).toBeVisible();
      const emptyBox = await empty.boundingBox();
      const panelBox = await panel.boundingBox();
      expect(emptyBox!.width).toBeGreaterThan(panelBox!.width * 0.95);
      expect(
        await page
          .locator("body")
          .evaluate((node) => node.scrollWidth <= innerWidth),
      ).toBe(true);
      await page.screenshot({
        path: `/tmp/crate-artist-discography-empty-fixed-${viewport.width}-oct24.png`,
      });
      const layout: Array<{
        tab: string;
        top: number;
        height: number;
        bodyGap: number;
        font: string;
      }> = [];
      for (const tab of [
        "Overview",
        "Top Tracks",
        "Discography",
        "Probable Setlist",
        "Shows (1)",
        "Similar Artists",
        "Stats",
        "Artwork",
      ]) {
        await page.getByRole("tab", { name: tab, exact: true }).click();
        const frame = page
          .getByRole("tabpanel")
          .locator('[data-slot="artist-detail-section"]')
          .first();
        await expect(frame).toBeVisible();
        layout.push(
          await frame.evaluate((node, tab) => {
            const panel = node.closest('[role="tabpanel"]')!;
            const header = node.querySelector(
              '[data-slot="artist-detail-header"]',
            )!;
            const body = node.querySelector(
              '[data-slot="artist-detail-body"]',
            )!;
            const label = header.querySelector(".crate-mono-label")!;
            const headerRect = header.getBoundingClientRect();
            const style = getComputedStyle(label);
            return {
              tab,
              top: headerRect.top - panel.getBoundingClientRect().top,
              height: headerRect.height,
              bodyGap: body.getBoundingClientRect().top - headerRect.bottom,
              font: `${style.fontFamily}/${style.fontSize}/${style.lineHeight}/${style.fontWeight}`,
            };
          }, tab),
        );
      }
      for (const item of layout) {
        expect(item.top, `${item.tab} header offset`).toBe(layout[0]!.top);
        expect(item.height, `${item.tab} header height`).toBe(44);
        expect(item.bodyGap, `${item.tab} body gap`).toBe(12);
        expect(item.font, `${item.tab} caption font`).toBe(layout[0]!.font);
      }
      await page.getByRole("tab", { name: "Stats", exact: true }).click();
      const summary = page.locator('[aria-label="Artist catalogue summary"]');
      await expect(summary.getByRole("group")).toHaveCount(8);
      await expect(
        summary.getByRole("group", { name: "Local albums", exact: true }),
      ).toContainText("4");
      await expect(
        summary.getByRole("group", { name: "Tracks", exact: true }),
      ).toContainText("20");
      const meanBpm = summary.getByRole("group", {
        name: "Mean BPM",
        exact: true,
      });
      await expect(meanBpm).toContainText("120");
      await expect(meanBpm).toContainText(/3\s*\/\s*20 tracks measured/);
      await expect(
        summary.getByRole("group", {
          name: "Full Smart Mix coverage",
          exact: true,
        }),
      ).toContainText(/2\s*\/\s*20/);
      await expect(
        summary.getByRole("group", { name: "Bliss coverage", exact: true }),
      ).toContainText(/2\s*\/\s*20/);
      const genreFits = await summary
        .getByText(dominantGenre, { exact: true })
        .evaluate((node) => node.scrollWidth <= node.clientWidth);
      expect(genreFits).toBe(true);
      const metricBoxes = await summary
        .getByRole("group")
        .evaluateAll((nodes) =>
          nodes.map((node) => ({
            x: node.getBoundingClientRect().x,
            y: node.getBoundingClientRect().y,
          })),
        );
      const columns = viewport.width >= 1024 ? 4 : 2;
      for (let index = 1; index < columns; index++) {
        expect(metricBoxes[index]!.y).toBe(metricBoxes[0]!.y);
      }
      expect(metricBoxes[columns]!.y).toBeGreaterThan(metricBoxes[0]!.y);
      expect(metricBoxes[columns]!.x).toBe(metricBoxes[0]!.x);
      if (viewport.width >= 1024) {
        const coverageRails = await summary
          .locator(".crate-meter-track")
          .evaluateAll((nodes) =>
            nodes.map((node) => node.getBoundingClientRect().y),
          );
        expect(coverageRails).toHaveLength(2);
        expect(
          Math.abs(coverageRails[0]! - coverageRails[1]!),
        ).toBeLessThanOrEqual(1);
      }
      await summary.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `/tmp/crate-artist-summary-metrics-${viewport.width}-oct24.png`,
      });
      await expect(
        page.getByRole("group", { name: "Release reading", exact: true }),
      ).toContainText(laterTitle);
      const timeline = page.getByRole("group", {
        name: "Chronological releases",
        exact: true,
      });
      await timeline.scrollIntoViewIfNeeded();
      for (const [index, year] of [
        [0, "2000"],
        [1, "2001"],
      ] as const) {
        const mark = await timeline
          .locator(".instrument-chart-point")
          .nth(index)
          .boundingBox();
        await page.mouse.click(
          mark!.x + mark!.width / 2,
          mark!.y + mark!.height / 2,
        );
        await expect(
          page.getByRole("group", { name: "Release reading", exact: true }),
        ).toContainText(year);
      }
      const yearLabel = await timeline
        .getByText("2000", { exact: true })
        .boundingBox();
      expect(yearLabel!.height).toBeGreaterThanOrEqual(10);
      await timeline
        .getByRole("button", {
          name: `Inspect ${laterTitle}, 2020, 8 tracks`,
          exact: true,
        })
        .press("Enter");
      const releaseReading = page.getByRole("group", {
        name: "Release reading",
        exact: true,
      });
      await expect(releaseReading).toContainText(laterTitle);
      const titleStyle = await releaseReading
        .getByText(laterTitle, { exact: true })
        .evaluate((node) => ({
          overflow: getComputedStyle(node).textOverflow,
          whitespace: getComputedStyle(node).whiteSpace,
          width: node.scrollWidth <= node.clientWidth,
        }));
      expect(titleStyle.overflow).not.toBe("ellipsis");
      expect(titleStyle.whitespace).not.toBe("nowrap");
      expect(titleStyle.width).toBe(true);
      const sonic = page.getByRole("region", {
        name: "Sonic map",
        exact: true,
      });
      await sonic
        .getByRole("button", { name: /^Inspect audio Arrival/ })
        .nth(1)
        .press("Enter");
      await expect(
        sonic.getByRole("meter", { name: "Energy", exact: true }),
      ).toHaveAttribute("aria-valuenow", "0.8");
      await expect(
        sonic.getByText("Loudness estimate", { exact: true }),
      ).toBeVisible();
      await expect(
        sonic.getByRole("group", { name: "Audio reading", exact: true }),
      ).toContainText("-9");
      await expect(
        sonic.getByRole("group", { name: "Audio reading", exact: true }),
      ).toContainText("dB");
      await sonic.getByRole("button", { name: /Inspect Unanalyzed/ }).click();
      await expect(
        page.getByRole("group", { name: "Audio reading", exact: true }),
      ).toContainText("Unavailable");
      await expect(
        page.getByRole("button", { name: "Inspect release", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", {
          name: "Inspect audio observation",
          exact: true,
        }),
      ).toHaveCount(0);
      const formats = page.getByRole("region", {
        name: "Formats",
        exact: true,
      });
      await expect(formats).toContainText("75%");
      await expect(
        page.getByRole("region", { name: "Genre profile", exact: true }),
      ).toHaveCount(0);
      const rankings = ["Track rankings", "Album rankings"].map((name) =>
        page.getByRole("region", { name, exact: true }),
      );
      for (const ranking of rankings) {
        await ranking.scrollIntoViewIfNeeded();
        const cover = await ranking
          .locator('[data-slot="media-cover"]')
          .first()
          .boundingBox();
        expect(cover!.width).toBe(48);
        await expect(ranking).toContainText("/100");
        const rowText = await ranking
          .locator('[data-slot="hairline-row"]')
          .first()
          .locator(".font-display")
          .evaluate((node) => ({
            whitespace: getComputedStyle(node).whiteSpace,
            fits:
              node.parentElement!.scrollWidth <=
              node.parentElement!.clientWidth,
          }));
        expect(rowText.whitespace).toBe("normal");
        expect(rowText.fits).toBe(true);
      }
      if (viewport.width >= 768) {
        const headers = await Promise.all(
          rankings.map((ranking) =>
            ranking.locator('[data-slot="artist-detail-header"]').boundingBox(),
          ),
        );
        expect(Math.abs(headers[0]!.y - headers[1]!.y)).toBeLessThanOrEqual(1);
      }
      for (const label of ["Release reading", "Audio reading"]) {
        const readout = page.getByRole("group", { name: label, exact: true });
        const geometry = await readout.evaluate((node) => {
          const label = node.firstElementChild!;
          const metadata = node.querySelector("dl")!;
          return {
            gap:
              metadata.getBoundingClientRect().top -
              label.getBoundingClientRect().bottom,
            accent: label.classList.contains("text-accent-action-hi"),
            titleBottom: node.querySelector("dd")!.getBoundingClientRect()
              .bottom,
            yearTop: Array.from(node.querySelectorAll("dt"))
              .find((item) => item.textContent === "Year")!
              .getBoundingClientRect().top,
          };
        });
        expect(geometry.gap).toBeGreaterThanOrEqual(12);
        expect(geometry.accent).toBe(true);
        expect(geometry.yearTop).toBeGreaterThan(geometry.titleBottom);
      }
      expect(
        await page.getByRole("tabpanel").locator("[title], svg title").count(),
      ).toBe(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page
        .getByRole("heading", { name: "Sonic map", exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `/tmp/crate-artist-stats-instruments-${viewport.width}-oct24.png`,
      });
      expect(adminApi.calls).toEqual([]);
    });
  });
}
