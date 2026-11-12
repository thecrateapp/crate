import { describe, expect, it, vi } from "vitest";

import {
  parseDesktopPlayRef,
  playDesktopRef,
  searchForDesktop,
  toDesktopSearchItems,
} from "./desktop-control-search";

const data = {
  artists: [
    { name: "Repion", id: 3, slug: "repion", global_artist_uid: "ga1" },
  ],
  albums: [
    {
      name: "Pronto",
      artist: "Repion",
      id: 11,
      year: "2024",
      slug: "pronto",
      artist_slug: "repion",
    },
  ],
  tracks: [
    {
      id: 9,
      title: "Barrio Somavilla",
      artist: "Repion",
      album: "Pronto",
      path: "a.flac",
    },
  ],
};

describe("desktop search", () => {
  it("lists artists, albums then tracks with play refs", () => {
    const items = toDesktopSearchItems(data);
    expect(items.map((i) => [i.kind, i.title, i.subtitle])).toEqual([
      ["artist", "Repion", "Artist"],
      ["album", "Pronto", "Repion · 2024"],
      ["track", "Barrio Somavilla", "Repion · Pronto"],
    ]);
    expect(items[0]?.ref).toEqual({
      kind: "artist",
      artist: expect.objectContaining({
        name: "Repion",
        artistId: 3,
        globalArtistUid: "ga1",
      }),
    });
    expect(items[1]?.ref).toEqual({
      kind: "album",
      album: expect.objectContaining({
        album: "Pronto",
        artist: "Repion",
        albumId: 11,
      }),
    });
  });

  it("caps each kind and queries the catalog search", async () => {
    const many = {
      artists: Array.from({ length: 9 }, (_, i) => ({ name: `A${i}` })),
    };
    expect(toDesktopSearchItems(many)).toHaveLength(4);
    const fetcher = vi.fn().mockResolvedValue(data);
    await searchForDesktop("  nick cave & ", fetcher);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/catalog/search?q=nick%20cave%20%26&limit=8",
    );
    await expect(searchForDesktop("   ", fetcher)).resolves.toEqual([]);
  });

  it("accepts only the refs it produced", () => {
    for (const item of toDesktopSearchItems(data)) {
      expect(parseDesktopPlayRef(item.ref)).toEqual(item.ref);
    }
    expect(parseDesktopPlayRef({ kind: "playlist", playlist: {} })).toBeNull();
    expect(
      parseDesktopPlayRef({ kind: "album", album: { album: 1 } }),
    ).toBeNull();
    expect(
      parseDesktopPlayRef({ kind: "track", track: { title: "x" } }),
    ).toBeNull();
  });

  it("never lets media URLs or tickets out in a ref", () => {
    const items = toDesktopSearchItems({
      tracks: [
        {
          id: 1,
          title: "T",
          artist: "A",
          album: "B",
          cover_url: "/api/x/cover?media_ticket=SECRET",
          path: "https://host/stream?token=SECRET",
        } as never,
      ],
    });
    const wire = JSON.stringify(items);
    expect(wire).not.toMatch(/SECRET|media_ticket|token=/);
    expect(items[0]?.ref).toEqual({
      kind: "track",
      track: { id: 1, title: "T", artist: "A", album: "B" },
    });
    expect(parseDesktopPlayRef("album")).toBeNull();
  });

  it("plays albums in order and artists by their top tracks", async () => {
    const play = vi.fn();
    const playAll = vi.fn();
    const tracks = [{ id: "t1", title: "One", artist: "Repion" }];
    const deps = {
      resolveTrack: vi.fn((t) => Promise.resolve(t)),
      fetchAlbumTracks: vi.fn().mockResolvedValue(tracks),
      fetchArtistTopTracks: vi.fn().mockResolvedValue(tracks),
    };
    const [artist, album] = toDesktopSearchItems(data);

    await playDesktopRef(album!.ref, { play, playAll }, deps);
    expect(playAll).toHaveBeenLastCalledWith(tracks, 0, {
      type: "album",
      name: "Repion - Pronto",
      radio: { seedType: "album", seedId: 11 },
    });

    await playDesktopRef(artist!.ref, { play, playAll }, deps);
    expect(deps.fetchArtistTopTracks).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Repion" }),
    );
    expect(playAll).toHaveBeenLastCalledWith(tracks, 0, {
      type: "queue",
      name: "Repion",
    });

    deps.fetchAlbumTracks.mockResolvedValue([]);
    await expect(
      playDesktopRef(album!.ref, { play, playAll }, deps),
    ).resolves.toBe(false);
  });
});
