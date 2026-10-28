import { describe, expect, it } from "vitest";
import {
  createPathPlaySource,
  getPlaySourceHref,
} from "@/components/player/player-source";
import type { PathDetail, PathTrack } from "./paths-model";
import { getPathPlayback } from "./path-playback";

function track(id: number, playable?: boolean): PathTrack {
  return {
    track_id: id,
    step: id - 1,
    progress: (id - 1) / 3,
    title: `Track ${id}`,
    artist: `Artist ${id}`,
    path: `/music/path/${id}.flac`,
    distance: 0.1,
    bpm: 120 + id,
    audio_key: "C",
    audio_scale: "major",
    bliss_vector: [0.1, 0.2],
    playable,
  };
}

function path(tracks: PathTrack[]): PathDetail {
  return {
    id: 77,
    name: "Saved journey",
    origin: { type: "genre", value: "punk", label: "Punk" },
    destination: { type: "genre", value: "electronic", label: "Electronic" },
    waypoints: [],
    step_count: tracks.length,
    created_at: "2026-10-28T12:00:00Z",
    tracks,
  };
}

describe("finite saved-path playback", () => {
  it("uses a path identity with its own destination, without playlist or radio context", () => {
    const source = createPathPlaySource(path([]));
    expect(source).toEqual({
      type: "path",
      id: 77,
      name: "Saved journey",
      href: "/paths/77",
    });
    expect(getPlaySourceHref(source)).toBe("/paths/77");
    expect(source.radio).toBeUndefined();
  });

  it("resolves only a valid path identity instead of trusting a persisted route href", () => {
    expect(
      getPlaySourceHref({
        type: "path",
        id: "77",
        name: "Saved",
        href: "https://other.example",
      }),
    ).toBe("/paths/77");
    expect(
      getPlaySourceHref({
        type: "path",
        id: "not-a-path",
        name: "Saved",
        href: "/paths/77",
      }),
    ).toBeNull();
    expect(
      getPlaySourceHref({ type: "playlist", id: 77, name: "Playlist" }),
    ).toBeNull();
    expect(getPlaySourceHref(null)).toBeNull();
  });

  it("starts at the first playable track and preserves the saved order and musical metadata", () => {
    const saved = path([
      track(1, false),
      track(2),
      track(3, false),
      track(4, true),
    ]);
    const before = structuredClone(saved);
    const playback = getPathPlayback(saved);
    expect(playback?.index).toBe(0);
    expect(playback?.tracks.map((item) => item.libraryTrackId)).toEqual([2, 4]);
    expect(playback?.tracks[0]).toMatchObject({
      bpm: 122,
      audioKey: "C",
      audioScale: "major",
      blissVector: [0.1, 0.2],
    });
    expect(playback?.source).toEqual(createPathPlaySource(saved));
    expect(saved).toEqual(before);
  });

  it("remaps an explicit saved step after filtering earlier unavailable songs", () => {
    const saved = path([
      track(1, false),
      track(2, true),
      track(3, false),
      track(4, true),
    ]);
    expect(getPathPlayback(saved, 3)?.index).toBe(1);
    expect(getPathPlayback(saved, 0)).toBeNull();
    expect(getPathPlayback(saved, 2)).toBeNull();
    expect(getPathPlayback(saved, 9)).toBeNull();
    expect(getPathPlayback(saved, -1)).toBeNull();
    expect(getPathPlayback(saved, 1.5)).toBeNull();
  });

  it("does not fabricate playback when the path is empty or fully unavailable", () => {
    expect(getPathPlayback(path([]))).toBeNull();
    expect(getPathPlayback(path([track(1, false)]))).toBeNull();
  });

  it("keeps legacy paths without availability metadata playable in their original order", () => {
    const saved = path([track(1), track(2)]);
    const playback = getPathPlayback(saved, 1);
    expect(playback?.index).toBe(1);
    expect(playback?.tracks.map((item) => item.libraryTrackId)).toEqual([1, 2]);
  });
});
