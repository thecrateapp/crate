import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MutableRefObject } from "react";

import type { MusicVisualizer } from "./MusicVisualizer";

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
});
