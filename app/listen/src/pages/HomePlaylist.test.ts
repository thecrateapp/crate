import { describe, expect, it } from "vitest";

import type { HomeGeneratedPlaylistDetail } from "@/components/home/home-model";

import { newArrivalsWindowLabel } from "./HomePlaylist";

function playlist(
  tracks: HomeGeneratedPlaylistDetail["tracks"],
): HomeGeneratedPlaylistDetail {
  return {
    id: "my-new-arrivals",
    name: "My New Arrivals",
    description: "",
    artwork_tracks: [],
    artwork_artists: [],
    track_count: tracks.length,
    total_duration: 0,
    badge: "Mix",
    kind: "mix",
    tracks,
  };
}

describe("newArrivalsWindowLabel", () => {
  it("returns the single release-week label", () => {
    expect(
      newArrivalsWindowLabel(
        playlist([
          {
            title: "Track",
            artist: "Artist",
            release_week_index: 0,
            release_week_label: "This week",
          },
        ]),
      ),
    ).toBe("This week");
  });

  it("summarizes multiple release-week buckets", () => {
    expect(
      newArrivalsWindowLabel(
        playlist([
          {
            title: "Current",
            artist: "Artist",
            release_week_index: 0,
            release_week_label: "This week",
          },
          {
            title: "Previous",
            artist: "Artist",
            release_week_index: 2,
            release_week_label: "2 weeks ago",
          },
        ]),
      ),
    ).toBe("This week + 2 previous weeks");
  });

  it("ignores non-new-arrivals playlists", () => {
    const data = playlist([]);
    data.id = "daily-discovery";

    expect(newArrivalsWindowLabel(data)).toBeNull();
  });
});
