import { afterEach, describe, expect, it, vi } from "vitest";

import type { Track } from "@/contexts/player-types";

import {
  launcherArtScope,
  resetLauncherArtForTests,
  type LauncherArtDeps,
} from "./desktop-launcher-art";
import {
  loadPrewarmEntries,
  PREWARM_ALBUM_LIMIT,
  PREWARM_ARTIST_LIMIT,
  PREWARM_HISTORY_LIMIT,
  PrewarmSet,
  trackArtEntries,
  warmLauncherArt,
} from "./desktop-launcher-prewarm";

/** The launcher-art scope of the server the tests talk to. */
const S = launcherArtScope();

const history = [
  {
    title: "Barrio Somavilla",
    artist: "Repion",
    artist_id: 3,
    artist_slug: "repion",
    album: "Pronto",
    album_id: 11,
    album_slug: "pronto",
  },
  {
    title: "Otra",
    artist: "Repion",
    artist_id: 3,
    album: "Pronto",
    album_id: 11,
  },
  {
    title: "Song",
    artist: "Mujeres",
    artist_id: 4,
    album: "Siento",
    album_id: 12,
  },
];

const discovery = {
  favorite_artists: [
    { artist_id: 9, artist_name: "Top", play_count: 90, minutes_listened: 1 },
  ],
  recently_played: [
    { type: "album", album_id: 13, album_name: "Home", artist_name: "X" },
    { type: "artist", artist_id: 4, artist_name: "Mujeres" },
    { type: "playlist", playlist_id: 1, playlist_name: "P" },
  ],
};

const follows = [{ artist_name: "Followed", global_artist_uid: "ga-1" }];

function fetcher(overrides: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = {
    [`/api/me/history?limit=${PREWARM_HISTORY_LIMIT}`]: history,
    "/api/me/home/discovery": discovery,
    "/api/catalog/me/follows": follows,
    ...overrides,
  };
  return vi.fn((url: string) =>
    url in data && data[url] !== undefined
      ? Promise.resolve(data[url])
      : Promise.reject(new Error("offline")),
  );
}

describe("launcher art prewarm set", () => {
  afterEach(() => resetLauncherArtForTests());

  it("collects top artists, then what was played, then follows, once each", async () => {
    const entries = await loadPrewarmEntries(fetcher());
    expect(entries.map(([key]) => key)).toEqual([
      `artist:${S}:9`,
      `album:${S}:11`,
      `artist:${S}:3`,
      `album:${S}:12`,
      `artist:${S}:4`,
      `album:${S}:13`,
      `artist:${S}:g:ga-1`,
    ]);
    expect(entries[1]?.[1]).toEqual({
      kind: "album",
      input: expect.objectContaining({
        albumId: 11,
        albumName: "Pronto",
        artistName: "Repion",
      }),
    });
  });

  it("keeps going when a source fails", async () => {
    const entries = await loadPrewarmEntries(
      fetcher({ "/api/me/home/discovery": undefined }),
    );
    expect(entries.map(([key]) => key)).toEqual([
      `album:${S}:11`,
      `artist:${S}:3`,
      `album:${S}:12`,
      `artist:${S}:4`,
      `artist:${S}:g:ga-1`,
    ]);
  });

  it(`caps the set at ${PREWARM_ALBUM_LIMIT} albums and ${PREWARM_ARTIST_LIMIT} artists`, () => {
    const set = new PrewarmSet();
    for (let i = 0; i < 300; i += 1) {
      set.addAlbum({ albumId: i, albumName: `A${i}` });
      set.addArtist({ artistId: i, artistName: `R${i}` });
    }
    const keys = set.entries().map(([key]) => key);
    expect(keys.filter((k) => k.startsWith("album:"))).toHaveLength(200);
    expect(keys.filter((k) => k.startsWith("artist:"))).toHaveLength(100);
    expect(keys[0]).toBe(`album:${S}:0`);
  });

  it("warms a track's album and artist", () => {
    const track = {
      id: "t1",
      title: "T",
      artist: "Repion",
      artistId: 3,
      album: "Pronto",
      albumId: 11,
    } as Track;
    expect(trackArtEntries([track, track]).map(([key]) => key)).toEqual([
      `album:${S}:11`,
      `artist:${S}:3`,
    ]);
    expect(
      trackArtEntries([{ id: "x", title: "x", artist: "y" } as Track]),
    ).toEqual([]);
  });
});

describe("warmLauncherArt", () => {
  afterEach(() => resetLauncherArtForTests());

  function artDeps() {
    return {
      authorize: vi.fn((url: string) => Promise.resolve(url)),
      fetch: vi.fn(() =>
        Promise.resolve(new Response(new Uint8Array([1]), { status: 200 })),
      ),
      toSquare: vi.fn((blob: Blob) => Promise.resolve(blob)),
      store: vi.fn<LauncherArtDeps["store"]>(() => Promise.resolve(true)),
    };
  }

  it("fetches only what the shell has not cached, at low priority", async () => {
    const entries = await loadPrewarmEntries(fetcher());
    const art = artDeps();
    const missing = vi.fn(() =>
      Promise.resolve([`album:${S}:12`, `artist:${S}:9`]),
    );
    const warmed = await warmLauncherArt(entries, {
      missing,
      art,
      pause: () => Promise.resolve(),
    });
    expect(missing).toHaveBeenCalledWith(entries.map(([key]) => key));
    expect(warmed).toBe(2);
    expect(art.store.mock.calls.map(([key]) => key).sort()).toEqual([
      `album:${S}:12`,
      `artist:${S}:9`,
    ]);
    expect(art.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ priority: "low" }),
    );
  });

  it("does nothing where the shell has no launcher cache", async () => {
    const art = artDeps();
    const warmed = await warmLauncherArt(await loadPrewarmEntries(fetcher()), {
      missing: () => Promise.resolve(null),
      art,
    });
    expect(warmed).toBeNull();
    expect(art.fetch).not.toHaveBeenCalled();
    await expect(
      warmLauncherArt([], { missing: () => Promise.resolve([]), art }),
    ).resolves.toBe(0);
  });
});
