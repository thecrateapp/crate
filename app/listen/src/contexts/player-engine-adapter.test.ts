import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  getApiBase: () => "https://listen.example",
  getAuthToken: () => "listen-token",
  resolveMaybeApiAssetUrl: (url: string | null | undefined) => (
    url?.startsWith("/api/")
      ? `https://listen.example${url}?token=listen-token`
      : (url ?? null)
  ),
}));

vi.mock("@/lib/offline", () => ({
  getOfflineNativePlaybackUrl: () => null,
}));

import { toEngineTrack } from "@/contexts/player-engine-adapter";

describe("player engine adapter", () => {
  it("sends absolute authenticated artwork URLs to the native player", () => {
    const track = toEngineTrack({
      id: "track-1",
      entityUid: "entity-1",
      title: "Track One",
      artist: "Artist",
      album: "Album",
      albumCover: "/api/albums/1/cover",
      duration: 187,
    });

    expect(track.artwork).toBe("https://listen.example/api/albums/1/cover?token=listen-token");
    expect(track.durationMs).toBe(187000);
  });

  it("omits per-track EQ gains unless they are explicitly provided", () => {
    const baseTrack = {
      id: "track-1",
      title: "Track One",
      artist: "Artist",
    };

    expect(toEngineTrack(baseTrack).eqGains).toBeUndefined();
    expect(toEngineTrack(baseTrack, [0, 1, 2]).eqGains).toEqual([0, 1, 2]);
  });
});
