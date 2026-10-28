import { describe, expect, it } from "vitest";

import { toPlayerTrack } from "@/components/stats/stats-model";

describe("toPlayerTrack", () => {
  it("plays a range track by its library id even without an artist name", () => {
    const track = toPlayerTrack({
      track_id: 7,
      title: "Sunflower",
      artist: null,
      album: "Things We Lost in the Fire",
      album_id: 3,
      plays: 2,
      minutes: 8,
    });

    expect(track).toMatchObject({
      id: "7",
      libraryTrackId: 7,
      title: "Sunflower",
      artist: "",
      album: "Things We Lost in the Fire",
      albumId: 3,
    });
  });

  it("keeps the dashboard track conversion unchanged", () => {
    const track = toPlayerTrack({
      track_id: null,
      track_path: "/music/low/sunflower.flac",
      title: "Sunflower",
      artist: "Low",
      album: "Things We Lost in the Fire",
      play_count: 3,
      complete_play_count: 3,
      minutes_listened: 12,
    });

    expect(track).toMatchObject({
      id: "/music/low/sunflower.flac",
      artist: "Low",
      path: "/music/low/sunflower.flac",
    });
  });
});
