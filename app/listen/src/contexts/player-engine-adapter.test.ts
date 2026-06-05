import { beforeEach, describe, expect, it, vi } from "vitest";

const { authState, ensureFreshAuthTokenMock } = vi.hoisted(() => ({
  authState: { token: "listen-token" },
  ensureFreshAuthTokenMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  getApiBase: () => "https://listen.example",
  getAuthToken: () => authState.token,
  ensureFreshAuthToken: ensureFreshAuthTokenMock,
  resolveMaybeApiAssetUrl: (url: string | null | undefined) =>
    url?.startsWith("/api/")
      ? `https://listen.example${url}?token=${authState.token}`
      : url ?? null,
}));

vi.mock("@/lib/capacitor-runtime", () => ({
  isNative: true,
  isAndroidRuntime: true,
  isIosRuntime: false,
}));

vi.mock("@/lib/offline", () => ({
  getOfflineNativePlaybackUrl: () => null,
}));

import {
  toEngineTrack,
  toFreshEngineTrack,
} from "@/contexts/player-engine-adapter";

describe("player engine adapter", () => {
  beforeEach(() => {
    authState.token = "listen-token";
    ensureFreshAuthTokenMock.mockReset();
    ensureFreshAuthTokenMock.mockResolvedValue(true);
  });

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

    expect(track.artwork).toBe(
      "https://listen.example/api/albums/1/cover?token=listen-token",
    );
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

  it("refreshes auth before resolving native stream URLs", async () => {
    ensureFreshAuthTokenMock.mockImplementationOnce(async () => {
      authState.token = "fresh-token";
      return true;
    });

    const track = await toFreshEngineTrack({
      id: "track-1",
      entityUid: "entity-1",
      title: "Track One",
      artist: "Artist",
    });

    expect(ensureFreshAuthTokenMock).toHaveBeenCalledTimes(1);
    expect(track.url).toContain("token=fresh-token");
  });
});
