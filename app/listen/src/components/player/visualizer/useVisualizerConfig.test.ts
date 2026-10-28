import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MutableRefObject } from "react";

import type { MusicVisualizer } from "./MusicVisualizer";
import { setUiPreferences } from "@crate/ui/lib/interface-preferences";

const { useTrackVisualizerProfileMock } = vi.hoisted(() => ({
  useTrackVisualizerProfileMock: vi.fn(),
}));

vi.mock("./useTrackVisualizerProfile", () => ({
  useTrackVisualizerProfile: useTrackVisualizerProfileMock,
}));

import { useVisualizerConfig } from "./useVisualizerConfig";

const profile = {
  moodTag: null,
  hasAnalysis: false,
  summary: null,
  settingsDelta: {
    separation: 0,
    glow: 0,
    scale: 0,
    persistence: 0,
    octaves: 0,
  },
  motion: {
    orbitSpeed: 1,
    cameraDrift: 1,
    cameraDepth: 0,
    pulseGain: 1,
    turbulence: 1,
    orbitPhase: 0,
    shellDensity: 1,
    beatResponse: 1,
    beatDecay: 0.88,
    sectionRate: 1,
    sectionDepth: 0.12,
    lowBandWeight: 1,
    midBandWeight: 1,
    highBandWeight: 1,
  },
  paletteBias: {
    brightness: 0,
    coolness: 0,
    saturation: 0,
    hueShift: 0,
  },
};

function createVisualizerRef() {
  return {
    current: {
      setMode: vi.fn(),
      accentTrackChange: vi.fn(),
      invalidateFrame: vi.fn(),
      color1: [0, 0, 0],
      color2: [0, 0, 0],
      color3: [0, 0, 0],
    },
  } as unknown as MutableRefObject<MusicVisualizer | null>;
}

describe("useVisualizerConfig", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("listen-player-surface-mode", "visualizer");
    useTrackVisualizerProfileMock.mockReturnValue(profile);
  });

  it("does not reapply unchanged visualizer settings on an unrelated rerender", () => {
    const vizRef = createVisualizerRef();
    const track = { id: "track-1" } as never;

    const { rerender } = renderHook(() =>
      useVisualizerConfig(vizRef, track, true),
    );

    expect(vizRef.current!.setMode).toHaveBeenCalledTimes(1);

    rerender();

    expect(vizRef.current!.setMode).toHaveBeenCalledTimes(1);
  });

  it("reads semantic colors independently of functional preferences", () => {
    let accent = "color(srgb 0.1 0.2 0.3)";
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      get color() {
        return accent;
      },
      getPropertyValue: (name: string) =>
        name === "--accent-action" ? accent : "",
    } as CSSStyleDeclaration);

    const vizRef = createVisualizerRef();
    const { result } = renderHook(() =>
      useVisualizerConfig(vizRef, { id: "track-1" } as never, true),
    );

    expect(result.current.vizEnabled).toBe(true);
    expect(vizRef.current!.color1).toEqual(
      expect.arrayContaining([
        expect.closeTo(0.1),
        expect.closeTo(0.2),
        expect.closeTo(0.3),
      ]),
    );

    accent = "color(srgb 0.8 0.1 0.2)";
    act(() => {
      setUiPreferences({
        density: "compact",
        motion: "reduced",
        effects: "off",
      });
    });

    expect(vizRef.current!.color1).toEqual(
      expect.arrayContaining([
        expect.closeTo(0.1),
        expect.closeTo(0.2),
        expect.closeTo(0.3),
      ]),
    );
  });
});

it("invalidates static output for settings/reset, delayed palette and track changes", async () => {
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem("listen-player-surface-mode", "visualizer");
  useTrackVisualizerProfileMock.mockReturnValue(profile);
  const vizRef = createVisualizerRef();
  const track = { id: "first" } as never;
  const { result, rerender, unmount } = renderHook(
    ({ currentTrack }) => useVisualizerConfig(vizRef, currentTrack, true),
    { initialProps: { currentTrack: track } },
  );
  const invalidate = vi.mocked(vizRef.current!.invalidateFrame);
  expect(invalidate).toHaveBeenCalled();
  invalidate.mockClear();
  act(() =>
    result.current.updateConfig({ ...result.current.vizConfig, glow: 0 }),
  );
  expect(invalidate).toHaveBeenCalled();
  invalidate.mockClear();
  act(() => result.current.resetConfig());
  expect(invalidate).toHaveBeenCalled();
  invalidate.mockClear();
  act(() => vi.advanceTimersByTime(1000));
  expect(invalidate).toHaveBeenCalled();
  invalidate.mockClear();
  rerender({ currentTrack: { id: "second" } as never });
  expect(invalidate).toHaveBeenCalledWith(true);
  unmount();
  vi.useRealTimers();
});
