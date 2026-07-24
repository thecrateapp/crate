import { describe, expect, it } from "vitest";

import { toTrackRowData } from "@/lib/track-row-data";

describe("toTrackRowData", () => {
  it("normalizes global identity to the snake_case TrackRow contract", () => {
    const row = toTrackRowData({
      id: "track-global-1",
      globalTrackUid: "track-global-1",
      globalArtistUid: "artist-global-1",
      globalAlbumUid: "album-global-1",
      title: "0151",
      artist: "High Vis",
      album: "Blending",
    });

    expect(row.global_track_uid).toBe("track-global-1");
    expect(row.global_artist_uid).toBe("artist-global-1");
    expect(row.global_album_uid).toBe("album-global-1");
    expect("globalTrackUid" in row).toBe(false);
    expect("globalArtistUid" in row).toBe(false);
    expect("globalAlbumUid" in row).toBe(false);
  });
});
