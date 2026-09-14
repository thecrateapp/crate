import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  apiMock,
  ensureMediaAccessUrlMock,
  runtimeMock,
  nativeCapabilitiesMock,
  nativeControlMock,
  nativeEndSessionMock,
  nativeRequestSessionMock,
  nativeListenerMock,
  sessionChangedListeners,
} = vi.hoisted(() => ({
  apiMock: vi.fn(),
  ensureMediaAccessUrlMock: vi.fn(),
  runtimeMock: { isNative: false },
  nativeCapabilitiesMock: vi.fn(),
  nativeControlMock: vi.fn(),
  nativeEndSessionMock: vi.fn(),
  nativeRequestSessionMock: vi.fn(),
  nativeListenerMock: vi.fn(),
  sessionChangedListeners: [] as Array<(event: { active: boolean }) => void>,
}));

vi.mock("@capacitor/core", () => ({
  registerPlugin: () => ({
    getCapabilities: nativeCapabilitiesMock,
    play: nativeControlMock,
    pause: nativeControlMock,
    stop: nativeControlMock,
    endSession: nativeEndSessionMock,
    requestSession: nativeRequestSessionMock,
    addListener: nativeListenerMock.mockImplementation(
      (_event: string, listener: (event: { active: boolean }) => void) => {
        sessionChangedListeners.push(listener);
        return Promise.resolve({ remove: vi.fn() });
      },
    ),
  }),
}));

vi.mock("@/lib/api", () => ({
  api: apiMock,
  apiUrl: (path: string) => `https://crate.test${path}`,
  ensureMediaAccessUrl: ensureMediaAccessUrlMock,
}));

vi.mock("@/lib/capacitor-runtime", () => ({
  get isNative() {
    return runtimeMock.isNative;
  },
}));

import {
  buildCastTicketRequest,
  castPause,
  castPlay,
  castSeek,
  castSetVolume,
  castStop,
  endCastSession,
  getCastSenderCapabilities,
  isCastSessionActive,
  onCastSessionChanged,
  startCastSession,
  subscribeCastPlaybackState,
} from "@/lib/cast-sender";

describe("cast sender", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeMock.isNative = false;
    ensureMediaAccessUrlMock.mockImplementation(
      async (url: string) =>
        `${url}${url.includes("?") ? "&" : "?"}media_ticket=artwork-ticket`,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds auto delivery cast tickets from stable track references", () => {
    expect(
      buildCastTicketRequest(
        {
          id: "track-1",
          libraryTrackId: 7,
          entityUid: "11111111-1111-1111-1111-111111111111",
          path: "Artist/Album/track.flac",
          title: "Track",
          artist: "Artist",
        },
        "living-room",
      ),
    ).toMatchObject({
      track_id: 7,
      purpose: "google_cast",
      target_device_id: "living-room",
      delivery: "auto",
      receiver_capabilities: {
        formats: ["mp3", "aac", "m4a"],
      },
    });

    expect(
      buildCastTicketRequest({
        id: "path-only",
        path: "Artist/Album/path-only.flac",
        title: "Path Only",
        artist: "Artist",
      }),
    ).toMatchObject({
      track_path: "Artist/Album/path-only.flac",
      delivery: "auto",
    });
  });

  it("hides web Cast where the browser cannot host a sender", async () => {
    const chromeWindow = window as Window & { chrome?: unknown };
    const previousChrome = chromeWindow.chrome;
    delete chromeWindow.chrome;

    const capabilities = await getCastSenderCapabilities();

    expect(capabilities).toMatchObject({
      platform: "unsupported",
      visible: false,
      available: false,
      activeSession: false,
    });
    chromeWindow.chrome = previousChrome;
  });

  it("hides native Cast when the platform build has no sender SDK", async () => {
    runtimeMock.isNative = true;
    nativeCapabilitiesMock.mockResolvedValueOnce({
      platform: "native",
      visible: false,
      available: false,
      activeSession: false,
      reason: "Google Cast SDK is not linked in this iOS build.",
    });

    const capabilities = await getCastSenderCapabilities();

    expect(capabilities).toMatchObject({
      platform: "native",
      visible: false,
      available: false,
      activeSession: false,
    });
  });

  it("reports web Cast unavailable when the SDK finds no receivers", async () => {
    const context = {
      setOptions: vi.fn(),
      getCurrentSession: vi.fn(() => null),
      getCastState: vi.fn(() => "NO_DEVICES_AVAILABLE"),
      requestSession: vi.fn(),
      endCurrentSession: vi.fn(),
    };
    Object.assign(window, {
      cast: {
        framework: {
          CastContext: { getInstance: () => context },
          CastState: { NO_DEVICES_AVAILABLE: "NO_DEVICES_AVAILABLE" },
        },
      },
      chrome: {
        cast: {
          AutoJoinPolicy: { ORIGIN_SCOPED: "origin_scoped" },
          media: { DEFAULT_MEDIA_RECEIVER_APP_ID: "CC1AD845" },
        },
      },
    });

    await expect(getCastSenderCapabilities()).resolves.toMatchObject({
      platform: "web",
      visible: true,
      available: false,
      activeSession: false,
      reason: "No Cast receivers found on this network.",
    });
  });

  it("forwards web Cast lifecycle changes to Listen", async () => {
    const sdkListeners = new Map<string, () => void>();
    const context = {
      setOptions: vi.fn(),
      getCurrentSession: vi.fn(() => null),
      getCastState: vi.fn(() => "NOT_CONNECTED"),
      requestSession: vi.fn(),
      endCurrentSession: vi.fn(),
      addEventListener: vi.fn((event: string, listener: () => void) => {
        sdkListeners.set(event, listener);
      }),
    };
    Object.assign(window, {
      cast: {
        framework: {
          CastContext: { getInstance: () => context },
          CastContextEventType: {
            CAST_STATE_CHANGED: "CAST_STATE_CHANGED",
            SESSION_STATE_CHANGED: "SESSION_STATE_CHANGED",
          },
        },
      },
      chrome: {
        cast: {
          AutoJoinPolicy: { ORIGIN_SCOPED: "origin_scoped" },
          media: { DEFAULT_MEDIA_RECEIVER_APP_ID: "CC1AD845" },
        },
      },
    });
    const listener = vi.fn();
    const cleanup = onCastSessionChanged(listener);

    await getCastSenderCapabilities();
    sdkListeners.get("SESSION_STATE_CHANGED")?.();

    expect(listener).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("does not request tickets when the track has no cast reference", async () => {
    const result = await startCastSession({
      track: {
        id: "ephemeral",
        title: "Ephemeral",
        artist: "Artist",
      },
    });

    expect(result).toEqual({
      ok: false,
      message: "This track does not expose a Cast-capable library reference.",
    });
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("opens the web Cast picker before preparing receiver media", async () => {
    const calls: string[] = [];
    const session = {
      loadMedia: vi.fn(async () => undefined),
      getCastDevice: () => ({ friendlyName: "Living Room" }),
    };
    const context = {
      setOptions: vi.fn(),
      getCurrentSession: vi.fn(() => null),
      requestSession: vi.fn(async () => {
        calls.push("picker");
        return session;
      }),
    };
    Object.assign(window, {
      cast: {
        framework: {
          CastContext: {
            getInstance: () => context,
          },
        },
      },
      chrome: {
        cast: {
          AutoJoinPolicy: { ORIGIN_SCOPED: "origin_scoped" },
          Image: class {},
          media: {
            DEFAULT_MEDIA_RECEIVER_APP_ID: "CC1AD845",
            LoadRequest: class {},
            MediaInfo: class {},
            MusicTrackMediaMetadata: class {},
          },
        },
      },
    });
    apiMock.mockImplementation(async () => {
      calls.push("ticket");
      return {
        stream_url: "https://stream.example/track",
        metadata_url: "https://stream.example/metadata",
        expires_at: "2030-01-01T00:00:00Z",
        delivery_policy: "direct",
      };
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      calls.push("metadata");
      return new Response(
        JSON.stringify({
          stream_url: "https://stream.example/track",
          title: "Track",
          artist: "Artist",
        }),
        { status: 200 },
      );
    });

    await expect(
      startCastSession({
        track: {
          id: "track-1",
          libraryTrackId: 1,
          title: "Track",
          artist: "Artist",
        },
      }),
    ).resolves.toMatchObject({ ok: true, targetName: "Living Room" });

    expect(calls).toEqual(["picker", "ticket", "metadata"]);
    expect(session.loadMedia).toHaveBeenCalledOnce();
  });

  it("sends media controls to the active web Cast session", async () => {
    const calls: string[] = [];
    const media = {
      pause: (_request: unknown, success: () => void) => {
        calls.push("pause");
        success();
      },
      play: (_request: unknown, success: () => void) => {
        calls.push("play");
        success();
      },
      seek: (request: { currentTime?: number }, success: () => void) => {
        calls.push(`seek:${request.currentTime}`);
        success();
      },
      setVolume: (
        request: { volume?: { level?: number } },
        success: () => void,
      ) => {
        calls.push(`volume:${request.volume?.level}`);
        success();
      },
      stop: (_request: unknown, success: () => void) => {
        calls.push("stop");
        success();
      },
    };
    const context = {
      setOptions: vi.fn(),
      getCurrentSession: vi.fn(() => ({
        getMediaSession: () => media,
        getCastDevice: () => ({ friendlyName: "Living Room" }),
      })),
      requestSession: vi.fn(),
    };
    Object.assign(window, {
      cast: {
        framework: {
          CastContext: {
            getInstance: () => context,
          },
        },
      },
      chrome: {
        cast: {
          AutoJoinPolicy: { ORIGIN_SCOPED: "origin_scoped" },
          Volume: class {
            level?: number;
            muted?: boolean;
            constructor(level?: number, muted?: boolean) {
              this.level = level;
              this.muted = muted;
            }
          },
          media: {
            DEFAULT_MEDIA_RECEIVER_APP_ID: "CC1AD845",
            PauseRequest: class {},
            PlayRequest: class {},
            SeekRequest: class {
              currentTime?: number;
            },
            StopRequest: class {},
            VolumeRequest: class {
              volume: { level?: number };
              constructor(volume: { level?: number }) {
                this.volume = volume;
              }
            },
            LoadRequest: class {},
            MediaInfo: class {},
            MusicTrackMediaMetadata: class {},
          },
        },
      },
    });

    expect(isCastSessionActive()).toBe(true);
    await expect(castPause()).resolves.toEqual({ ok: true });
    await expect(castSeek(42)).resolves.toEqual({ ok: true });
    await expect(castSetVolume(0.7)).resolves.toEqual({ ok: true });
    expect(calls).toEqual(["pause", "seek:42", "volume:0.7"]);
  });

  it("publishes estimated progress from the active web Cast media", async () => {
    vi.useFakeTimers();
    let estimatedTime = 12.5;
    const updateListeners = new Set<(isAlive: boolean) => void>();
    const media = {
      currentTime: 12,
      playerState: "PLAYING",
      media: { duration: 180 },
      volume: { level: 0.65 },
      getEstimatedTime: () => estimatedTime,
      addUpdateListener: vi.fn((listener: (isAlive: boolean) => void) => {
        updateListeners.add(listener);
      }),
      removeUpdateListener: vi.fn((listener: (isAlive: boolean) => void) => {
        updateListeners.delete(listener);
      }),
    };
    const context = {
      setOptions: vi.fn(),
      getCurrentSession: vi.fn(() => ({
        getMediaSession: () => media,
        getCastDevice: () => ({ friendlyName: "Living Room" }),
      })),
      requestSession: vi.fn(),
      addEventListener: vi.fn(),
    };
    Object.assign(window, {
      cast: {
        framework: {
          CastContext: { getInstance: () => context },
          CastContextEventType: {
            CAST_STATE_CHANGED: "CAST_STATE_CHANGED",
            SESSION_STATE_CHANGED: "SESSION_STATE_CHANGED",
          },
        },
      },
      chrome: {
        cast: {
          AutoJoinPolicy: { ORIGIN_SCOPED: "origin_scoped" },
          media: { DEFAULT_MEDIA_RECEIVER_APP_ID: "CC1AD845" },
        },
      },
    });
    const listener = vi.fn();

    const unsubscribe = subscribeCastPlaybackState(listener);

    expect(listener).toHaveBeenLastCalledWith({
      active: true,
      currentTime: 12.5,
      duration: 180,
      isBuffering: false,
      isPlaying: true,
      volume: 0.65,
    });
    estimatedTime = 13;
    await vi.advanceTimersByTimeAsync(500);
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentTime: 13 }),
    );

    unsubscribe();
    expect(media.removeUpdateListener).toHaveBeenCalledOnce();
  });

  it("ends the active web Cast session", async () => {
    let activeSession: object | null = {};
    const endCurrentSession = vi.fn(() => {
      activeSession = null;
    });
    const context = {
      setOptions: vi.fn(),
      getCurrentSession: vi.fn(() => activeSession),
      requestSession: vi.fn(),
      endCurrentSession,
    };
    Object.assign(window, {
      cast: {
        framework: {
          CastContext: {
            getInstance: () => context,
          },
        },
      },
      chrome: {
        cast: {
          AutoJoinPolicy: { ORIGIN_SCOPED: "origin_scoped" },
          media: { DEFAULT_MEDIA_RECEIVER_APP_ID: "CC1AD845" },
        },
      },
    });

    await expect(endCastSession()).resolves.toEqual({ ok: true });
    expect(endCurrentSession).toHaveBeenCalledWith(true);
    expect(isCastSessionActive()).toBe(false);
  });

  it("reflects a native session ending for reasons the app never asked for", async () => {
    runtimeMock.isNative = true;
    nativeControlMock.mockResolvedValue({ ok: true });

    // Establish a session the way the app normally would.
    await castPlay();
    expect(isCastSessionActive()).toBe(true);

    // The native side ends the session on its own (receiver closed
    // remotely, TV turned off, route dropped) and notifies listeners —
    // before this fix, isCastSessionActive() had no way to hear about it.
    expect(sessionChangedListeners.length).toBeGreaterThan(0);
    sessionChangedListeners.forEach((listener) => listener({ active: false }));

    expect(isCastSessionActive()).toBe(false);
  });

  it("does not treat a successful stop as the Cast session ending", async () => {
    runtimeMock.isNative = true;
    nativeControlMock.mockResolvedValue({ ok: true });

    await castPlay();
    expect(isCastSessionActive()).toBe(true);

    // stop() only stops the receiver's current media — it does not end
    // the Cast session, so the app should still be able to play again
    // without re-picking a device.
    await expect(castStop()).resolves.toEqual({ ok: true });
    expect(isCastSessionActive()).toBe(true);
  });

  it("does not treat a rejected command as the Cast session ending", async () => {
    runtimeMock.isNative = true;
    nativeControlMock.mockResolvedValue({ ok: true });

    await castPlay();
    expect(isCastSessionActive()).toBe(true);

    // A transient pause rejection (e.g. the receiver briefly refused the
    // command) is not proof the device disconnected — only the
    // sessionChanged listener or a fresh capabilities read gets to say
    // that.
    nativeControlMock.mockResolvedValueOnce({
      ok: false,
      message: "Cast command was rejected by the receiver.",
    });
    await expect(castPause()).resolves.toEqual({
      ok: false,
      message: "Cast command was rejected by the receiver.",
    });
    expect(isCastSessionActive()).toBe(true);
  });

  it("does not let a late command success resurrect a disconnected session", async () => {
    runtimeMock.isNative = true;
    let resolveCommand: ((result: { ok: boolean }) => void) | undefined;
    nativeControlMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCommand = resolve;
      }),
    );

    const command = castPlay();
    await vi.waitFor(() => expect(nativeControlMock).toHaveBeenCalled());
    sessionChangedListeners.forEach((listener) => listener({ active: false }));
    resolveCommand!({ ok: true });

    await expect(command).resolves.toEqual({ ok: true });
    expect(isCastSessionActive()).toBe(false);
  });

  it("does not let a late session request resurrect a disconnected session", async () => {
    runtimeMock.isNative = true;
    nativeCapabilitiesMock.mockResolvedValue({
      platform: "native",
      visible: true,
      available: true,
      activeSession: false,
    });
    apiMock.mockResolvedValue({
      stream_url: "https://stream.example/track",
      metadata_url: "https://stream.example/metadata",
      expires_at: "2030-01-01T00:00:00Z",
      delivery_policy: "direct",
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          stream_url: "https://stream.example/track",
          title: "Track",
          artist: "Artist",
        }),
        { status: 200 },
      ),
    );
    let resolveSession: ((result: { ok: boolean }) => void) | undefined;
    nativeRequestSessionMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSession = resolve;
      }),
    );

    const request = startCastSession({
      track: {
        id: "track-1",
        libraryTrackId: 1,
        title: "Track",
        artist: "Artist",
      },
    });
    await vi.waitFor(() => expect(nativeRequestSessionMock).toHaveBeenCalled());
    sessionChangedListeners.forEach((listener) => listener({ active: false }));
    resolveSession!({ ok: true });

    await expect(request).resolves.toEqual({ ok: true });
    expect(isCastSessionActive()).toBe(false);
  });

  it("serves protected Crate artwork from the receiver-reachable origin", async () => {
    runtimeMock.isNative = true;
    nativeCapabilitiesMock.mockResolvedValue({
      platform: "native",
      visible: true,
      available: true,
      activeSession: false,
    });
    nativeRequestSessionMock.mockResolvedValue({ ok: true });
    apiMock.mockResolvedValue({
      stream_url: "http://192.168.1.246:8585/api/cast/stream/ticket",
      metadata_url: "https://stream.example/metadata",
      expires_at: "2030-01-01T00:00:00Z",
      delivery_policy: "direct",
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          stream_url: "http://192.168.1.246:8585/api/cast/stream/ticket",
          title: "Track",
          artist: "Artist",
        }),
        { status: 200 },
      ),
    );

    await startCastSession({
      track: {
        id: "track-1",
        libraryTrackId: 1,
        title: "Track",
        artist: "Artist",
        albumCover: "/api/catalog/albums/album-1/cover?size=512",
      },
    });

    expect(ensureMediaAccessUrlMock).toHaveBeenCalledWith(
      "https://crate.test/api/catalog/albums/album-1/cover?size=512",
      "artwork",
    );
    expect(nativeRequestSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        artworkUrl:
          "http://192.168.1.246:8585/api/catalog/albums/album-1/cover?size=512&media_ticket=artwork-ticket",
      }),
    );
  });
});
