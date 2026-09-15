import { expect, test as base, type Route } from "@playwright/test";

type AppearancePreset = "default" | "crateRed";
type ColorMode = "dark" | "light";

interface ListenVisualFixtures {
  failOnConsoleErrors: void;
  openListenPage: (
    path: string,
    options?: {
      mode?: ColorMode;
      player?: boolean;
      preset?: AppearancePreset;
    },
  ) => Promise<void>;
}

const ART_COLORS = ["#06b6d4", "#ef4444", "#8b5cf6", "#0f172a"];

function svgDataUrl(label: string, index = 0): string {
  const foreground = ART_COLORS[index % ART_COLORS.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${foreground}"/><stop offset="1" stop-color="#09090f"/></linearGradient></defs><rect width="640" height="640" fill="url(#g)"/><circle cx="440" cy="170" r="130" fill="#ffffff" fill-opacity=".12"/><path d="M0 470L190 280l120 120 90-90 240 240v90H0z" fill="#020617" fill-opacity=".72"/><text x="40" y="590" fill="#fff" font-family="Arial,sans-serif" font-size="48" font-weight="700">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function binarySvg(): Buffer {
  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#06b6d4"/><stop offset=".45" stop-color="#172033"/><stop offset="1" stop-color="#06070c"/></linearGradient></defs><rect width="1280" height="720" fill="url(#g)"/><circle cx="880" cy="260" r="220" fill="#fff" fill-opacity=".08"/><path d="M0 610L330 260l240 230 190-170 520 400H0z" fill="#03040a" fill-opacity=".72"/></svg>',
  );
}

function silentWav(): Buffer {
  const sampleRate = 8_000;
  const samples = sampleRate;
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

const artistPage = {
  artist: {
    id: 7,
    entity_uid: "artist-high-vis",
    global_artist_uid: "global-high-vis",
    slug: "high-vis",
    name: "High Vis",
    has_photo: true,
    updated_at: "2026-09-08T12:00:00Z",
    albums: [
      {
        id: 71,
        entity_uid: "album-guided-tour",
        slug: "guided-tour",
        name: "Guided Tour",
        display_name: "Guided Tour",
        tracks: 10,
        formats: ["FLAC"],
        size_mb: 284,
        year: "2024",
        has_cover: true,
      },
      {
        id: 72,
        entity_uid: "album-blending",
        slug: "blending",
        name: "Blending",
        display_name: "Blending",
        tracks: 9,
        formats: ["FLAC"],
        size_mb: 251,
        year: "2022",
        has_cover: true,
      },
    ],
    total_tracks: 19,
    total_size_mb: 535,
    primary_format: "FLAC",
    genres: ["hardcore", "post-punk"],
    genre_profile: [
      { name: "hardcore", weight: 1 },
      { name: "post-punk", weight: 0.82 },
    ],
    issue_count: 0,
  },
  info: {
    bio: "High Vis bring together the urgency of hardcore and the widescreen melodies of post-punk. Their songs turn everyday pressure into something communal and defiant.",
    tags: ["hardcore", "post-punk"],
    similar: [
      {
        id: 8,
        slug: "militarie-gun",
        name: "Militarie Gun",
        match: 0.91,
        image_url: svgDataUrl("MG", 1),
      },
    ],
    listeners: 184300,
    playcount: 8120000,
    image_url: svgDataUrl("HIGH VIS"),
    url: "https://example.test/high-vis",
  },
  top_tracks: Array.from({ length: 5 }, (_, index) => ({
    id: `High Vis/Guided Tour/${index + 1}.flac`,
    global_track_uid: `global-track-${index + 1}`,
    track_id: index + 1,
    artist_id: 7,
    artist_slug: "high-vis",
    album_id: 71,
    album_slug: "guided-tour",
    title: [
      "Mob DLA",
      "Mind's a Lie",
      "Drop Me Out",
      "Deserve It",
      "Trauma Bonds",
    ][index],
    artist: "High Vis",
    album: "Guided Tour",
    duration: 198 + index * 13,
    track: index + 1,
    format: "FLAC",
    sample_rate: 44100,
    bit_depth: 16,
  })),
  shows: { configured: true, events: [], source: "fixture" },
  appears_on: [],
  enrichment: {},
  artist_hot_rank: 3,
};

const upcomingItems = [
  {
    id: 501,
    event_key: "show-high-vis-london",
    type: "show",
    date: "2026-10-18",
    time: "20:00",
    artist: "High Vis",
    artist_id: 7,
    artist_slug: "high-vis",
    title: "Electric Ballroom",
    subtitle: "London, United Kingdom",
    cover_url: svgDataUrl("LIVE"),
    status: "onsale",
    is_upcoming: true,
    venue: "Electric Ballroom",
    city: "London",
    country: "United Kingdom",
    country_code: "GB",
    lineup: ["High Vis", "Militarie Gun"],
    genres: ["hardcore"],
    user_attending: true,
  },
  {
    id: 601,
    release_id: 601,
    type: "release",
    date: "2026-10-25",
    artist: "Militarie Gun",
    artist_id: 8,
    artist_slug: "militarie-gun",
    album_id: 81,
    album_slug: "new-music",
    title: "New Music",
    subtitle: "Album",
    cover_url: svgDataUrl("NEW", 1),
    status: "pre-release",
    is_upcoming: true,
  },
  {
    id: 602,
    release_id: 602,
    type: "release",
    date: "2026-08-14",
    artist: "Fiddlehead",
    artist_id: 9,
    artist_slug: "fiddlehead",
    album_id: 91,
    album_slug: "death-is-nothing-to-us",
    title: "Death Is Nothing to Us",
    subtitle: "Album",
    cover_url: svgDataUrl("DIN", 2),
    status: "released",
    is_upcoming: false,
  },
] as const;

const homeDiscovery = {
  snapshot: {
    scope: "home",
    subject_key: "user:1",
    version: 7,
    stale: false,
    generation_ms: 12,
  },
  hero: {
    id: 7,
    entity_uid: "artist-high-vis",
    slug: "high-vis",
    name: "High Vis",
    genres: ["hardcore", "post-punk"],
    genre_profile: [
      { name: "hardcore", weight: 1 },
      { name: "post-punk", weight: 0.82 },
    ],
    listeners: 184300,
    scrobbles: 8120000,
    album_count: 2,
    track_count: 19,
    bio: "Urgent, melodic hardcore from London.",
    artwork_provenance: "fallback",
  },
  recently_played: [],
  custom_mixes: [],
  suggested_albums: [
    {
      album_id: 71,
      album_slug: "guided-tour",
      artist_name: "High Vis",
      artist_id: 7,
      artist_slug: "high-vis",
      album_name: "Guided Tour",
      year: "2024",
      cover_url: svgDataUrl("GUIDED"),
    },
  ],
  recommended_tracks: [],
  radio_stations: [],
  favorite_artists: [],
  essentials: [],
  recent_global_artists: [],
  upcoming: {
    items: upcomingItems.slice(0, 2),
    insights: [],
    summary: {
      followed_artists: 2,
      show_count: 1,
      release_count: 1,
      attending_count: 1,
      insight_count: 0,
    },
  },
  replay: {
    window: "month:2026-09",
    title: "Crate DNA",
    subtitle: "September 2026",
    track_count: 0,
    minutes_listened: 0,
    items: [],
  },
};

const explorePage = {
  playlists: [],
  moods: [
    { name: "Focused", track_count: 42 },
    { name: "Energetic", track_count: 31 },
  ],
  filters: {
    genres: [
      {
        name: "Hardcore",
        slug: "hardcore",
        count: 12,
        description: "Fast, urgent and built around community pressure.",
        top_artists: ["High Vis", "Fiddlehead", "Militarie Gun"],
        cover_url: svgDataUrl("HARDCORE"),
      },
      {
        name: "Post-punk",
        slug: "post-punk",
        count: 9,
        description: "Tense rhythms, open space and nocturnal guitars.",
        top_artists: ["Protomartyr", "Shame"],
        cover_url: svgDataUrl("POST-PUNK", 2),
      },
    ],
    decades: ["1980s", "1990s", "2000s", "2010s"],
  },
};

const genreDetail = {
  id: 1,
  name: "hardcore",
  slug: "hardcore",
  canonical_slug: "hardcore",
  description: "Fast, urgent and built around community pressure.",
  cover_url: svgDataUrl("HARDCORE"),
  artist_count: 6,
  album_count: 6,
  track_count: 68,
  artists: Array.from({ length: 6 }, (_, index) => ({
    artist_id: index + 7,
    artist_name: [
      "High Vis",
      "Fiddlehead",
      "Militarie Gun",
      "Drug Church",
      "Mindforce",
      "Praise",
    ][index],
    artist_slug: [
      "high-vis",
      "fiddlehead",
      "militarie-gun",
      "drug-church",
      "mindforce",
      "praise",
    ][index],
    album_count: index + 2,
    track_count: 10 + index,
    has_photo: true,
    photo_url: svgDataUrl(`A${index + 1}`, index),
    listeners: 100000 - index * 8000,
    membership: "direct",
  })),
  albums: Array.from({ length: 5 }, (_, index) => ({
    album_id: index + 71,
    album_slug: `genre-album-${index + 1}`,
    artist: [
      "High Vis",
      "Fiddlehead",
      "Militarie Gun",
      "Drug Church",
      "Mindforce",
    ][index],
    name: [
      "Guided Tour",
      "Between the Richness",
      "Life Under the Gun",
      "Hygiene",
      "New Lords",
    ][index],
    year: String(2024 - index),
    track_count: 10 + index,
    has_cover: true,
    cover_url: svgDataUrl(`R${index + 1}`, index + 1),
    membership: "direct",
  })),
  related_genres: [],
  shows: [],
};

function responseFor(pathname: string): unknown {
  if (pathname === "/api/auth/me" || pathname === "/api/me") {
    return {
      id: 1,
      email: "visual@crate.test",
      name: "Visual Review",
      role: "admin",
      roles: ["admin"],
      capabilities: ["admin"],
      avatar: svgDataUrl("VR", 2),
    };
  }
  if (pathname === "/api/i18n/listen/manifest") {
    return {
      app: "listen",
      fallbackLocale: "en",
      sourceVersion: "local-v1",
      bundles: [],
    };
  }
  if (pathname === "/api/me/home/discovery") return homeDiscovery;
  if (pathname === "/api/me/playlists-page") {
    return { playlists: [], followed_curated_playlists: [] };
  }
  if (pathname === "/api/catalog/me/albums") return [];
  if (pathname === "/api/artists/7/top-tracks") return artistPage.top_tracks;
  if (pathname === "/api/artist-slugs/high-vis/top-tracks") {
    return artistPage.top_tracks;
  }
  if (pathname === "/api/me/follows/artists/7") return {};
  if (
    pathname === "/api/tracks/1/info" ||
    /^\/api\/catalog\/tracks\/global-track-[1-5]\/info$/.test(pathname)
  ) {
    return {
      title: "Mob DLA",
      artist: "High Vis",
      album: "Guided Tour",
      format: "FLAC",
      bitrate: 1040,
      sample_rate: 44100,
      bit_depth: 16,
      bpm: null,
      audio_key: null,
      audio_scale: null,
      energy: null,
      danceability: null,
      valence: null,
      acousticness: null,
      instrumentalness: null,
      loudness: null,
      dynamic_range: null,
      mood_json: null,
      lastfm_listeners: null,
      lastfm_playcount: null,
      popularity: null,
      rating: null,
      bliss_signature: null,
    };
  }
  if (
    pathname === "/api/tracks/1/playback" ||
    /^\/api\/catalog\/tracks\/global-track-[1-5]\/playback$/.test(pathname)
  ) {
    const quality = {
      format: "FLAC",
      codec: "flac",
      bitrate: 1040,
      sample_rate: 44100,
      bit_depth: 16,
      bytes: 28_000_000,
      lossless: true,
    };
    return {
      stream_url: "/api/tracks/1/stream",
      requested_policy: "original",
      effective_policy: "original",
      source: quality,
      delivery: quality,
      transcoded: false,
      cache_hit: true,
      preparing: false,
      task_id: null,
      variant_id: null,
      variant_status: null,
      playback_session: "visual-session",
      content_origin: "local",
    };
  }
  if (pathname === "/api/playback/prepare") return {};
  if (pathname === "/api/me/now-playing") return {};
  if (pathname === "/api/me/play-events") return {};
  if (pathname === "/api/bandcamp/links/artist/by-entity/artist-high-vis") {
    return {};
  }
  if (pathname === "/api/browse/explore-page") return explorePage;
  if (pathname === "/api/catalog/genres/hardcore") return genreDetail;
  if (pathname.startsWith("/api/artist-slugs/high-vis/page")) {
    return artistPage;
  }
  if (pathname === "/api/me/upcoming") {
    return {
      items: upcomingItems,
      summary: {
        followed_artists: 6,
        show_count: 1,
        release_count: 2,
        attending_count: 1,
        insight_count: 0,
      },
    };
  }
  if (pathname === "/api/catalog/me/follows") {
    return [
      {
        artist_id: 7,
        global_artist_uid: "global-high-vis",
        artist_slug: "high-vis",
        artist_name: "High Vis",
        created_at: "2026-01-01T00:00:00Z",
      },
    ];
  }
  if (pathname === "/api/me/likes") return [];
  if (pathname === "/api/catalog/me/albums/saved") return [];
  if (pathname === "/api/me/devices") return { devices: [] };
  if (pathname === "/api/me/connect/preferences") return { enabled: false };
  if (pathname === "/api/auth/providers") return {};
  if (pathname === "/api/auth/config") {
    return { registration_enabled: false, password_login_enabled: true };
  }
  if (pathname === "/api/me/location") {
    return {
      city: "Madrid",
      country: "Spain",
      country_code: "ES",
      latitude: 40.4168,
      longitude: -3.7038,
      show_location_mode: "profile",
      show_radius_km: 100,
    };
  }
  if (pathname === "/api/me/scrobble/status") {
    return { lastfm: { connected: false }, listenbrainz: { connected: false } };
  }
  if (pathname === "/api/me/scrobble/preferences") {
    return { enabled: false };
  }
  if (pathname === "/api/bandcamp/me/status") {
    return { connected: false, username: null };
  }
  if (
    pathname === "/api/bandcamp/me/collection" ||
    pathname === "/api/bandcamp/me/wishlist" ||
    pathname === "/api/bandcamp/me/following"
  ) {
    return { total: 0, items: [] };
  }
  throw new Error(`Unhandled JSON API fixture: ${pathname}`);
}

async function fulfillApi(route: Route): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());
  if (request.resourceType() === "media" || url.pathname.endsWith("/stream")) {
    await route.fulfill({
      status: 200,
      contentType: "audio/wav",
      body: silentWav(),
    });
    return;
  }
  if (
    request.resourceType() === "image" ||
    /\/(?:cover|photo|background)$/.test(url.pathname)
  ) {
    await route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: binarySvg(),
    });
    return;
  }
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(responseFor(url.pathname)),
  });
}

function appearancePreferences(mode: ColorMode, preset: AppearancePreset) {
  return {
    version: 2,
    mode,
    preset,
    overrides: {},
    presentation: { density: "comfortable" },
    accessibility: { motion: "reduced" },
  };
}

function playerSnapshot() {
  return {
    queue: [
      {
        id: "High Vis/Guided Tour/01 Mob DLA.flac",
        libraryTrackId: 1,
        path: "High Vis/Guided Tour/01 Mob DLA.flac",
        title: "Mob DLA",
        artist: "High Vis",
        artistId: 7,
        artistSlug: "high-vis",
        album: "Guided Tour",
        albumId: 71,
        albumSlug: "guided-tour",
        albumCover: svgDataUrl("GUIDED"),
        duration: 198,
      },
    ],
    currentIndex: 0,
    currentTime: 42,
    wasPlaying: false,
    shuffle: false,
    unshuffledQueue: null,
    savedAt: "2026-09-12T12:00:00Z",
  };
}

export const test = base.extend<ListenVisualFixtures>({
  failOnConsoleErrors: [
    async ({ page }, provide) => {
      const errors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("pageerror", (error) => errors.push(error.message));
      await provide();
      expect(errors, "Listen emitted browser errors").toEqual([]);
    },
    { auto: true },
  ],
  openListenPage: async ({ page }, provide) => {
    await page.clock.install({ time: new Date("2026-09-12T12:00:00Z") });
    await page.route("**/api/**", fulfillApi);
    await page.addInitScript(() => {
      class StableEventSource {
        readonly readyState = 1;
        readonly url: string;
        onerror: ((event: Event) => void) | null = null;
        onmessage: ((event: MessageEvent) => void) | null = null;
        onopen: ((event: Event) => void) | null = null;

        constructor(url: string | URL) {
          this.url = String(url);
          queueMicrotask(() => this.onopen?.(new Event("open")));
        }

        addEventListener() {}
        close() {}
        dispatchEvent() {
          return true;
        }
        removeEventListener() {}
      }
      Object.defineProperty(window, "EventSource", {
        configurable: true,
        value: StableEventSource,
      });
    });

    await provide(async (path, options = {}) => {
      const mode = options.mode ?? "dark";
      const preset = options.preset ?? "default";
      await page.addInitScript(
        ({ appearance, player }) => {
          localStorage.clear();
          localStorage.setItem(
            "crate.listen.appearance.v2",
            JSON.stringify(appearance),
          );
          localStorage.setItem("crate.listen.theme-skin", appearance.preset);
          localStorage.setItem("crate-listen-sidebar-expanded", "true");
          localStorage.setItem("i18nextLng", "en");
          localStorage.setItem("listen-eq-smart", "false");
          if (player) {
            localStorage.setItem(
              "listen-player-state:v1",
              JSON.stringify(player),
            );
          }
        },
        {
          appearance: appearancePreferences(mode, preset),
          player: options.player ? playerSnapshot() : null,
        },
      );
      await page.goto(path);
      await page.waitForFunction(() => document.fonts.status === "loaded");
      await expect(page.getByTestId("listen-content")).toBeVisible();
    });
  },
});

export { expect };
