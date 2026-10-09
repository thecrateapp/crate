import { afterEach, describe, expect, it, vi } from "vitest";
import type { EngineTransitionPlan } from "@/lib/playback-engine";

const nativePlaybackMock = vi.hoisted(() => ({
  getState: vi.fn(),
  drainEvents: vi.fn(),
  setQueue: vi.fn(),
  setTransitionPlans: vi.fn(),
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
    vi.unstubAllEnvs();
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

  it("loads the queue before plans arrive and installs them for the current revision", async () => {
    vi.doMock("@/lib/capacitor-runtime", () => ({ isAndroidNative: true }));
    const state = {
      revision: "queue-rev-1",
      playbackState: "paused",
      isPlaying: false,
      index: 0,
      positionMs: 0,
      durationMs: 0,
      queueSize: 2,
      crossfadeMs: 0,
      eqEnabled: false,
    };
    nativePlaybackMock.getState.mockResolvedValue(state);
    nativePlaybackMock.setQueue.mockResolvedValue(state);
    nativePlaybackMock.setTransitionPlans.mockResolvedValue({ accepted: true });
    const { AndroidNativeEngine } = await import("@/lib/android-native-engine");
    const engine = new AndroidNativeEngine();
    const plan = {
      plannerVersion: 2,
      outgoingTrackId: "track-1",
      incomingTrackId: "track-2",
    } as unknown as EngineTransitionPlan;
    let resolveCurrent: (plans: EngineTransitionPlan[]) => void = () => {};
    let resolveStale: (plans: EngineTransitionPlan[]) => void = () => {};
    const queue = {
      tracks: [],
      currentIndex: 0,
      positionMs: 0,
      autoplay: false,
      repeat: "off" as const,
      crossfadeMs: 0,
      volume: 1,
    };

    await engine.loadQueue({
      ...queue,
      revision: "queue-rev-0",
      pendingTransitionPlans: new Promise((resolve) => {
        resolveStale = resolve;
      }),
    });
    await engine.loadQueue({
      ...queue,
      revision: "queue-rev-1",
      pendingTransitionPlans: new Promise((resolve) => {
        resolveCurrent = resolve;
      }),
    });

    expect(nativePlaybackMock.setQueue).toHaveBeenCalledTimes(2);
    expect(nativePlaybackMock.setQueue.mock.calls[1]?.[0]).not.toHaveProperty(
      "pendingTransitionPlans",
    );
    expect(nativePlaybackMock.setTransitionPlans).not.toHaveBeenCalled();

    resolveStale([plan]);
    resolveCurrent([plan]);
    await vi.waitFor(() =>
      expect(nativePlaybackMock.setTransitionPlans).toHaveBeenCalledTimes(1),
    );
    expect(nativePlaybackMock.setTransitionPlans).toHaveBeenCalledWith({
      revision: "queue-rev-1",
      transitionPlans: [plan],
    });
  });

  it("forwards the requested crossfade once the server enables native mixing", async () => {
    vi.doMock("@/lib/capacitor-runtime", () => ({ isAndroidNative: true }));
    const state = {
      revision: "queue-rev-1",
      playbackState: "paused",
      isPlaying: false,
      index: 0,
      positionMs: 0,
      durationMs: 0,
      queueSize: 2,
      crossfadeMs: 4000,
      eqEnabled: false,
    };
    nativePlaybackMock.getState.mockResolvedValue(state);
    nativePlaybackMock.setQueue.mockResolvedValue(state);
    const nativeEngineModule = await import("@/lib/android-native-engine");
    const queue = {
      revision: "queue-rev-1",
      tracks: [],
      currentIndex: 0,
      positionMs: 0,
      autoplay: false,
      repeat: "off" as const,
      crossfadeMs: 4000,
      volume: 1,
    };

    expect("setAndroidNativeSmartMixRolloutEnabled" in nativeEngineModule).toBe(
      false,
    );
    const engine = new nativeEngineModule.AndroidNativeEngine();
    await engine.loadQueue(queue);
    expect(nativePlaybackMock.setQueue).toHaveBeenLastCalledWith(
      expect.objectContaining({ crossfadeMs: 0 }),
    );

    nativeEngineModule.setAndroidNativeSmartMixCapabilities({
      available: true,
      androidNativeCrossfade: true,
      androidBeatmatch: false,
    });
    await engine.loadQueue(queue);
    expect(nativePlaybackMock.setQueue).toHaveBeenLastCalledWith(
      expect.objectContaining({ crossfadeMs: 4000 }),
    );

    nativeEngineModule.setAndroidNativeSmartMixKillSwitch(true);
    await engine.loadQueue(queue);
    expect(nativePlaybackMock.setQueue).toHaveBeenLastCalledWith(
      expect.objectContaining({ crossfadeMs: 0 }),
    );
  });

  it("applies a Smart Mix opt-out to the loaded native queue", async () => {
    vi.doMock("@/lib/capacitor-runtime", () => ({ isAndroidNative: true }));
    const state = {
      revision: "queue-rev-1",
      playbackState: "playing",
      isPlaying: true,
      index: 0,
      positionMs: 0,
      durationMs: 180_000,
      queueSize: 2,
      crossfadeMs: 6000,
      eqEnabled: false,
    };
    nativePlaybackMock.getState.mockResolvedValue(state);
    nativePlaybackMock.setQueue.mockResolvedValue(state);
    nativePlaybackMock.setCrossfadeMs.mockResolvedValue(state);
    const nativeEngineModule = await import("@/lib/android-native-engine");
    const prefs = await import("@/lib/player-playback-prefs");
    nativeEngineModule.setAndroidNativeSmartMixCapabilities({
      available: true,
      androidNativeCrossfade: true,
      androidBeatmatch: false,
    });
    const engine = new nativeEngineModule.AndroidNativeEngine();
    await engine.loadQueue({
      revision: "queue-rev-1",
      tracks: [],
      currentIndex: 0,
      positionMs: 0,
      autoplay: true,
      repeat: "off",
      crossfadeMs: 6000,
      volume: 1,
    });

    prefs.setNativeSmartMixEnabledPreference(false);
    await vi.waitFor(() =>
      expect(nativePlaybackMock.setCrossfadeMs).toHaveBeenLastCalledWith({
        crossfadeMs: 0,
      }),
    );

    prefs.setNativeSmartMixEnabledPreference(true);
    prefs.setNativeSmartMixSecondsPreference(9);
    await vi.waitFor(() =>
      expect(nativePlaybackMock.setCrossfadeMs).toHaveBeenLastCalledWith({
        crossfadeMs: 9000,
      }),
    );
  });

  it("allows an explicit local APK build to exercise native crossfade", async () => {
    vi.stubEnv("VITE_CRATE_SMART_MIX_LOCAL_TEST", "true");
    vi.stubEnv("VITE_CRATE_SMART_MIX_LOCAL_CROSSFADE_MS", "3000");
    vi.doMock("@/lib/capacitor-runtime", () => ({ isAndroidNative: true }));
    const state = {
      revision: "local-smart-mix",
      playbackState: "playing",
      isPlaying: true,
      index: 0,
      positionMs: 0,
      durationMs: 180_000,
      queueSize: 2,
      crossfadeMs: 3000,
      eqEnabled: true,
    };
    nativePlaybackMock.getState.mockResolvedValue(state);
    nativePlaybackMock.setQueue.mockResolvedValue(state);
    const { AndroidNativeEngine } = await import("@/lib/android-native-engine");
    const engine = new AndroidNativeEngine();

    const queue = {
      revision: "local-smart-mix",
      tracks: [],
      currentIndex: 0,
      positionMs: 0,
      autoplay: true,
      repeat: "off" as const,
      volume: 1,
    };

    await engine.loadQueue({ ...queue, crossfadeMs: 6000 });
    expect(nativePlaybackMock.setQueue).toHaveBeenLastCalledWith(
      expect.objectContaining({ crossfadeMs: 3000 }),
    );

    await engine.loadQueue({ ...queue, crossfadeMs: 0 });
    expect(nativePlaybackMock.setQueue).toHaveBeenLastCalledWith(
      expect.objectContaining({ crossfadeMs: 0 }),
    );
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

  it("waits for the native service before draining cold-start events", async () => {
    vi.useFakeTimers();
    vi.doMock("@/lib/capacitor-runtime", () => ({ isAndroidNative: true }));
    nativePlaybackMock.getState.mockRejectedValue(new Error("service binding"));
    nativePlaybackMock.drainEvents.mockResolvedValue({ events: [] });
    let signalReady!: () => void;
    nativePlaybackMock.addListener.mockImplementation(
      (event: string, listener: () => void) => {
        if (event === "ready") signalReady = listener;
        return Promise.resolve({ remove: vi.fn() });
      },
    );
    const { AndroidNativeEngine } = await import("@/lib/android-native-engine");
    const engine = new AndroidNativeEngine();

    const eventsPromise = engine.drainEvents();
    await vi.advanceTimersByTimeAsync(350);

    expect(nativePlaybackMock.drainEvents).not.toHaveBeenCalled();
    expect(nativePlaybackMock.addListener).toHaveBeenCalledWith(
      "ready",
      expect.any(Function),
    );

    signalReady();

    await expect(eventsPromise).resolves.toEqual([]);
    expect(nativePlaybackMock.drainEvents).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("waits for the native service before reading cold-start state", async () => {
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
      .mockRejectedValueOnce(new Error("service binding"))
      .mockRejectedValueOnce(new Error("service binding"))
      .mockResolvedValue(state);
    let signalReady!: () => void;
    nativePlaybackMock.addListener.mockImplementation(
      (event: string, listener: () => void) => {
        if (event === "ready") signalReady = listener;
        return Promise.resolve({ remove: vi.fn() });
      },
    );
    const { AndroidNativeEngine } = await import("@/lib/android-native-engine");
    const engine = new AndroidNativeEngine();

    const statePromise = engine.getState();
    await vi.advanceTimersByTimeAsync(350);

    expect(nativePlaybackMock.getState).toHaveBeenCalledTimes(3);
    signalReady();

    await expect(statePromise).resolves.toEqual(state);
    expect(nativePlaybackMock.getState).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });
});
