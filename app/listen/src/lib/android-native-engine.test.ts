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

  it("keeps the native player disabled while web crossfade is active", async () => {
    vi.doMock("@/lib/capacitor-runtime", () => ({ isAndroidNative: true }));
    const { setCrossfadeDurationPreference } = await import(
      "@/lib/player-playback-prefs"
    );
    const { shouldUseAndroidNativePlayer } = await import(
      "@/lib/android-native-engine"
    );

    setCrossfadeDurationPreference(4);

    expect(shouldUseAndroidNativePlayer()).toBe(false);
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
    };

    await engine.loadQueue({
      revision: "queue-rev-1",
      tracks: [track],
      currentIndex: 0,
      positionMs: 0,
      autoplay: false,
      repeat: "off",
      crossfadeMs: 0,
      volume: 1,
    });
    await engine.appendTracks([track]);

    expect(nativePlaybackMock.appendTracks).toHaveBeenCalledWith({
      revision: "queue-rev-1",
      tracks: [track],
    });
  });
});
