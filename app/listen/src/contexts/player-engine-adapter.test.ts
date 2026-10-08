import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  apiMock,
  authState,
  ensureFreshAuthTokenMock,
  ensureMediaAccessUrlMock,
  offlineUrlState,
} = vi.hoisted(() => ({
  apiMock: vi.fn(),
  authState: { token: "listen-token" },
  ensureFreshAuthTokenMock: vi.fn(),
  ensureMediaAccessUrlMock: vi.fn(),
  offlineUrlState: { url: null as string | null },
}));

vi.mock("@/lib/api", () => ({
  api: apiMock,
  getApiBase: () => "https://listen.example",
  getAuthToken: () => authState.token,
  ensureFreshAuthToken: ensureFreshAuthTokenMock,
  ensureMediaAccessUrl: ensureMediaAccessUrlMock,
  apiStreamUrl: (url: string) => url,
  resolveMaybeApiStreamUrl: (url: string | null | undefined) =>
    url?.startsWith("/api/") ? `https://listen.example${url}` : url ?? null,
  resolveMaybeApiAssetUrl: (url: string | null | undefined) =>
    url?.startsWith("/api/")
      ? `https://listen.example${url}${url.includes("?") ? "&" : "?"}token=${
          authState.token
        }`
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
  toStartupEngineQueueSnapshot,
  toStartupEngineTracks,
} from "@/contexts/player-engine-adapter";
import { getPlaybackSession } from "@/lib/playback-provenance";
import { setSmartMixCapabilities } from "@/lib/smart-mix";

describe("player engine adapter", () => {
  beforeEach(() => {
    authState.token = "listen-token";
    apiMock.mockReset();
    ensureFreshAuthTokenMock.mockReset();
    ensureFreshAuthTokenMock.mockResolvedValue(true);
    ensureMediaAccessUrlMock.mockReset();
    ensureMediaAccessUrlMock.mockImplementation(async (url: string) => url);
    offlineUrlState.url = null;
    setSmartMixCapabilities({
      available: false,
      androidNativeCrossfade: false,
      androidBeatmatch: false,
      plannerVersion: null,
    });
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

    const track = await toFreshEngineTrack(
      {
        id: "track-1",
        entityUid: "entity-1",
        title: "Track One",
        artist: "Artist",
      },
      undefined,
      { target: "android-native" },
    );

    expect(ensureFreshAuthTokenMock).toHaveBeenCalledTimes(1);
    expect(track.url).not.toContain("token=");
    expect(track.authorization).toBe("Bearer fresh-token");
  });

  it("never forwards the Crate bearer to an external media origin", () => {
    const track = toEngineTrack(
      {
        id: "external-track",
        title: "External Track",
        artist: "External Artist",
      },
      undefined,
      "https://cdn.example.net/audio/track.flac",
      { target: "android-native" },
    );

    expect(track.url).toBe("https://cdn.example.net/audio/track.flac");
    expect(track.authorization).toBeUndefined();
  });

  it("gives native artwork a durable bearer without URL credentials", () => {
    const track = toEngineTrack(
      {
        id: "track-1",
        title: "Track One",
        artist: "Artist",
        albumCover: "/api/albums/1/cover?size=512",
      },
      undefined,
      undefined,
      { target: "android-native" },
    );

    expect(track.artwork).toBe(
      "https://listen.example/api/albums/1/cover?size=512",
    );
    expect(track.artworkAuthorization).toBe("Bearer listen-token");
  });

  it("never forwards the Crate bearer to external native artwork", () => {
    const track = toEngineTrack(
      {
        id: "track-1",
        title: "Track One",
        artist: "Artist",
        albumCover: "https://covers.example.net/albums/1.jpg",
      },
      undefined,
      undefined,
      { target: "android-native" },
    );

    expect(track.artwork).toBe("https://covers.example.net/albums/1.jpg");
    expect(track.artworkAuthorization).toBeUndefined();
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
    const track = await toFreshEngineTrack(sourceTrack, undefined, {
      target: "android-native",
    });

    expect(apiMock).toHaveBeenCalledWith(
      "/api/catalog/tracks/global-track-1/playback",
    );
    expect(track.url).toBe(
      "https://listen.example/api/federation/remote/streams/ticket-1",
    );
    expect(track.authorization).toBe("Bearer listen-token");
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

  it("starts offline-only queues without refreshing auth or resolving remote URLs", async () => {
    offlineUrlState.url = "asset://localhost/offline/song.m4a";

    const [track] = await toStartupEngineTracks(
      [
        {
          id: "offline-track",
          entityUid: "entity-offline",
          title: "Offline Song",
          artist: "Offline Band",
          offlineOnly: true,
        },
      ],
      0,
    );

    expect(track?.url).toBe("asset://localhost/offline/song.m4a");
    expect(ensureFreshAuthTokenMock).not.toHaveBeenCalled();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("does not fall back to a network stream when an offline-only asset is missing", async () => {
    await expect(
      toStartupEngineTracks(
        [
          {
            id: "offline-track",
            entityUid: "entity-offline",
            title: "Offline Song",
            artist: "Offline Band",
            offlineOnly: true,
          },
        ],
        0,
      ),
    ).rejects.toThrow("Offline track is not available on this device");

    expect(ensureFreshAuthTokenMock).not.toHaveBeenCalled();
    expect(apiMock).not.toHaveBeenCalled();
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

  it("resolves and tickets the active and next web tracks before loading a queue", async () => {
    apiMock
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValueOnce({
        stream_url: "/api/federation/remote/streams/ticket-next",
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
        playback_session: "signed-next-playback",
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

    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(apiMock).toHaveBeenCalledWith(
      "/api/catalog/tracks/global-track-current/playback",
    );
    expect(tracks[0]?.url).toContain("ticket-current");
    expect(apiMock).toHaveBeenCalledWith(
      "/api/catalog/tracks/global-track-next/playback",
    );
    expect(tracks[1]?.url).toContain("ticket-next");
    expect(ensureMediaAccessUrlMock).toHaveBeenCalledTimes(2);
    expect(ensureMediaAccessUrlMock).toHaveBeenNthCalledWith(
      1,
      "https://listen.example/api/federation/remote/streams/ticket-current",
      "stream",
    );
    expect(ensureMediaAccessUrlMock).toHaveBeenNthCalledWith(
      2,
      "https://listen.example/api/federation/remote/streams/ticket-next",
      "stream",
    );
  });

  it("keeps native queue artwork authenticated without expiring tickets", async () => {
    const queue = [
      {
        id: "track-current",
        entityUid: "entity-current",
        title: "Current Song",
        artist: "Band",
        albumCover: "/api/albums/1/cover?size=512",
      },
      {
        id: "track-next",
        entityUid: "entity-next",
        title: "Next Song",
        artist: "Band",
        albumCover: "/api/albums/2/cover?size=512",
      },
    ];

    const tracks = await toStartupEngineTracks(queue, 0, undefined, {
      target: "android-native",
    });

    expect(tracks.map((track) => track.artwork)).toEqual([
      "https://listen.example/api/albums/1/cover?size=512",
      "https://listen.example/api/albums/2/cover?size=512",
    ]);
    expect(tracks.map((track) => track.artworkAuthorization)).toEqual([
      "Bearer listen-token",
      "Bearer listen-token",
    ]);
  });

  it("carries bounded safe plans in native offline queue snapshots", async () => {
    offlineUrlState.url =
      "file:///data/user/0/app.cratemusic.crate/files/offline/song.m4a";
    const queue = [
      {
        id: "runtime-1",
        entityUid: "11111111-1111-4111-8111-111111111111",
        title: "One",
        artist: "Band A",
      },
      {
        id: "runtime-2",
        entityUid: "22222222-2222-4222-8222-222222222222",
        title: "Two",
        artist: "Band B",
      },
      {
        id: "runtime-3",
        entityUid: "33333333-3333-4333-8333-333333333333",
        title: "Three",
        artist: "Band C",
      },
    ];

    const snapshot = await toStartupEngineQueueSnapshot({
      revision: "offline-queue",
      tracks: queue,
      currentIndex: 0,
      positionMs: 1200,
      autoplay: true,
      repeat: "off",
      crossfadeMs: 3000,
      volume: 0.8,
      playSource: { type: "playlist", name: "Offline mix", id: 1 },
      shuffle: false,
      target: "android-native",
    });

    expect(
      snapshot.tracks.every((track) => track.url.startsWith("file:")),
    ).toBe(true);
    expect(snapshot.transitionPlans).toHaveLength(2);
    expect(snapshot.transitionPlans?.[0]).toMatchObject({
      outgoingTrackId: "runtime-1",
      incomingTrackId: "runtime-2",
      fallbackReason: "capability_unavailable",
    });
    expect(JSON.parse(JSON.stringify(snapshot)).transitionPlans).toEqual(
      snapshot.transitionPlans,
    );
  });

  describe("native Smart Mix startup planning", () => {
    const NATIVE_QUEUE = [
      {
        id: "runtime-1",
        entityUid: "11111111-1111-4111-8111-111111111111",
        title: "One",
        artist: "Band A",
      },
      {
        id: "runtime-2",
        entityUid: "22222222-2222-4222-8222-222222222222",
        title: "Two",
        artist: "Band B",
      },
    ];

    function nativeSnapshotOptions(revision: string) {
      return {
        revision,
        tracks: NATIVE_QUEUE,
        currentIndex: 0,
        positionMs: 0,
        autoplay: true,
        repeat: "off" as const,
        crossfadeMs: 3000,
        volume: 1,
        playSource: { type: "playlist" as const, name: "Mix", id: 1 },
        shuffle: false,
        target: "android-native" as const,
      };
    }

    beforeEach(() => {
      setSmartMixCapabilities({
        available: true,
        androidNativeCrossfade: true,
        androidBeatmatch: false,
        plannerVersion: "smart-mix-v1",
      });
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it("loads the queue within the planning deadline when the planner hangs", async () => {
      vi.useFakeTimers();
      apiMock.mockImplementation(
        (
          path: string,
          _method: string,
          _body: unknown,
          options?: { signal?: AbortSignal },
        ) =>
          path === "/api/playback/transition-plans"
            ? new Promise((_resolve, reject) => {
                options?.signal?.addEventListener("abort", () =>
                  reject(new DOMException("Aborted", "AbortError")),
                );
              })
            : Promise.resolve(null),
      );

      const snapshotPromise = toStartupEngineQueueSnapshot(
        nativeSnapshotOptions("hanging-planner"),
      );
      await vi.advanceTimersByTimeAsync(1000);
      const snapshot = await snapshotPromise;

      expect(snapshot.tracks).toHaveLength(2);
      expect(snapshot.transitionPlans?.[0]?.fallbackReason).toBe(
        "planner_timeout",
      );
    });

    it("does not call the planner while the device is offline", async () => {
      vi.stubGlobal("navigator", { ...navigator, onLine: false });
      apiMock.mockResolvedValue(null);

      const snapshot = await toStartupEngineQueueSnapshot(
        nativeSnapshotOptions("offline-network"),
      );

      expect(apiMock).not.toHaveBeenCalledWith(
        "/api/playback/transition-plans",
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
      expect(snapshot.transitionPlans?.[0]?.fallbackReason).toBe("offline");
    });

    it("cancels in-flight planning when Smart Mix becomes unavailable", async () => {
      const signals: AbortSignal[] = [];
      apiMock.mockImplementation(
        (
          path: string,
          _method: string,
          _body: unknown,
          options?: { signal?: AbortSignal },
        ) => {
          if (path !== "/api/playback/transition-plans") {
            return Promise.resolve(null);
          }
          if (options?.signal) signals.push(options.signal);
          return new Promise((_resolve, reject) => {
            options?.signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
          });
        },
      );

      const snapshotPromise = toStartupEngineQueueSnapshot(
        nativeSnapshotOptions("disabled-mid-flight"),
      );
      await vi.waitFor(() => expect(signals).toHaveLength(1));
      setSmartMixCapabilities({
        available: false,
        androidNativeCrossfade: false,
        androidBeatmatch: false,
        plannerVersion: null,
      });

      expect(signals[0]?.aborted).toBe(true);
      const snapshot = await snapshotPromise;
      expect(snapshot.tracks).toHaveLength(2);
    });
  });

  it("keeps web and desktop snapshots on the legacy transition path", async () => {
    const snapshot = await toStartupEngineQueueSnapshot({
      revision: "web-queue",
      tracks: [
        {
          id: "runtime-1",
          entityUid: "11111111-1111-4111-8111-111111111111",
          title: "One",
          artist: "Band A",
        },
        {
          id: "runtime-2",
          entityUid: "22222222-2222-4222-8222-222222222222",
          title: "Two",
          artist: "Band B",
        },
      ],
      currentIndex: 0,
      positionMs: 0,
      autoplay: false,
      repeat: "off",
      crossfadeMs: 4000,
      volume: 1,
      playSource: { type: "playlist", name: "Web mix", id: 1 },
      shuffle: false,
      target: "webview",
    });

    expect(snapshot.transitionPlans).toBeUndefined();
  });
});
