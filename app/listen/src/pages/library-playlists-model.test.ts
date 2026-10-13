import { describe, expect, it } from "vitest";

import {
  playlistOwnerLabel,
  splitLibraryPlaylists,
  type Playlist,
} from "@/pages/library-playlists-model";

function playlist(id: number, overrides: Partial<Playlist> = {}): Playlist {
  return {
    id,
    name: `Playlist ${id}`,
    track_count: 0,
    is_smart: false,
    total_duration: 0,
    created_at: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

describe("library playlists model", () => {
  it("separates playlists the viewer owns from playlists shared with them", () => {
    const { owned, shared } = splitLibraryPlaylists(
      [
        playlist(1, { user_id: 5 }),
        playlist(2, { user_id: 9 }),
        playlist(3, { user_id: null }),
      ],
      5,
    );

    expect(owned.map((item) => item.id)).toEqual([1, 3]);
    expect(shared.map((item) => item.id)).toEqual([2]);
  });

  it("prefers the owner display name and falls back to the handle", () => {
    expect(playlistOwnerLabel(playlist(1, { owner_name: "Jane" }))).toBe(
      "Jane",
    );
    expect(playlistOwnerLabel(playlist(1, { owner_username: "jane" }))).toBe(
      "@jane",
    );
    expect(playlistOwnerLabel(playlist(1))).toBeNull();
  });
});
