import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock, authState, ensureFreshAuthTokenMock, offlineUrlState } =
  vi.hoisted(() => ({
    apiMock: vi.fn(),
    authState: { token: "listen-token" },
    ensureFreshAuthTokenMock: vi.fn(),
    offlineUrlState: { url: null as string | null },
  }));

vi.mock("@/lib/api", () => ({
  api: apiMock,
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
  getOfflineNativePlaybackUrl: () => offlineUrlState.url,
}));

import {
  toEngineTrack,
  toFreshEngineTrack,
  toStartupEngineTracks,
} from "@/contexts/player-engine-adapter";
import { getPlaybackSession } from "@/lib/playback-provenance";

describe("player engine adapter", () => {
  beforeEach(() => {
    authState.token = "listen-token";
    apiMock.mockReset();
    ensureFreshAuthTokenMock.mockReset();
    ensureFreshAuthTokenMock.mockResolvedValue(true);
    offlineUrlState.url = null;
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

  it("resolves global catalog playback before handing URLs to the engine", async () => {
    apiMock.mockResolvedValueOnce({
      stream_url: "/api/federation/remote/streams/ticket-1",
      requested_policy: "original",
      effective_policy: "balanced",
      source: {},
      delivery: {},
      transcoded: false,
      cache_hit: false,
      preparing: false,
      task_id: null,
      variant_id: null,
      variant_status: null,
      playback_session: "signed-global-playback",
      content_origin: "remote",
    });

    const sourceTrack = {
      id: "global-track-1",
      globalTrackUid: "global-track-1",
      title: "Remote Song",
      artist: "Remote Band",
    };
    const track = await toFreshEngineTrack(sourceTrack);

    expect(apiMock).toHaveBeenCalledWith(
      "/api/catalog/tracks/global-track-1/playback",
    );
    expect(track.url).toBe(
      "https://listen.example/api/federation/remote/streams/ticket-1?token=listen-token",
    );
    expect(track.url).not.toContain(
      "/api/catalog/tracks/global-track-1/stream",
    );
    expect(getPlaybackSession(sourceTrack)).toBe("signed-global-playback");
  });

  it("keeps an offline file URI instead of resolving global playback", async () => {
    offlineUrlState.url =
      "file:///data/user/0/app.cratemusic.crate/files/offline/song.m4a";
    const sourceTrack = {
      id: "global-track-offline",
      globalTrackUid: "global-track-offline",
      entityUid: "entity-track-offline",
      title: "Offline Song",
      artist: "Offline Band",
    };

    const track = await toFreshEngineTrack(sourceTrack, undefined, {
      target: "android-native",
    });

    expect(apiMock).not.toHaveBeenCalled();
    expect(track.url).toBe(
      "file:///data/user/0/app.cratemusic.crate/files/offline/song.m4a",
    );
  });

  it("reuses fresh remote stream tickets before resolving global catalog playback again", async () => {
    const track = await toFreshEngineTrack({
      id: "global-track-1",
      globalTrackUid: "global-track-1",
      origin: "remote",
      remote: {
        nodeUid: "node-b",
        nodeName: "Node B",
        remoteEntityUid: "remote-track-1",
        streamUrl: "/api/federation/remote/streams/ticket-existing",
        streamUrlExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        availability: { catalog: true, stream: true, import: false },
      },
      title: "Remote Song",
      artist: "Remote Band",
    });

    expect(apiMock).not.toHaveBeenCalled();
    expect(track.url).toBe(
      "https://listen.example/api/federation/remote/streams/ticket-existing",
    );
  });

  it("resolves only the active global track before loading a queue", async () => {
    apiMock.mockResolvedValueOnce({
      stream_url: "/api/federation/remote/streams/ticket-current",
      requested_policy: "original",
      effective_policy: "balanced",
      source: {},
      delivery: {},
      transcoded: false,
      cache_hit: false,
      preparing: false,
      task_id: null,
      variant_id: null,
      variant_status: null,
      playback_session: "signed-current-playback",
      content_origin: "remote",
    });
    const queue = [
      {
        id: "global-track-current",
        globalTrackUid: "global-track-current",
        title: "Current Song",
        artist: "Remote Band",
      },
      {
        id: "global-track-next",
        globalTrackUid: "global-track-next",
        title: "Next Song",
        artist: "Remote Band",
      },
    ];

    const tracks = await toStartupEngineTracks(queue, 0);

    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith(
      "/api/catalog/tracks/global-track-current/playback",
    );
    expect(tracks[0]?.url).toContain("ticket-current");
    expect(tracks[1]?.url).toContain(
      "/api/catalog/tracks/global-track-next/stream",
    );
  });
});
