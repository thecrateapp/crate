import { describe, expect, it } from "vitest";
import {
  collectHomeWarmupAssets,
  collectHomeWarmupPlaylistUrls,
} from "./use-listen-warmup";
import type { HomeDiscoveryPayload } from "@/components/home/home-model";

describe("collectHomeWarmupAssets", () => {
  it("returns empty array for empty discovery", () => {
    const result = collectHomeWarmupAssets({} as HomeDiscoveryPayload);
    expect(result).toEqual([]);
  });

  it("collects hero backgrounds", () => {
    const discovery = {
      hero: [{ id: 1, slug: "artist", name: "Artist" }],
    } as unknown as HomeDiscoveryPayload;
    const result = collectHomeWarmupAssets(discovery);
    expect(result.length).toBeGreaterThan(0);
  });

  it("collects recently played album covers", () => {
    const discovery = {
      recently_played: [
        {
          type: "album",
          album_id: 1,
          album_slug: "album",
          artist_name: "Artist",
          album_name: "Album",
        },
      ],
    } as unknown as HomeDiscoveryPayload;
    const result = collectHomeWarmupAssets(discovery);
    expect(result.length).toBeGreaterThan(0);
  });

  it("collects radio station artist photos", () => {
    const discovery = {
      radio_stations: [
        {
          type: "artist",
          artist_id: 1,
          artist_slug: "artist",
          artist_name: "Artist",
        },
      ],
    } as unknown as HomeDiscoveryPayload;
    const result = collectHomeWarmupAssets(discovery);
    expect(result.length).toBeGreaterThan(0);
  });

  it("collects suggested album covers", () => {
    const discovery = {
      suggested_albums: [
        {
          album_id: 1,
          album_slug: "album",
          artist_name: "Artist",
          album_name: "Album",
        },
      ],
    } as unknown as HomeDiscoveryPayload;
    const result = collectHomeWarmupAssets(discovery);
    expect(result.length).toBeGreaterThan(0);
  });

  it("collects favorite artist photos", () => {
    const discovery = {
      favorite_artists: [
        {
          artist_id: 1,
          artist_slug: "artist",
          artist_name: "Artist",
        },
      ],
    } as unknown as HomeDiscoveryPayload;
    const result = collectHomeWarmupAssets(discovery);
    expect(result.length).toBeGreaterThan(0);
  });

  it("collects playlist artwork", () => {
    const discovery = {
      custom_mixes: [
        {
          id: "mix-1",
          artwork_tracks: [
            {
              album_id: 1,
              album_slug: "album",
              artist: "Artist",
              album: "Album",
            },
          ],
        },
      ],
    } as unknown as HomeDiscoveryPayload;
    const result = collectHomeWarmupAssets(discovery);
    expect(result.length).toBeGreaterThan(0);
  });

  it("deduplicates urls", () => {
    const discovery = {
      hero: [{ id: 1, slug: "artist", name: "Artist" }],
      recently_played: [
        {
          type: "artist",
          artist_id: 1,
          artist_slug: "artist",
          artist_name: "Artist",
        },
      ],
    } as unknown as HomeDiscoveryPayload;
    const result = collectHomeWarmupAssets(discovery);
    const unique = new Set(result);
    expect(unique.size).toBe(result.length);
  });
});

describe("collectHomeWarmupPlaylistUrls", () => {
  it("returns playlist API urls", () => {
    const discovery = {
      custom_mixes: [{ id: "mix-1" }],
      essentials: [{ id: "ess-1" }],
    } as unknown as HomeDiscoveryPayload;
    const result = collectHomeWarmupPlaylistUrls(discovery);
    expect(result).toContain("/api/me/home/playlists/mix-1");
    expect(result).toContain("/api/me/home/playlists/ess-1");
  });

  it("returns empty array when no playlists", () => {
    const result = collectHomeWarmupPlaylistUrls({} as HomeDiscoveryPayload);
    expect(result).toEqual([]);
  });

  it("deduplicates playlist ids", () => {
    const discovery = {
      custom_mixes: [{ id: "same" }],
      essentials: [{ id: "same" }],
    } as unknown as HomeDiscoveryPayload;
    const result = collectHomeWarmupPlaylistUrls(discovery);
    expect(result).toHaveLength(1);
  });
});
