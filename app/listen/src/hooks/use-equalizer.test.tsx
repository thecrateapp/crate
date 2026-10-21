import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EQ_PREFS_EVENT,
  getEqualizerGains,
  setCustomEqualizerGains,
  setEqualizerSmart,
  setEqualizerAdaptive,
  setEqualizerGenreAdaptive,
  getEqualizerSnapshot,
} from "@/lib/equalizer-prefs";
import { NATIVE_EQ_LIVE_INTERVAL_MS, useEqualizer } from "./use-equalizer";

const engine = vi.hoisted(() => ({
  android: false,
  resolvedGains: null as number[] | null,
  setEq: vi.fn(() => Promise.resolve()),
  setEqualizer: vi.fn(),
}));

vi.mock("@/contexts/PlayerContext", () => ({
  usePlayerActions: () => ({ currentTrack: undefined }),
}));

vi.mock("@/hooks/use-equalizer-runtime", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/hooks/use-equalizer-runtime")>();
  return {
    ...actual,
    useResolvedEqualizer: (snapshot: {
      gains: number[];
      smart: boolean;
      adaptive: boolean;
      genreAdaptive: boolean;
    }) => ({
      effectiveGains:
        (snapshot.smart || snapshot.adaptive || snapshot.genreAdaptive) &&
        engine.resolvedGains
          ? engine.resolvedGains
          : snapshot.gains,
      effectiveEqState: { status: "idle" },
      effectiveEq: null,
      featuresState: { status: "idle" },
      features: null,
      genreState: { status: "idle" },
      trackGenre: null,
    }),
  };
});

vi.mock("@/lib/android-native-engine", () => ({
  shouldUseAndroidNativePlayer: () => engine.android,
  androidNativeEngine: { setEq: engine.setEq },
}));

vi.mock("@/lib/gapless-player", () => ({
  setEqualizer: engine.setEqualizer,
}));

function drag(
  result: { current: ReturnType<typeof useEqualizer> },
  band: number,
  moves: number,
  frameMs: number,
) {
  for (let move = 1; move <= moves; move++) {
    act(() => result.current.updateBand(band, (move % 24) / 2 - 6));
    act(() => vi.advanceTimersByTime(frameMs));
  }
}

describe("useEqualizer drag writes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    setCustomEqualizerGains(Array.from({ length: 10 }, () => 0));
    engine.android = false;
    engine.resolvedGains = null;
    engine.setEq.mockClear();
    engine.setEqualizer.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it("writes preferences once per 60-move drag while the engine follows every move", () => {
    const storageWrites = vi.spyOn(localStorage, "setItem");
    const prefsEvents = vi.fn();
    window.addEventListener(EQ_PREFS_EVENT, prefsEvents);
    const { result } = renderHook(() => useEqualizer());

    drag(result, 3, 60, 16);
    expect(storageWrites).not.toHaveBeenCalled();
    expect(prefsEvents).not.toHaveBeenCalled();
    expect(engine.setEqualizer).toHaveBeenCalledTimes(60);
    expect(result.current.gains[3]).toBe(0);

    act(() => result.current.commitBand(3, 4.5));

    expect(storageWrites).toHaveBeenCalledTimes(5);
    expect(prefsEvents).toHaveBeenCalledTimes(1);
    expect(result.current.preset).toBe("custom");
    expect(result.current.gains[3]).toBe(4.5);
    expect(getEqualizerGains()[3]).toBe(4.5);
    window.removeEventListener(EQ_PREFS_EVENT, prefsEvents);
    storageWrites.mockRestore();
  });

  it("keeps every edited band of a drag session in the committed gains", () => {
    const { result } = renderHook(() => useEqualizer());

    act(() => result.current.updateBand(1, 3));
    act(() => result.current.updateBand(1, 5));
    act(() => result.current.commitBand(1, 5));
    act(() => result.current.updateBand(2, -2));
    act(() => result.current.commitBand(2, -2));

    expect(result.current.gains.slice(0, 3)).toEqual([0, 5, -2]);
  });

  it.each([
    ["smart", setEqualizerSmart],
    ["adaptive", setEqualizerAdaptive],
    ["genre", setEqualizerGenreAdaptive],
  ] as const)(
    "starts a %s edit from the audible curve and persists manual mode",
    (_mode, enable) => {
      engine.resolvedGains = [4, 3, -1, -3, -2, 1, 3, 5, 5, 5];
      enable(true);
      const { result, unmount } = renderHook(() => useEqualizer());
      act(() => result.current.updateBand(0, 4.5));
      expect(result.current.gains).toEqual([4.5, 3, -1, -3, -2, 1, 3, 5, 5, 5]);
      act(() => result.current.commitBand(0, 4.5));
      expect(getEqualizerSnapshot()).toMatchObject({
        preset: "custom",
        smart: false,
        adaptive: false,
        genreAdaptive: false,
        gains: [4.5, 3, -1, -3, -2, 1, 3, 5, 5, 5],
      });
      unmount();
      const restored = renderHook(() => useEqualizer());
      expect(restored.result.current.gains).toEqual([
        4.5, 3, -1, -3, -2, 1, 3, 5, 5, 5,
      ]);
    },
  );

  it.each([setEqualizerAdaptive, setEqualizerGenreAdaptive])(
    "persists a generic preset as manual after an automatic helper",
    (enable) => {
      enable(true);
      const { result, unmount } = renderHook(() => useEqualizer());
      act(() => result.current.applyPreset("rock"));
      expect(getEqualizerSnapshot()).toMatchObject({
        preset: "rock",
        smart: false,
        adaptive: false,
        genreAdaptive: false,
      });
      unmount();
      const restored = renderHook(() => useEqualizer());
      expect(restored.result.current.smart).toBe(false);
      expect(restored.result.current.adaptive).toBe(false);
      expect(restored.result.current.genreAdaptive).toBe(false);
    },
  );

  it("throttles native setEq to the 15-20 Hz live rate during a drag", () => {
    engine.android = true;
    const { result } = renderHook(() => useEqualizer());

    drag(result, 0, 60, 1000 / 60);

    expect(engine.setEqualizer).not.toHaveBeenCalled();
    expect(engine.setEq.mock.calls.length).toBeGreaterThanOrEqual(15);
    expect(engine.setEq.mock.calls.length).toBeLessThanOrEqual(20);
    expect(NATIVE_EQ_LIVE_INTERVAL_MS).toBeGreaterThanOrEqual(50);
    expect(NATIVE_EQ_LIVE_INTERVAL_MS).toBeLessThanOrEqual(67);
  });

  it("drops a pending native live call when the drag commits", () => {
    engine.android = true;
    const { result } = renderHook(() => useEqualizer());

    act(() => result.current.updateBand(0, 1));
    act(() => result.current.updateBand(0, 2));
    act(() => result.current.commitBand(0, 2));
    act(() => vi.advanceTimersByTime(NATIVE_EQ_LIVE_INTERVAL_MS * 2));

    expect(engine.setEq).toHaveBeenCalledTimes(1);
  });
});
