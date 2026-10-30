import { afterEach, describe, expect, it, vi } from "vitest";
import type { EngineTransitionPlan } from "@/lib/playback-engine";

const nativePlaybackMock = vi.hoisted(() => ({
  getState: vi.fn(),
  drainEvents: vi.fn(),
  setQueue: vi.fn(),
  setTransitionPlans: vi.fn(),
  setContinuation: vi.fn(),
  getAppendedTracks: vi.fn(),
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
  addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
}));

vi.mock("@capacitor/core", () => ({
  registerPlugin: () => nativePlaybackMock,
}));

const continuationTokenMock = vi.hoisted(() => vi.fn());
const invalidateContinuationTokenMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/playback-continuation", () => ({
  getPlaybackContinuationToken: continuationTokenMock,
  invalidatePlaybackContinuationToken: invalidateContinuationTokenMock,
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

  it("re-plans the loaded queue when capabilities arrive after it", async () => {
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
    const nativeEngineModule = await import("@/lib/android-native-engine");
    const engine = new nativeEngineModule.AndroidNativeEngine();
    const gapless = { mode: "gapless" } as unknown as EngineTransitionPlan;
    const adaptive = { mode: "adaptive" } as unknown as EngineTransitionPlan;
    const replanTransitionPlans = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue([adaptive]);

    await engine.loadQueue({
      revision: "queue-rev-1",
      tracks: [],
      currentIndex: 0,
      positionMs: 0,
      autoplay: false,
      repeat: "off",
      crossfadeMs: 12000,
      volume: 1,
      pendingTransitionPlans: Promise.resolve([gapless]),
      replanTransitionPlans,
    });
    await vi.waitFor(() =>
      expect(nativePlaybackMock.setTransitionPlans).toHaveBeenCalledTimes(1),
    );

    nativeEngineModule.setAndroidNativeSmartMixCapabilities({
      available: true,
      androidNativeCrossfade: true,
      androidBeatmatch: false,
      androidBassHandoff: false,
      androidLongBeatmatch: false,
    });

    await vi.waitFor(() =>
      expect(nativePlaybackMock.setTransitionPlans).toHaveBeenCalledTimes(2),
    );
    expect(replanTransitionPlans).toHaveBeenCalledTimes(2);
    expect(nativePlaybackMock.setTransitionPlans).toHaveBeenNthCalledWith(1, {
      revision: "queue-rev-1",
      transitionPlans: [gapless],
    });
    expect(nativePlaybackMock.setTransitionPlans).toHaveBeenLastCalledWith({
      revision: "queue-rev-1",
      transitionPlans: [adaptive],
    });
  });

  it("keeps installed server plans when a plan-ahead request times out", async () => {
    vi.doMock("@/lib/capacitor-runtime", () => ({ isAndroidNative: true }));
    const state = {
      revision: "queue-rev-1",
      playbackState: "playing",
      isPlaying: true,
      index: 0,
      positionMs: 0,
      durationMs: 0,
      queueSize: 3,
      crossfadeMs: 12000,
      eqEnabled: false,
    };
    nativePlaybackMock.getState.mockResolvedValue(state);
    nativePlaybackMock.setQueue.mockResolvedValue(state);
    nativePlaybackMock.setTransitionPlans.mockResolvedValue({ accepted: true });
    const nativeEngineModule = await import("@/lib/android-native-engine");
    const engine = new nativeEngineModule.AndroidNativeEngine();
    const serverPlan = {
      outgoingTrackId: "runtime-2",
      incomingTrackId: "runtime-3",
      mode: "adaptive",
      outgoingCueMs: 176000,
      fallbackReason: "low_confidence",
    } as unknown as EngineTransitionPlan;
    const timedOutSameEdge = {
      outgoingTrackId: "runtime-2",
      incomingTrackId: "runtime-3",
      mode: "adaptive",
      outgoingCueMs: 0,
      fallbackReason: "planner_timeout",
    } as unknown as EngineTransitionPlan;
    const timedOutNewEdge = {
      outgoingTrackId: "runtime-3",
      incomingTrackId: "runtime-4",
      mode: "adaptive",
      outgoingCueMs: 0,
      fallbackReason: "planner_timeout",
    } as unknown as EngineTransitionPlan;
    const replanTransitionPlans = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue([timedOutSameEdge, timedOutNewEdge]);

    await engine.loadQueue({
      revision: "queue-rev-1",
      tracks: [],
      currentIndex: 0,
      positionMs: 0,
      autoplay: false,
      repeat: "off",
      crossfadeMs: 12000,
      volume: 1,
      pendingTransitionPlans: Promise.resolve([serverPlan]),
      replanTransitionPlans,
    });
    await vi.waitFor(() =>
      expect(nativePlaybackMock.setTransitionPlans).toHaveBeenCalledTimes(1),
    );

    engine.planAhead(1);

    await vi.waitFor(() =>
      expect(nativePlaybackMock.setTransitionPlans).toHaveBeenCalledTimes(2),
    );
    expect(nativePlaybackMock.setTransitionPlans).toHaveBeenLastCalledWith({
      revision: "queue-rev-1",
      transitionPlans: [serverPlan, timedOutNewEdge],
    });
  });

  it("keeps re-planned plans when stale cold-start plans resolve later", async () => {
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
    const gapless = { mode: "gapless" } as unknown as EngineTransitionPlan;
    const adaptive = { mode: "adaptive" } as unknown as EngineTransitionPlan;
    let resolveStale: (plans: EngineTransitionPlan[]) => void = () => {};

    await engine.loadQueue({
      revision: "queue-rev-1",
      tracks: [],
      currentIndex: 0,
      positionMs: 0,
      autoplay: false,
      repeat: "off",
      crossfadeMs: 12000,
      volume: 1,
      pendingTransitionPlans: new Promise((resolve) => {
        resolveStale = resolve;
      }),
      replanTransitionPlans: () => Promise.resolve([adaptive]),
    });
    await vi.waitFor(() =>
      expect(nativePlaybackMock.setTransitionPlans).toHaveBeenCalledTimes(1),
    );
    resolveStale([gapless]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(nativePlaybackMock.setTransitionPlans).toHaveBeenCalledTimes(1);
    expect(nativePlaybackMock.setTransitionPlans).toHaveBeenCalledWith({
      revision: "queue-rev-1",
      transitionPlans: [adaptive],
    });
  });

  it("keeps plans re-planned while the queue load is still in flight", async () => {
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
    let finishSetQueue: (value: typeof state) => void = () => {};
    nativePlaybackMock.setQueue.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSetQueue = resolve;
        }),
    );
    nativePlaybackMock.setTransitionPlans.mockResolvedValue({ accepted: true });
    const nativeEngineModule = await import("@/lib/android-native-engine");
    const engine = new nativeEngineModule.AndroidNativeEngine();
    const gapless = { mode: "gapless" } as unknown as EngineTransitionPlan;
    const adaptive = { mode: "adaptive" } as unknown as EngineTransitionPlan;

    const loading = engine.loadQueue({
      revision: "queue-rev-1",
      tracks: [],
      currentIndex: 0,
      positionMs: 0,
      autoplay: false,
      repeat: "off",
      crossfadeMs: 12000,
      volume: 1,
      pendingTransitionPlans: Promise.resolve([gapless]),
      replanTransitionPlans: vi
        .fn()
        .mockResolvedValueOnce([adaptive])
        .mockResolvedValue(undefined),
    });
    await vi.waitFor(() =>
      expect(nativePlaybackMock.setQueue).toHaveBeenCalled(),
    );
    nativeEngineModule.setAndroidNativeSmartMixCapabilities({
      available: true,
      androidNativeCrossfade: true,
      androidBeatmatch: false,
      androidBassHandoff: false,
      androidLongBeatmatch: false,
    });
    await vi.waitFor(() =>
      expect(nativePlaybackMock.setTransitionPlans).toHaveBeenCalledTimes(1),
    );
    finishSetQueue(state);
    await loading;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(nativePlaybackMock.setTransitionPlans).toHaveBeenCalledTimes(1);
    expect(nativePlaybackMock.setTransitionPlans).toHaveBeenLastCalledWith({
      revision: "queue-rev-1",
      transitionPlans: [adaptive],
    });
  });

  it("installs plans for the next edges when playback advances", async () => {
    vi.doMock("@/lib/capacitor-runtime", () => ({ isAndroidNative: true }));
    const state = {
      revision: "queue-rev-1",
      playbackState: "playing",
      isPlaying: true,
      index: 0,
      positionMs: 0,
      durationMs: 0,
      queueSize: 6,
      crossfadeMs: 12000,
      eqEnabled: false,
    };
    nativePlaybackMock.getState.mockResolvedValue(state);
    nativePlaybackMock.setQueue.mockResolvedValue(state);
    nativePlaybackMock.setTransitionPlans.mockResolvedValue({ accepted: true });
    const { AndroidNativeEngine } = await import("@/lib/android-native-engine");
    const engine = new AndroidNativeEngine();
    const ahead = { mode: "adaptive" } as unknown as EngineTransitionPlan;
    const replanTransitionPlans = vi.fn(async (index?: number) =>
      index === 3 ? [ahead] : undefined,
    );

    await engine.loadQueue({
      revision: "queue-rev-1",
      tracks: [],
      currentIndex: 0,
      positionMs: 0,
      autoplay: true,
      repeat: "off",
      crossfadeMs: 12000,
      volume: 1,
      replanTransitionPlans,
    });
    engine.planAhead(3);

    await vi.waitFor(() =>
      expect(nativePlaybackMock.setTransitionPlans).toHaveBeenCalledWith({
        revision: "queue-rev-1",
        transitionPlans: [ahead],
      }),
    );
    expect(replanTransitionPlans).toHaveBeenLastCalledWith(3);
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
      androidBassHandoff: false,
      androidLongBeatmatch: false,
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
      androidBassHandoff: false,
      androidLongBeatmatch: false,
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
    await expect(loadPromise).resolves.toEqual({ ...state, mixState: null });
    expect(nativePlaybackMock.addListener).not.toHaveBeenCalledWith(
      "ready",
      expect.any(Function),
    );
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

    await expect(statePromise).resolves.toEqual({ ...state, mixState: null });
    expect(nativePlaybackMock.getState).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });

  describe("native continuation", () => {
    const state = {
      revision: "queue-rev-1",
      playbackState: "paused",
      isPlaying: false,
      index: 0,
      positionMs: 0,
      durationMs: 0,
      queueSize: 2,
      crossfadeMs: 12000,
      eqEnabled: false,
    };
    const context = {
      source: "playlist",
      preferredDurationMs: 12000,
      allowBeatmatch: false,
      allowBassHandoff: false,
      allowLongBeatmatch: false,
      delivery: "balanced",
      descriptor: null,
    };

    async function loadQueue(crossfadeMs: number) {
      vi.doMock("@/lib/capacitor-runtime", () => ({ isAndroidNative: true }));
      nativePlaybackMock.getState.mockResolvedValue(state);
      nativePlaybackMock.setQueue.mockResolvedValue(state);
      nativePlaybackMock.setContinuation.mockResolvedValue(undefined);
      continuationTokenMock.mockResolvedValue({
        token: "crv_continuation",
        expiresAtMs: 1_800_000_000_000,
        apiBase: "https://api.example",
      });
      const nativeEngineModule = await import("@/lib/android-native-engine");
      const engine = new nativeEngineModule.AndroidNativeEngine();
      await engine.loadQueue({
        revision: "queue-rev-1",
        tracks: [],
        currentIndex: 0,
        positionMs: 0,
        autoplay: false,
        repeat: "off",
        crossfadeMs,
        volume: 1,
        continuation: context,
      });
      return engine;
    }

    it("hands the continuation token and queue context to the native service", async () => {
      await loadQueue(12000);

      await vi.waitFor(() =>
        expect(nativePlaybackMock.setContinuation).toHaveBeenCalledWith({
          token: "crv_continuation",
          expiresAtMs: 1_800_000_000_000,
          apiBase: "https://api.example",
          source: "playlist",
          preferredDurationMs: 12000,
          allowBeatmatch: false,
          allowBassHandoff: false,
          allowLongBeatmatch: false,
          delivery: "balanced",
          refill: false,
        }),
      );
      expect(nativePlaybackMock.setQueue.mock.calls[0]![0]).not.toHaveProperty(
        "continuation",
      );
    });

    it("follows Smart Mix mode changes in the continuation context", async () => {
      vi.doMock("@/lib/capacitor-runtime", () => ({ isAndroidNative: true }));
      const { continuationWithModes } = await import(
        "@/lib/android-native-engine"
      );
      const capabilities = {
        available: true,
        androidNativeCrossfade: true,
        androidBeatmatch: true,
        androidBassHandoff: true,
        androidLongBeatmatch: false,
      };

      expect(continuationWithModes(undefined, capabilities)).toBeNull();
      expect(
        continuationWithModes(context, {
          ...capabilities,
          androidBeatmatch: false,
          androidBassHandoff: false,
          androidLongBeatmatch: false,
        }),
      ).toBeNull();
      expect(continuationWithModes(context, capabilities)).toEqual({
        ...context,
        allowBeatmatch: true,
        allowBassHandoff: true,
        allowLongBeatmatch: false,
      });
    });

    it("clears native continuation when the queue does not mix", async () => {
      await loadQueue(0);

      await vi.waitFor(() =>
        expect(nativePlaybackMock.setContinuation).toHaveBeenCalledWith({
          token: "",
        }),
      );
      expect(continuationTokenMock).not.toHaveBeenCalled();
    });

    it("keeps native refill for an infinite queue even without crossfade", async () => {
      vi.doMock("@/lib/capacitor-runtime", () => ({ isAndroidNative: true }));
      nativePlaybackMock.getState.mockResolvedValue(state);
      nativePlaybackMock.setQueue.mockResolvedValue(state);
      continuationTokenMock.mockResolvedValue({
        token: "crv_radio",
        expiresAtMs: 1_800_000_000_000,
        apiBase: "https://api.example",
      });
      const nativeEngineModule = await import("@/lib/android-native-engine");
      const engine = new nativeEngineModule.AndroidNativeEngine();
      const descriptor = {
        kind: "shaped_radio" as const,
        sessionId: "radio-1",
      };

      await engine.loadQueue({
        revision: "queue-rev-1",
        tracks: [],
        currentIndex: 0,
        positionMs: 0,
        autoplay: false,
        repeat: "off",
        crossfadeMs: 0,
        volume: 1,
        continuation: { ...context, descriptor },
      });

      await vi.waitFor(() =>
        expect(nativePlaybackMock.setContinuation).toHaveBeenCalledWith(
          expect.objectContaining({ token: "crv_radio", refill: true }),
        ),
      );
      expect(nativePlaybackMock.setContinuation).not.toHaveBeenCalledWith({
        token: "",
      });
    });

    it("reconfigures native continuation when crossfade is switched on", async () => {
      vi.doMock("@/lib/capacitor-runtime", () => ({ isAndroidNative: true }));
      nativePlaybackMock.getState.mockResolvedValue(state);
      nativePlaybackMock.setQueue.mockResolvedValue(state);
      nativePlaybackMock.setCrossfadeMs.mockResolvedValue(state);
      continuationTokenMock.mockResolvedValue({
        token: "crv_queue",
        expiresAtMs: 1_800_000_000_000,
        apiBase: "https://api.example",
      });
      const nativeEngineModule = await import("@/lib/android-native-engine");
      const engine = new nativeEngineModule.AndroidNativeEngine();

      await engine.loadQueue({
        revision: "queue-rev-1",
        tracks: [],
        currentIndex: 0,
        positionMs: 0,
        autoplay: false,
        repeat: "off",
        crossfadeMs: 0,
        volume: 1,
        continuation: context,
      });
      await vi.waitFor(() =>
        expect(nativePlaybackMock.setContinuation).toHaveBeenCalledWith({
          token: "",
        }),
      );

      await engine.setCrossfadeMs(6000);

      await vi.waitFor(() =>
        expect(nativePlaybackMock.setContinuation).toHaveBeenLastCalledWith(
          expect.objectContaining({ token: "crv_queue", refill: false }),
        ),
      );
    });

    it("asks native to refill when the queue has a continuation descriptor", async () => {
      vi.doMock("@/lib/capacitor-runtime", () => ({ isAndroidNative: true }));
      nativePlaybackMock.getState.mockResolvedValue(state);
      nativePlaybackMock.setQueue.mockResolvedValue(state);
      continuationTokenMock.mockResolvedValue({
        token: "crv_radio",
        expiresAtMs: 1_800_000_000_000,
        apiBase: "https://api.example",
      });
      const nativeEngineModule = await import("@/lib/android-native-engine");
      const engine = new nativeEngineModule.AndroidNativeEngine();
      const descriptor = {
        kind: "shaped_radio" as const,
        sessionId: "radio-1",
      };

      await engine.loadQueue({
        revision: "queue-rev-1",
        tracks: [],
        currentIndex: 0,
        positionMs: 0,
        autoplay: false,
        repeat: "off",
        crossfadeMs: 12000,
        volume: 1,
        continuation: { ...context, descriptor },
      });

      await vi.waitFor(() =>
        expect(nativePlaybackMock.setContinuation).toHaveBeenCalledWith(
          expect.objectContaining({ token: "crv_radio", refill: true }),
        ),
      );
      expect(continuationTokenMock).toHaveBeenCalledWith(descriptor);
    });

    it("refreshes an expired authorization when the app resumes", async () => {
      const engine = await loadQueue(12000);
      await vi.waitFor(() =>
        expect(nativePlaybackMock.setContinuation).toHaveBeenCalledWith(
          expect.objectContaining({ token: "crv_continuation" }),
        ),
      );
      const now = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_001);
      try {
        continuationTokenMock.mockResolvedValue({
          token: "fresh-token",
          expiresAtMs: 1_800_000_100_000,
          apiBase: "https://api.example",
        });
        window.dispatchEvent(new CustomEvent("crate:app-resumed"));
        await vi.waitFor(() =>
          expect(nativePlaybackMock.setContinuation).toHaveBeenCalledWith(
            expect.objectContaining({ token: "fresh-token" }),
          ),
        );
      } finally {
        now.mockRestore();
        await engine.destroy();
      }
    });

    it("does not reinstall an unchanged authorization when the app resumes", async () => {
      const engine = await loadQueue(12000);
      await vi.waitFor(() =>
        expect(nativePlaybackMock.setContinuation).toHaveBeenCalledWith(
          expect.objectContaining({ token: "crv_continuation" }),
        ),
      );
      continuationTokenMock.mockClear();
      nativePlaybackMock.setContinuation.mockClear();
      window.dispatchEvent(new CustomEvent("crate:app-resumed"));
      await Promise.resolve();
      await Promise.resolve();
      expect(continuationTokenMock).not.toHaveBeenCalled();
      expect(nativePlaybackMock.setContinuation).not.toHaveBeenCalled();
      await engine.destroy();
    });

    it("updates Infinite and repeat without reloading the current queue", async () => {
      const engine = await loadQueue(0);
      const descriptor = {
        kind: "shaped_radio" as const,
        sessionId: "session-1",
        batchIndex: 4,
      };
      await engine.setContinuationContext({ ...context, descriptor });
      expect(nativePlaybackMock.setContinuation).toHaveBeenLastCalledWith(
        expect.objectContaining({
          refill: true,
          sessionId: "session-1",
          batchIndex: 4,
        }),
      );
      nativePlaybackMock.setRepeat.mockResolvedValue(state);
      await engine.setRepeat("all");
      expect(nativePlaybackMock.setContinuation).toHaveBeenLastCalledWith(
        expect.objectContaining({ refill: false }),
      );
      await engine.setRepeat("off");
      expect(nativePlaybackMock.setContinuation).toHaveBeenLastCalledWith(
        expect.objectContaining({ refill: true }),
      );
      expect(nativePlaybackMock.setQueue).toHaveBeenCalledTimes(1);
    });

    it("revision removal: configures native refill without a numeric session revision", async () => {
      const engine = await loadQueue(0);
      await engine.setContinuationContext({
        ...context,
        descriptor: {
          kind: "shaped_radio",
          sessionId: "session-1",
          batchIndex: 2,
        },
      });

      expect(nativePlaybackMock.setContinuation).toHaveBeenLastCalledWith(
        expect.objectContaining({
          sessionId: "session-1",
          batchIndex: 2,
          refill: true,
        }),
      );
      expect(
        nativePlaybackMock.setContinuation.mock.calls[
          nativePlaybackMock.setContinuation.mock.calls.length - 1
        ]?.[0],
      ).not.toHaveProperty("revision");
      expect(nativePlaybackMock.setQueue.mock.calls[0]?.[0].revision).toBe(
        "queue-rev-1",
      );
    });

    it("revision removal: adopts a same-session native cursor while preserving the string queue guard", async () => {
      const engine = await loadQueue(0);
      await engine.setContinuationContext({
        ...context,
        descriptor: {
          kind: "shaped_radio",
          sessionId: "session-1",
          batchIndex: 2,
        },
      });
      const entry = {
        sequence: 3,
        id: "uid-9",
        entityUid: "uid-9",
        durationMs: 180000,
        source: { entity_uid: "uid-9" },
      };
      nativePlaybackMock.getAppendedTracks.mockResolvedValueOnce({
        revision: state.revision,
        continuationSessionId: "session-1",
        continuationBatchIndex: 6,
        continuationRevision: 99,
        tracks: [entry],
      });

      expect(await engine.takeAppendedTracks()).toEqual([entry]);
      expect(engine.getContinuationCursor()).toEqual({
        sessionId: "session-1",
        batchIndex: 6,
      });
      nativePlaybackMock.getAppendedTracks.mockResolvedValueOnce({
        revision: "old-queue",
        continuationSessionId: "session-1",
        continuationBatchIndex: 9,
        tracks: [entry],
      });
      expect(await engine.takeAppendedTracks()).toEqual([]);
      expect(engine.getContinuationCursor()).toEqual({
        sessionId: "session-1",
        batchIndex: 6,
      });
      expect(nativePlaybackMock.getAppendedTracks).toHaveBeenLastCalledWith({
        revision: state.revision,
        afterSequence: 3,
      });
    });

    it("revision removal: only an authoritative cursor can rewind the same native session", async () => {
      const engine = await loadQueue(0);
      await engine.setContinuationContext({
        ...context,
        descriptor: {
          kind: "shaped_radio",
          sessionId: "session-1",
          batchIndex: 2,
        },
      });
      await engine.setContinuationCursor(
        JSON.parse('{"sessionId":"session-1","batchIndex":10,"revision":1}'),
      );
      await engine.setContinuationCursor(
        JSON.parse('{"sessionId":"session-1","batchIndex":6,"revision":99}'),
      );
      expect(engine.getContinuationCursor()).toEqual({
        sessionId: "session-1",
        batchIndex: 10,
      });
      await engine.setContinuationCursor(
        JSON.parse('{"sessionId":"session-1","batchIndex":6,"revision":99}'),
        true,
      );
      expect(engine.getContinuationCursor()).toEqual({
        sessionId: "session-1",
        batchIndex: 6,
      });
      expect(nativePlaybackMock.setContinuation).toHaveBeenLastCalledWith(
        expect.objectContaining({
          sessionId: "session-1",
          batchIndex: 6,
          authoritativeCursor: true,
        }),
      );
      expect(
        nativePlaybackMock.setContinuation.mock.calls[
          nativePlaybackMock.setContinuation.mock.calls.length - 1
        ]?.[0],
      ).not.toHaveProperty("revision");
    });

    it("owns background refill only after a usable native configuration is installed", async () => {
      const engine = await loadQueue(0);
      expect(engine.hasBackgroundContinuation()).toBe(false);
      const withDescriptor = {
        ...context,
        descriptor: { kind: "shaped_radio" as const, sessionId: "session-1" },
      };
      await engine.setContinuationContext(withDescriptor);
      expect(engine.hasBackgroundContinuation()).toBe(true);
      nativePlaybackMock.setContinuation.mockRejectedValueOnce(
        new Error("service unavailable"),
      );
      await engine.setContinuationContext(withDescriptor);
      expect(engine.hasBackgroundContinuation()).toBe(false);
      await engine.setContinuationContext(withDescriptor);
      expect(engine.hasBackgroundContinuation()).toBe(true);
      await engine.setContinuationContext();
      expect(engine.hasBackgroundContinuation()).toBe(false);
      continuationTokenMock.mockResolvedValueOnce({
        token: "expired",
        expiresAtMs: 1,
        apiBase: "https://api.example",
      });
      await engine.setContinuationContext(withDescriptor);
      expect(engine.hasBackgroundContinuation()).toBe(false);
      await engine.destroy();
    });

    it("adopts a native cursor even if a completed batch appended no tracks", async () => {
      const engine = await loadQueue(0);
      await engine.setContinuationContext({
        ...context,
        descriptor: {
          kind: "shaped_radio",
          sessionId: "session-1",
          batchIndex: 2,
        },
      });
      nativePlaybackMock.getAppendedTracks.mockResolvedValue({
        revision: state.revision,
        tracks: [],
        continuationSessionId: "session-1",
        continuationBatchIndex: 6,
      });
      expect(await engine.takeAppendedTracks()).toEqual([]);
      expect(engine.getContinuationCursor()).toEqual({
        sessionId: "session-1",
        batchIndex: 6,
      });
      await engine.setContinuationContext({
        ...context,
        descriptor: {
          kind: "shaped_radio",
          sessionId: "session-1",
          batchIndex: 2,
        },
      });
      expect(nativePlaybackMock.setContinuation).toHaveBeenLastCalledWith(
        expect.objectContaining({ batchIndex: 6 }),
      );
    });

    it("publishes each foreground ACK before background refill and ignores an older native cursor", async () => {
      const engine = await loadQueue(0);
      await engine.setContinuationContext({
        ...context,
        descriptor: {
          kind: "seeded_radio",
          seedType: "album",
          seedId: "42",
          sessionId: "session-1",
          batchIndex: 0,
        },
      });
      for (const batchIndex of [1, 2]) {
        await engine.setContinuationCursor({
          sessionId: "session-1",
          batchIndex,
        });
        nativePlaybackMock.getAppendedTracks.mockResolvedValue({
          revision: state.revision,
          tracks: [],
          continuationSessionId: "session-1",
          continuationBatchIndex: 0,
        });
        await engine.takeAppendedTracks();
        expect(engine.getContinuationCursor()).toEqual({
          sessionId: "session-1",
          batchIndex,
        });
      }
      expect(nativePlaybackMock.setContinuation).toHaveBeenLastCalledWith(
        expect.objectContaining({
          sessionId: "session-1",
          batchIndex: 2,
          refill: true,
        }),
      );
      expect(nativePlaybackMock.setQueue).toHaveBeenCalledOnce();
    });

    it("realigns an authoritative server cursor without reloading the native queue", async () => {
      const engine = await loadQueue(0);
      await engine.setContinuationContext({
        ...context,
        descriptor: {
          kind: "seeded_radio",
          seedType: "album",
          seedId: "42",
          sessionId: "session-1",
          batchIndex: 10,
        },
      });
      await engine.setContinuationCursor({
        sessionId: "session-1",
        batchIndex: 10,
      });
      await engine.setContinuationCursor(
        { sessionId: "session-1", batchIndex: 6 },
        true,
      );
      nativePlaybackMock.getAppendedTracks.mockResolvedValue({
        revision: state.revision,
        tracks: [],
        continuationSessionId: "session-1",
        continuationBatchIndex: 6,
      });
      await engine.takeAppendedTracks();
      expect(engine.getContinuationCursor()).toEqual({
        sessionId: "session-1",
        batchIndex: 6,
      });
      expect(nativePlaybackMock.setContinuation).toHaveBeenLastCalledWith(
        expect.objectContaining({
          sessionId: "session-1",
          batchIndex: 6,
          authoritativeCursor: true,
        }),
      );
      expect(nativePlaybackMock.setQueue).toHaveBeenCalledOnce();
    });

    it("reissues rejected authorization once and ignores another queue's rejection", async () => {
      const engine = await loadQueue(12000);
      const call = nativePlaybackMock.addListener.mock.calls.find(
        ([event]) => event === "continuationAuthorizationRequired",
      );
      const listener = call![1] as (event: { revision: string }) => void;
      const before = continuationTokenMock.mock.calls.length;
      listener({ revision: "old-queue" });
      expect(continuationTokenMock).toHaveBeenCalledTimes(before);
      listener({ revision: state.revision });
      await vi.waitFor(() =>
        expect(continuationTokenMock).toHaveBeenCalledTimes(before + 1),
      );
      listener({ revision: state.revision });
      await Promise.resolve();
      expect(invalidateContinuationTokenMock).toHaveBeenCalled();
      expect(continuationTokenMock).toHaveBeenCalledTimes(before + 1);
      await engine.destroy();
    });

    it("clears continuation authorization and rejects an in-flight token on logout", async () => {
      const engine = await loadQueue(12000);
      let resolveToken: (token: {
        token: string;
        expiresAtMs: number;
        apiBase: string;
      }) => void = () => {};
      continuationTokenMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveToken = resolve;
          }),
      );
      const pending = engine.setContinuationContext({ ...context });
      window.dispatchEvent(new CustomEvent("crate:auth-runtime-reset"));
      resolveToken({
        token: "stale-token",
        expiresAtMs: 1_800_000_000_000,
        apiBase: "https://api.example",
      });
      await pending;
      expect(invalidateContinuationTokenMock).toHaveBeenCalled();
      expect(nativePlaybackMock.setContinuation).toHaveBeenLastCalledWith({
        token: "",
      });
      expect(nativePlaybackMock.setContinuation).not.toHaveBeenCalledWith(
        expect.objectContaining({ token: "stale-token" }),
      );
      await engine.destroy();
    });

    it("takes each natively appended track once per queue revision", async () => {
      await loadQueue(12000);
      const nativeEngineModule = await import("@/lib/android-native-engine");
      const engine = nativeEngineModule.androidNativeEngine;
      await engine.loadQueue({
        revision: "queue-rev-1",
        tracks: [],
        currentIndex: 0,
        positionMs: 0,
        autoplay: false,
        repeat: "off",
        crossfadeMs: 12000,
        volume: 1,
      });
      const entry = {
        sequence: 3,
        id: "uid-9",
        entityUid: "uid-9",
        durationMs: 180000,
        source: { entity_uid: "uid-9" },
      };
      nativePlaybackMock.getAppendedTracks
        .mockResolvedValueOnce({ revision: "queue-rev-1", tracks: [entry] })
        .mockResolvedValueOnce({ revision: "queue-rev-1", tracks: [] })
        .mockResolvedValueOnce({ revision: "other-rev", tracks: [entry] });

      expect(await engine.takeAppendedTracks()).toEqual([entry]);
      expect(await engine.takeAppendedTracks()).toEqual([]);
      expect(nativePlaybackMock.getAppendedTracks).toHaveBeenLastCalledWith({
        revision: "queue-rev-1",
        afterSequence: 3,
      });
      expect(await engine.takeAppendedTracks()).toEqual([]);
    });
  });
});
