import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  apiMock,
  runtimeMock,
  nativeCapabilitiesMock,
  nativeControlMock,
  nativeListenerMock,
  sessionChangedListeners,
} = vi.hoisted(() => ({
  apiMock: vi.fn(),
  runtimeMock: { isNative: false },
  nativeCapabilitiesMock: vi.fn(),
  nativeControlMock: vi.fn(),
  nativeListenerMock: vi.fn(),
  sessionChangedListeners: [] as Array<(event: { active: boolean }) => void>,
}));

vi.mock("@capacitor/core", () => ({
  registerPlugin: () => ({
    getCapabilities: nativeCapabilitiesMock,
    play: nativeControlMock,
    pause: nativeControlMock,
    stop: nativeControlMock,
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
  getCastSenderCapabilities,
  isCastSessionActive,
  startCastSession,
} from "@/lib/cast-sender";

describe("cast sender", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeMock.isNative = false;
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
});
