import { afterEach, describe, expect, it, vi } from "vitest";

const mockAndroidNativeEngine = vi.hoisted(() => ({
  loadQueue: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  stop: vi.fn(),
  seekTo: vi.fn(),
  next: vi.fn(),
  previous: vi.fn(),
  jumpTo: vi.fn(),
  appendTracks: vi.fn(),
  insertTrack: vi.fn(),
  removeTrack: vi.fn(),
  reorderTrack: vi.fn(),
  setRepeat: vi.fn(),
  setCrossfadeMs: vi.fn(),
  setVolume: vi.fn(),
  setPlaybackRate: vi.fn(),
  setEq: vi.fn(),
  getState: vi.fn(),
  drainEvents: vi.fn(),
  on: vi.fn(),
  destroy: vi.fn(),
}));

const mockShouldUseAndroidNativePlayer = vi.hoisted(() => vi.fn(() => false));

vi.mock("@/lib/android-native-engine", () => ({
  androidNativeEngine: mockAndroidNativeEngine,
  shouldUseAndroidNativePlayer: mockShouldUseAndroidNativePlayer,
}));

vi.mock("@/lib/gapless5/gapless5", () => ({
  Gapless5: vi.fn(),
}));

vi.mock("@/lib/mobile-audio-mode", () => ({
  stableMobileAudioPipeline: false,
}));

import { createPlaybackEngine } from "@/lib/playback-engine-factory";
import type { PlaybackEngine } from "@/lib/playback-engine";

afterEach(() => {
  vi.clearAllMocks();
});

describe("createPlaybackEngine", () => {
  it("returns a PlaybackEngine instance with all expected methods", () => {
    const engine = createPlaybackEngine();
    // Shape check — the factory always returns something that satisfies
    // the PlaybackEngine interface regardless of platform.
    expect(engine).toBeDefined();
    expect(typeof engine.loadQueue).toBe("function");
    expect(typeof engine.play).toBe("function");
    expect(typeof engine.pause).toBe("function");
    expect(typeof engine.stop).toBe("function");
    expect(typeof engine.seekTo).toBe("function");
    expect(typeof engine.next).toBe("function");
    expect(typeof engine.previous).toBe("function");
    expect(typeof engine.jumpTo).toBe("function");
    expect(typeof engine.appendTracks).toBe("function");
    expect(typeof engine.insertTrack).toBe("function");
    expect(typeof engine.removeTrack).toBe("function");
    expect(typeof engine.reorderTrack).toBe("function");
    expect(typeof engine.setRepeat).toBe("function");
    expect(typeof engine.setCrossfadeMs).toBe("function");
    expect(typeof engine.setVolume).toBe("function");
    expect(typeof engine.setPlaybackRate).toBe("function");
    expect(typeof engine.setEq).toBe("function");
    expect(typeof engine.getState).toBe("function");
    expect(typeof engine.drainEvents).toBe("function");
    expect(typeof engine.on).toBe("function");
    expect(typeof engine.destroy).toBe("function");
  });

  it("creates GaplessWebEngine by default (web runtime)", () => {
    mockShouldUseAndroidNativePlayer.mockReturnValue(false);
    const engine = createPlaybackEngine();
    // Web engine should be a different object reference than the
    // singleton native engine.
    expect(engine).not.toBe(mockAndroidNativeEngine);
  });

  it("returns native engine when shouldUseAndroidNativePlayer is true", () => {
    mockShouldUseAndroidNativePlayer.mockReturnValue(true);
    const engine = createPlaybackEngine();
    // The singleton androidNativeEngine is returned directly (not a copy).
    expect(engine).toBe(mockAndroidNativeEngine);
  });

  it("calls shouldUseAndroidNativePlayer on each invocation", () => {
    mockShouldUseAndroidNativePlayer.mockReturnValue(false);
    createPlaybackEngine();
    expect(mockShouldUseAndroidNativePlayer).toHaveBeenCalledTimes(1);

    createPlaybackEngine();
    expect(mockShouldUseAndroidNativePlayer).toHaveBeenCalledTimes(2);
  });

  it("GaplessWebEngine satisfies the PlaybackEngine interface", () => {
    const engine: PlaybackEngine = createPlaybackEngine();
    // TypeScript-only assertion: if this compiles, the factory's return
    // type matches the interface.
    expect(engine).toBeDefined();
  });
});
