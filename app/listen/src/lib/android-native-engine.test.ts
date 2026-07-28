import { afterEach, describe, expect, it, vi } from "vitest";

const nativePlaybackMock = vi.hoisted(() => ({
  getState: vi.fn(),
  drainEvents: vi.fn(),
  setQueue: vi.fn(),
  appendTracks: vi.fn(),
  insertTrack: vi.fn(),
  removeTrack: vi.fn(),
  reorderTrack: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  stop: vi.fn(),
  seekTo: vi.fn(),
  jumpTo: vi.fn(),
  next: vi.fn(),
  previous: vi.fn(),
  setRepeat: vi.fn(),
  setCrossfadeMs: vi.fn(),
  setVolume: vi.fn(),
  setPlaybackRate: vi.fn(),
  setEq: vi.fn(),
  addListener: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  registerPlugin: () => nativePlaybackMock,
}));

describe("android native engine flags", () => {
  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.resetModules();
    vi.doUnmock("@/lib/capacitor-runtime");
  });

  it("uses the native player by default on Android native runtime", async () => {
    vi.doMock("@/lib/capacitor-runtime", () => ({ isAndroidNative: true }));
    const { shouldUseAndroidNativePlayer } = await import(
      "@/lib/android-native-engine"
    );

    expect(shouldUseAndroidNativePlayer()).toBe(true);
  });

  it("allows Android native playback to be disabled as a kill switch", async () => {
    vi.doMock("@/lib/capacitor-runtime", () => ({ isAndroidNative: true }));
    const { setAndroidNativePlayerEnabled, shouldUseAndroidNativePlayer } =
      await import("@/lib/android-native-engine");

    setAndroidNativePlayerEnabled(false);

    expect(shouldUseAndroidNativePlayer()).toBe(false);

    setAndroidNativePlayerEnabled(true);

    expect(shouldUseAndroidNativePlayer()).toBe(true);
  });

  it("ignores the flag outside Android native runtime", async () => {
    vi.doMock("@/lib/capacitor-runtime", () => ({ isAndroidNative: false }));
    const { shouldUseAndroidNativePlayer } = await import(
      "@/lib/android-native-engine"
    );

    expect(shouldUseAndroidNativePlayer()).toBe(false);
  });

  it("keeps the native player enabled with a legacy crossfade preference", async () => {
    vi.doMock("@/lib/capacitor-runtime", () => ({ isAndroidNative: true }));
    localStorage.setItem("listen-player-crossfade-seconds", "4");
    localStorage.setItem("crate-native-player-crossfade-enabled", "true");
    const { shouldUseAndroidNativePlayer } = await import(
      "@/lib/android-native-engine"
    );

    expect(shouldUseAndroidNativePlayer()).toBe(true);
    expect(
      localStorage.getItem("crate-native-player-crossfade-enabled"),
    ).toBeNull();
  });

  it("sends the active queue revision with native queue mutations", async () => {
    vi.doMock("@/lib/capacitor-runtime", () => ({ isAndroidNative: true }));
    const state = {
      revision: "queue-rev-1",
      playbackState: "paused",
      isPlaying: false,
      index: 0,
      positionMs: 0,
      durationMs: 0,
      queueSize: 1,
      crossfadeMs: 0,
      eqEnabled: false,
    };
    nativePlaybackMock.getState.mockResolvedValue(state);
    nativePlaybackMock.setQueue.mockResolvedValue(state);
    nativePlaybackMock.appendTracks.mockResolvedValue(state);
    const { AndroidNativeEngine } = await import("@/lib/android-native-engine");
    const engine = new AndroidNativeEngine();
    const track = {
      id: "track-1",
      url: "https://listen.example/api/tracks/1/stream",
      title: "Track One",
      artist: "Artist",
      authorization: "Bearer secret-token",
    };

    await engine.loadQueue({
      revision: "queue-rev-1",
      tracks: [track],
      currentIndex: 0,
      positionMs: 0,
      autoplay: false,
      repeat: "off",
      crossfadeMs: 4000,
      volume: 1,
    });
    await engine.appendTracks([track]);

    expect(nativePlaybackMock.appendTracks).toHaveBeenCalledWith({
      revision: "queue-rev-1",
      tracks: [track],
    });
    expect(
      nativePlaybackMock.setQueue.mock.calls[0]?.[0].tracks[0],
    ).toMatchObject({
      url: "https://listen.example/api/tracks/1/stream",
      authorization: "Bearer secret-token",
    });
    expect(nativePlaybackMock.setQueue).toHaveBeenCalledWith(
      expect.objectContaining({ crossfadeMs: 0 }),
    );

    await engine.setCrossfadeMs(5000);
    expect(nativePlaybackMock.setCrossfadeMs).toHaveBeenCalledWith({
      crossfadeMs: 0,
    });
  });

  it("retries readiness probes while the native service is binding", async () => {
    vi.useFakeTimers();
    vi.doMock("@/lib/capacitor-runtime", () => ({ isAndroidNative: true }));
    const state = {
      revision: "queue-rev-1",
      playbackState: "paused",
      isPlaying: false,
      index: 0,
      positionMs: 0,
      durationMs: 0,
      queueSize: 1,
      crossfadeMs: 0,
      eqEnabled: false,
    };
    nativePlaybackMock.getState
      .mockRejectedValueOnce(new Error("service binding"))
      .mockResolvedValue(state);
    nativePlaybackMock.setQueue.mockResolvedValue(state);
    nativePlaybackMock.addListener.mockResolvedValue({
      remove: vi.fn(),
    });
    const { AndroidNativeEngine } = await import("@/lib/android-native-engine");
    const engine = new AndroidNativeEngine();

    const loadPromise = engine.loadQueue({
      revision: "queue-rev-1",
      tracks: [],
      currentIndex: 0,
      positionMs: 0,
      autoplay: false,
      repeat: "off",
      crossfadeMs: 0,
      volume: 1,
    });

    await vi.advanceTimersByTimeAsync(150);
    expect(nativePlaybackMock.getState).toHaveBeenCalledTimes(2);
    await expect(loadPromise).resolves.toEqual(state);
    expect(nativePlaybackMock.addListener).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
