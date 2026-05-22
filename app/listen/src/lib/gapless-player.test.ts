import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mocks ────────────────────────────────────────────────

const MockGapless5 = vi.hoisted(() => vi.fn());
const mockRecordDevLog = vi.hoisted(() => vi.fn());
const mockGetCrossfadeDurationPreference = vi.hoisted(() => vi.fn(() => 4));

vi.mock("@/lib/gapless5/gapless5", () => ({
  Gapless5: MockGapless5,
}));

vi.mock("@/lib/mobile-audio-mode", () => ({
  stableMobileAudioPipeline: false,
}));

vi.mock("@/lib/dev-logs", () => ({
  recordDevLog: mockRecordDevLog,
  redactUrl: (url: string) => url,
}));

vi.mock("@/lib/player-playback-prefs", () => ({
  getCrossfadeDurationPreference: mockGetCrossfadeDurationPreference,
}));

vi.mock("@/lib/equalizer", () => ({
  createEqChain: vi.fn(() => ({
    dispose: vi.fn(),
    setGains: vi.fn(),
    input: { connect: vi.fn(), disconnect: vi.fn() },
    output: { connect: vi.fn(), disconnect: vi.fn() },
  })),
  isFlatGains: vi.fn((gains: number[]) => gains.every((g) => g === 0)),
}));

import {
  addTrack,
  destroyPlayer,
  fadeInAndPlay,
  fadeOutAndPause,
  getAnalyserNode,
  getCurrentTrackDuration,
  getCurrentTrackUrl,
  getPlayer,
  getPosition,
  getTrackIndex,
  getTracks,
  gotoTrack,
  initPlayer,
  insertTrack,
  isCurrentTrackFullyBuffered,
  isEqualizerActive,
  isPlaybackGestureRequiredError,
  loadQueue,
  next as gpNext,
  pause,
  play,
  prev,
  removeTrack,
  replaceTrack,
  restoreVolume,
  seekTo,
  setCrossfadeDuration,
  setEqualizer,
  setLoop,
  setPlaybackRate,
  setShuffle,
  setSingleMode,
  setVolume,
  stop,
  updateCrossfade,
} from "@/lib/gapless-player";
import type { Gapless5 as Gapless5Type } from "@/lib/gapless5/gapless5";

// ── Test helpers ──────────────────────────────────────────────────

type MockFn = ReturnType<typeof vi.fn>;

type MockGapless5Instance = {
  setVolume: MockFn;
  play: MockFn;
  pause: MockFn;
  stop: MockFn;
  next: MockFn;
  prev: MockFn;
  gotoTrack: MockFn;
  setPosition: MockFn;
  getPosition: MockFn;
  currentLength: MockFn;
  getTrack: MockFn;
  getIndex: MockFn;
  getTracks: MockFn;
  addTrack: MockFn;
  insertTrack: MockFn;
  removeTrack: MockFn;
  replaceTrack: MockFn;
  removeAllTracks: MockFn;
  isShuffled: MockFn;
  shuffle: MockFn;
  toggleShuffle: MockFn;
  setCrossfade: MockFn;
  setPlaybackRate: MockFn;
  playlist: { shuffledIndices: number[]; sources: unknown[] };
  loop: boolean;
  singleMode: boolean;
};

function mkMockInstance(
  overrides: Partial<MockGapless5Instance> = {},
): MockGapless5Instance {
  return {
    setVolume: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    next: vi.fn(),
    prev: vi.fn(),
    gotoTrack: vi.fn(),
    setPosition: vi.fn(),
    getPosition: vi.fn().mockReturnValue(0),
    currentLength: vi.fn().mockReturnValue(0),
    getTrack: vi.fn().mockReturnValue(""),
    getIndex: vi.fn().mockReturnValue(0),
    getTracks: vi.fn().mockReturnValue([]),
    addTrack: vi.fn(),
    insertTrack: vi.fn(),
    removeTrack: vi.fn(),
    replaceTrack: vi.fn(),
    removeAllTracks: vi.fn(),
    isShuffled: vi.fn().mockReturnValue(false),
    shuffle: vi.fn(),
    toggleShuffle: vi.fn(),
    setCrossfade: vi.fn(),
    setPlaybackRate: vi.fn(),
    loop: false,
    singleMode: false,
    playlist: {
      shuffledIndices: [0, 1, 2],
      sources: [{}, {}, {}],
    },
    ...overrides,
  };
}

let mock: ReturnType<typeof mkMockInstance>;

beforeEach(() => {
  vi.clearAllMocks();
  mock = mkMockInstance();
  MockGapless5.mockImplementation(function () {
    return mock as unknown as Gapless5Type;
  });
});

afterEach(() => {
  destroyPlayer();
});

// ── initPlayer ────────────────────────────────────────────────────

describe("isCurrentTrackFullyBuffered", () => {
  it("returns false by default", () => {
    expect(isCurrentTrackFullyBuffered()).toBe(false);
  });
});

describe("initPlayer", () => {
  it("creates a Gapless5 instance with expected options", () => {
    const player = initPlayer();

    expect(MockGapless5).toHaveBeenCalledTimes(1);
    const options = MockGapless5.mock.calls[0]![0] as Record<string, unknown>;
    expect(options.useHTML5Audio).toBe(true);
    expect(options.useWebAudio).toBe(true);
    expect(options.analyserPrecision).toBe(2048);
    expect(options.crossfade).toBe(4000);
    expect(options.crossfadeShape).toBe(3);
    expect(options.volume).toBe(1);
    expect(options.logLevel).toBe(3);
    expect(player).toBeDefined();
  });

  it("reuses the existing instance on subsequent calls", () => {
    const a = initPlayer();
    MockGapless5.mockClear();
    const b = initPlayer();

    expect(MockGapless5).not.toHaveBeenCalled();
    expect(b).toBe(a);
  });

  it("wires ontimeupdate to callbacks", () => {
    const onTimeUpdate = vi.fn();
    initPlayer({ onTimeUpdate });

    const handler = (mock as unknown as Record<string, unknown>)
      .ontimeupdate as ((pos: number, idx: number) => void) | undefined;
    handler?.(5000, 1);

    expect(onTimeUpdate).toHaveBeenCalledWith(5000, 1);
  });

  it("wires onplay to callbacks and sets analyser", () => {
    const onPlay = vi.fn();
    initPlayer({ onPlay });

    const handler = (mock as unknown as Record<string, unknown>).onplay as
      | ((path: string, analyser?: unknown) => void)
      | undefined;
    handler?.("/tracks/1/stream");

    expect(onPlay).toHaveBeenCalledWith("/tracks/1/stream");
  });

  it("marks currentTrackFullyBuffered when onplay includes an analyser", () => {
    initPlayer();

    const handler = (mock as unknown as Record<string, unknown>).onplay as
      | ((path: string, analyser?: unknown) => void)
      | undefined;
    handler?.("/tracks/1/stream", {} as AnalyserNode);

    expect(isCurrentTrackFullyBuffered()).toBe(true);
  });

  it("wires onpause to callbacks", () => {
    const onPause = vi.fn();
    initPlayer({ onPause });

    const handler = (mock as unknown as Record<string, unknown>).onpause as
      | ((path: string) => void)
      | undefined;
    handler?.("/tracks/1/stream");

    expect(onPause).toHaveBeenCalledWith("/tracks/1/stream");
  });

  it("wires onfinishedtrack to callbacks", () => {
    const onTrackFinished = vi.fn();
    initPlayer({ onTrackFinished });

    const handler = (mock as unknown as Record<string, unknown>)
      .onfinishedtrack as ((path: string) => void) | undefined;
    handler?.("/tracks/1/stream");

    expect(onTrackFinished).toHaveBeenCalledWith("/tracks/1/stream");
  });

  it("wires onfinishedall to callbacks", () => {
    const onAllFinished = vi.fn();
    initPlayer({ onAllFinished });

    const handler = (mock as unknown as Record<string, unknown>)
      .onfinishedall as (() => void) | undefined;
    handler?.();

    expect(onAllFinished).toHaveBeenCalledTimes(1);
  });

  it("wires onnext and onprev to callbacks", () => {
    const onNext = vi.fn();
    const onPrev = vi.fn();
    initPlayer({ onNext, onPrev });

    const nextHandler = (mock as unknown as Record<string, unknown>).onnext as
      | ((from: string, to: string) => void)
      | undefined;
    nextHandler?.("a", "b");
    expect(onNext).toHaveBeenCalledWith("a", "b");

    const prevHandler = (mock as unknown as Record<string, unknown>).onprev as
      | ((from: string, to: string) => void)
      | undefined;
    prevHandler?.("a", "b");
    expect(onPrev).toHaveBeenCalledWith("a", "b");
  });

  it("wires onerror to callbacks and logs", () => {
    const onError = vi.fn();
    initPlayer({ onError });

    const handler = (mock as unknown as Record<string, unknown>).onerror as
      | ((path: string, err: unknown) => void)
      | undefined;
    handler?.("/tracks/1/stream", new Error("boom"));

    expect(onError).toHaveBeenCalledWith("/tracks/1/stream", expect.any(Error));
    expect(mockRecordDevLog).toHaveBeenCalledWith(
      "gapless",
      "error",
      expect.objectContaining({ path: "/tracks/1/stream" }),
      "error",
    );
  });

  it("wires onload to onLoad and onDurationChange callbacks", () => {
    const onLoad = vi.fn();
    const onDurationChange = vi.fn();
    initPlayer({ onLoad, onDurationChange });

    mock.currentLength.mockReturnValue(180_000);

    const handler = (mock as unknown as Record<string, unknown>).onload as
      | ((path: string, fullyLoaded: boolean) => void)
      | undefined;
    handler?.("/tracks/1/stream", true);

    expect(onLoad).toHaveBeenCalledWith("/tracks/1/stream", true, 180_000);
    expect(onDurationChange).toHaveBeenCalledWith(180_000);
  });

  it("wires onloadstart to onBuffering callback", () => {
    const onBuffering = vi.fn();
    initPlayer({ onBuffering });

    const handler = (mock as unknown as Record<string, unknown>).onloadstart as
      | ((path: string) => void)
      | undefined;
    handler?.("/tracks/1/stream");

    expect(onBuffering).toHaveBeenCalledWith("/tracks/1/stream");
  });

  it("wires onswitchtowebaudio to set fully buffered and analyser", () => {
    const onAnalyserReady = vi.fn();
    initPlayer({ onAnalyserReady });

    const handler = (mock as unknown as Record<string, unknown>)
      .onswitchtowebaudio as
      | ((path: string, analyser: AnalyserNode) => void)
      | undefined;
    handler?.("/tracks/1/stream", {} as AnalyserNode);

    expect(isCurrentTrackFullyBuffered()).toBe(true);
    expect(onAnalyserReady).toHaveBeenCalledWith({});
  });
});

// ── destroyPlayer ─────────────────────────────────────────────────

describe("destroyPlayer", () => {
  it("cleans up the instance", () => {
    initPlayer();
    destroyPlayer();

    expect(mock.stop).toHaveBeenCalled();
    expect(mock.removeAllTracks).toHaveBeenCalled();
    expect(getPlayer()).toBeNull();
  });

  it("is a no-op when no instance exists", () => {
    expect(() => destroyPlayer()).not.toThrow();
  });

  it("gracefully handles errors during cleanup", () => {
    initPlayer();
    mock.stop.mockImplementation(() => {
      throw new Error("context closed");
    });

    expect(() => destroyPlayer()).not.toThrow();
    expect(getPlayer()).toBeNull();
  });
});

// ── Query functions ───────────────────────────────────────────────

describe("getPlayer", () => {
  it("returns null before init", () => {
    destroyPlayer();
    expect(getPlayer()).toBeNull();
  });

  it("returns the instance after init", () => {
    const p = initPlayer();
    expect(getPlayer()).toBe(p);
  });
});

describe("getAnalyserNode", () => {
  it("returns null before analyser is set", () => {
    expect(getAnalyserNode()).toBeNull();
  });
});

describe("isPlaybackGestureRequiredError", () => {
  it("detects not_allowed type", () => {
    expect(isPlaybackGestureRequiredError({ type: "not_allowed" })).toBe(true);
  });

  it("detects NotAllowedError name", () => {
    expect(isPlaybackGestureRequiredError({ name: "NotAllowedError" })).toBe(
      true,
    );
  });

  it("returns false for normal errors", () => {
    expect(isPlaybackGestureRequiredError(new Error("boom"))).toBe(false);
  });

  it("returns false for non-objects", () => {
    expect(isPlaybackGestureRequiredError(null)).toBe(false);
    expect(isPlaybackGestureRequiredError(undefined)).toBe(false);
    expect(isPlaybackGestureRequiredError("string")).toBe(false);
  });
});

// ── Queue management ──────────────────────────────────────────────

describe("loadQueue", () => {
  it("delegates removeAllTracks, addTrack, gotoTrack", () => {
    initPlayer();
    const urls = ["/tracks/1/stream", "/tracks/2/stream"];
    mock.getTracks.mockReturnValue([]);

    loadQueue(urls, 0);

    expect(mock.removeAllTracks).toHaveBeenCalled();
    expect(mock.addTrack).toHaveBeenCalledTimes(2);
    expect(mock.addTrack).toHaveBeenNthCalledWith(1, urls[0]);
    expect(mock.addTrack).toHaveBeenNthCalledWith(2, urls[1]);
    expect(mock.gotoTrack).toHaveBeenCalledWith(0);
  });

  it("is a no-op when no instance exists", () => {
    expect(() => loadQueue(["/tracks/1/stream"])).not.toThrow();
  });

  it("skips rebuild when URLs are identical", () => {
    initPlayer();
    mock.getTracks.mockReturnValue(["/tracks/1/stream", "/tracks/2/stream"]);
    mock.getIndex.mockReturnValue(0);

    loadQueue(["/tracks/1/stream", "/tracks/2/stream"], 0);

    expect(mock.removeAllTracks).not.toHaveBeenCalled();
    expect(mock.addTrack).not.toHaveBeenCalled();
  });

  it("jumps to startIndex when same URLs but different index", () => {
    initPlayer();
    mock.getTracks.mockReturnValue(["/tracks/1/stream", "/tracks/2/stream"]);
    mock.getIndex.mockReturnValue(0);

    loadQueue(["/tracks/1/stream", "/tracks/2/stream"], 1);

    expect(mock.gotoTrack).toHaveBeenCalledWith(1);
  });

  it("restarts the current track when restartIfSameIndex is set", () => {
    initPlayer();
    mock.getTracks.mockReturnValue(["/tracks/1/stream", "/tracks/2/stream"]);
    mock.getIndex.mockReturnValue(0);

    loadQueue(["/tracks/1/stream", "/tracks/2/stream"], 0, {
      restartIfSameIndex: true,
    });

    expect(mock.gotoTrack).toHaveBeenCalledWith(0, true);
  });
});

describe("addTrack", () => {
  it("delegates to instance.addTrack", () => {
    initPlayer();
    addTrack("/tracks/1/stream");

    expect(mock.addTrack).toHaveBeenCalledWith("/tracks/1/stream");
  });

  it("is a no-op when no instance exists", () => {
    expect(() => addTrack("/tracks/1/stream")).not.toThrow();
  });
});

describe("insertTrack", () => {
  it("delegates to instance.insertTrack", () => {
    initPlayer();
    insertTrack(2, "/tracks/3/stream");

    expect(mock.insertTrack).toHaveBeenCalledWith(2, "/tracks/3/stream");
  });

  it("is a no-op when no instance exists", () => {
    expect(() => insertTrack(0, "/tracks/1/stream")).not.toThrow();
  });
});

describe("removeTrack", () => {
  it("delegates to instance.removeTrack", () => {
    initPlayer();
    removeTrack(0);

    expect(mock.removeTrack).toHaveBeenCalledWith(0);
  });

  it("is a no-op when no instance exists", () => {
    expect(() => removeTrack(0)).not.toThrow();
  });
});

describe("replaceTrack", () => {
  it("delegates to instance.replaceTrack", () => {
    initPlayer();
    replaceTrack(1, "/tracks/new/stream");

    expect(mock.replaceTrack).toHaveBeenCalledWith(1, "/tracks/new/stream");
  });

  it("is a no-op when no instance exists", () => {
    expect(() => replaceTrack(0, "/tracks/1/stream")).not.toThrow();
  });
});

// ── Playback controls ─────────────────────────────────────────────

describe("play", () => {
  it("delegates to instance.play", () => {
    initPlayer();
    play();

    expect(mock.play).toHaveBeenCalled();
  });

  it("is a no-op when no instance exists", () => {
    expect(() => play()).not.toThrow();
  });
});

describe("pause", () => {
  it("delegates to instance.pause", () => {
    initPlayer();
    pause();

    expect(mock.pause).toHaveBeenCalled();
  });

  it("is a no-op when no instance exists", () => {
    expect(() => pause()).not.toThrow();
  });
});

describe("stop", () => {
  it("delegates to instance.stop", () => {
    initPlayer();
    stop();

    expect(mock.stop).toHaveBeenCalled();
  });

  it("is a no-op when no instance exists", () => {
    expect(() => stop()).not.toThrow();
  });
});

describe("next", () => {
  it("delegates with crossfade", () => {
    initPlayer();
    gpNext();

    expect(mock.next).toHaveBeenCalledWith(undefined, true, true);
  });

  it("is a no-op when no instance exists", () => {
    expect(() => gpNext()).not.toThrow();
  });
});

describe("prev", () => {
  it("delegates without crossfade", () => {
    initPlayer();
    prev();

    expect(mock.prev).toHaveBeenCalledWith(undefined, false);
  });

  it("is a no-op when no instance exists", () => {
    expect(() => prev()).not.toThrow();
  });
});

describe("gotoTrack", () => {
  it("delegates by index", () => {
    initPlayer();
    gotoTrack(3, true);

    expect(mock.gotoTrack).toHaveBeenCalledWith(3, true);
  });

  it("is a no-op when no instance exists", () => {
    expect(() => gotoTrack(0)).not.toThrow();
  });
});

describe("seekTo", () => {
  it("delegates to setPosition", () => {
    initPlayer();
    seekTo(30000);

    expect(mock.setPosition).toHaveBeenCalledWith(30000);
  });

  it("is a no-op when no instance exists", () => {
    expect(() => seekTo(30000)).not.toThrow();
  });
});

// ── Volume & rate ─────────────────────────────────────────────────

describe("setVolume", () => {
  it("clamps and delegates", () => {
    initPlayer();
    setVolume(0.75);

    expect(mock.setVolume).toHaveBeenCalledWith(0.75);
  });

  it("clamps volume above 1", () => {
    initPlayer();
    setVolume(2);

    expect(mock.setVolume).toHaveBeenCalledWith(1);
  });

  it("clamps volume below 0", () => {
    initPlayer();
    setVolume(-0.5);

    expect(mock.setVolume).toHaveBeenCalledWith(0);
  });
});

describe("setPlaybackRate", () => {
  it("clamps and delegates", () => {
    initPlayer();
    setPlaybackRate(1.5);

    expect(mock.setPlaybackRate).toHaveBeenCalledWith(1.5);
  });

  it("clamps below minimum", () => {
    initPlayer();
    setPlaybackRate(0);

    expect(mock.setPlaybackRate).toHaveBeenCalledWith(0.25);
  });

  it("clamps above maximum", () => {
    initPlayer();
    setPlaybackRate(10);

    expect(mock.setPlaybackRate).toHaveBeenCalledWith(4);
  });
});

// ── State queries ─────────────────────────────────────────────────

describe("getPosition", () => {
  it("delegates to instance.getPosition", () => {
    initPlayer();
    mock.getPosition.mockReturnValue(42_000);

    expect(getPosition()).toBe(42_000);
  });

  it("returns 0 when no instance exists", () => {
    expect(getPosition()).toBe(0);
  });
});

describe("getCurrentTrackDuration", () => {
  it("delegates to instance.currentLength", () => {
    initPlayer();
    mock.currentLength.mockReturnValue(180_000);

    expect(getCurrentTrackDuration()).toBe(180_000);
  });

  it("returns 0 when no instance exists", () => {
    expect(getCurrentTrackDuration()).toBe(0);
  });
});

describe("getCurrentTrackUrl", () => {
  it("delegates to instance.getTrack", () => {
    initPlayer();
    mock.getTrack.mockReturnValue("/tracks/1/stream");

    expect(getCurrentTrackUrl()).toBe("/tracks/1/stream");
  });

  it("returns empty string when no instance exists", () => {
    expect(getCurrentTrackUrl()).toBe("");
  });
});

describe("getTrackIndex", () => {
  it("delegates to instance.getIndex", () => {
    initPlayer();
    mock.getIndex.mockReturnValue(5);

    expect(getTrackIndex()).toBe(5);
  });

  it("returns -1 when no instance exists", () => {
    expect(getTrackIndex()).toBe(-1);
  });
});

describe("getTracks", () => {
  it("delegates to instance.getTracks", () => {
    initPlayer();
    mock.getTracks.mockReturnValue(["/a", "/b"]);

    expect(getTracks()).toEqual(["/a", "/b"]);
  });

  it("returns empty array when no instance exists", () => {
    expect(getTracks()).toEqual([]);
  });
});

// ── Shuffle ───────────────────────────────────────────────────────

describe("setShuffle", () => {
  it("enables shuffle when not already shuffled", () => {
    initPlayer();
    mock.isShuffled.mockReturnValue(false);

    setShuffle(true);

    expect(mock.shuffle).toHaveBeenCalledWith(true);
  });

  it("disables shuffle via toggle", () => {
    initPlayer();
    mock.isShuffled.mockReturnValue(true);

    setShuffle(false);

    expect(mock.toggleShuffle).toHaveBeenCalled();
  });

  it("is a no-op when already in desired state", () => {
    initPlayer();
    mock.isShuffled.mockReturnValue(false);
    setShuffle(false);
    expect(mock.toggleShuffle).not.toHaveBeenCalled();
    expect(mock.shuffle).not.toHaveBeenCalled();
  });

  it("is a no-op when no instance exists", () => {
    expect(() => setShuffle(true)).not.toThrow();
  });
});

// ── Crossfade ─────────────────────────────────────────────────────

describe("updateCrossfade", () => {
  it("delegates with preference-based duration", () => {
    initPlayer();
    mockGetCrossfadeDurationPreference.mockReturnValue(2);

    updateCrossfade();

    expect(mock.setCrossfade).toHaveBeenCalledWith(2000);
  });
});

describe("setCrossfadeDuration", () => {
  it("delegates with absolute ms", () => {
    initPlayer();
    setCrossfadeDuration(5000);

    expect(mock.setCrossfade).toHaveBeenCalledWith(5000);
  });

  it("is a no-op when no instance exists", () => {
    expect(() => setCrossfadeDuration(5000)).not.toThrow();
  });
});

// ── Fade ──────────────────────────────────────────────────────────

describe("fadeOutAndPause", () => {
  it("resolves immediately when no instance exists", async () => {
    await expect(fadeOutAndPause()).resolves.toBeUndefined();
  });

  it("fades volume down and pauses", async () => {
    vi.useFakeTimers();
    initPlayer();
    setVolume(0.8);

    const promise = fadeOutAndPause(200);
    await vi.advanceTimersByTimeAsync(300);

    await promise;
    expect(mock.setVolume).toHaveBeenCalledWith(0);
    expect(mock.pause).toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("fadeInAndPlay", () => {
  it("resolves immediately when no instance exists", async () => {
    await expect(fadeInAndPlay()).resolves.toBeUndefined();
  });

  it("starts at 0, plays, then ramps to lastVolume", async () => {
    vi.useFakeTimers();
    initPlayer();
    setVolume(0.8);

    const promise = fadeInAndPlay(200);
    await vi.advanceTimersByTimeAsync(300);

    await promise;
    const calls = (mock.setVolume as ReturnType<typeof vi.fn>).mock.calls;
    // Index 0 = setVolume(0.8), index 1 = applyVolume(0) inside fadeInAndPlay
    expect(calls[1]![0]).toBe(0);
    // Last call ramps to lastVolume
    expect(calls[calls.length - 1]![0]).toBe(0.8);
    vi.useRealTimers();
  });
});

describe("restoreVolume", () => {
  it("restores to last user-set volume", () => {
    initPlayer();
    setVolume(0.5);
    mock.setVolume.mockClear();

    restoreVolume();

    expect(mock.setVolume).toHaveBeenCalledWith(0.5);
  });
});

// ── Loop / single ─────────────────────────────────────────────────

describe("setLoop", () => {
  it("sets instance.loop", () => {
    initPlayer();
    setLoop(true);
    expect(mock.loop).toBe(true);

    setLoop(false);
    expect(mock.loop).toBe(false);
  });

  it("is a no-op when no instance exists", () => {
    expect(() => setLoop(true)).not.toThrow();
  });
});

describe("setSingleMode", () => {
  it("sets instance.singleMode", () => {
    initPlayer();
    setSingleMode(true);
    expect(mock.singleMode).toBe(true);

    setSingleMode(false);
    expect(mock.singleMode).toBe(false);
  });

  it("is a no-op when no instance exists", () => {
    expect(() => setSingleMode(true)).not.toThrow();
  });
});

// ── Equalizer ─────────────────────────────────────────────────────

describe("setEqualizer", () => {
  it("is a no-op when no instance exists", () => {
    expect(() =>
      setEqualizer(true, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    ).not.toThrow();
  });

  it("is a no-op when setOutputChain is not available", () => {
    initPlayer();
    // Gapless5 mock doesn't have setOutputChain by default
    expect(() =>
      setEqualizer(true, [1, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    ).not.toThrow();
  });
});

describe("isEqualizerActive", () => {
  it("returns false by default", () => {
    expect(isEqualizerActive()).toBe(false);
  });
});
