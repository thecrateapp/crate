import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  getApiBase: vi.fn(() => ""),
  getAuthToken: vi.fn(() => null),
  apiAssetUrl: vi.fn((path: string) => path),
  resolveMaybeApiAssetUrl: vi.fn((path?: string | null) => path ?? null),
}));

import { flattenTopBarSearchResults } from "./topbar-search-model";

describe("flattenTopBarSearchResults", () => {
  it("preserves remote origin metadata for global catalog results", () => {
    const items = flattenTopBarSearchResults({
      artists: [
        {
          name: "High Vis",
          global_artist_uid: "artist-global-1",
          origin: "remote",
          node_name: "Node B",
        },
      ],
      albums: [
        {
          name: "Blending",
          artist: "High Vis",
          global_album_uid: "album-global-1",
          has_cover: true,
          origin: "remote",
          node_name: "Node B",
        },
      ],
      tracks: [
        {
          title: "0151",
          artist: "High Vis",
          album: "Blending",
          global_track_uid: "track-global-1",
          global_album_uid: "album-global-1",
          origin: "remote",
          node_name: "Node B",
        },
      ],
    });

    expect(items).toHaveLength(3);
    expect(items.map((item) => item.origin)).toEqual([
      "remote",
      "remote",
      "remote",
    ]);
    expect(items.map((item) => item.nodeName)).toEqual([
      "Node B",
      "Node B",
      "Node B",
    ]);
    const trackItem = items[2];
    expect(trackItem?.trackData?.globalTrackUid).toBe("track-global-1");
  });
});
