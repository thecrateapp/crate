import { expect, it } from "vitest";
import { DEFAULT_VISUALIZER_SETTINGS } from "../../../lib/player-visualizer-prefs";
import { resolveVisualizerSettings } from "./visualizer-settings";
it("keeps saved settings without adaptation and preserves real zero deltas", () => {
  expect(resolveVisualizerSettings(DEFAULT_VISUALIZER_SETTINGS)).toEqual(
    DEFAULT_VISUALIZER_SETTINGS,
  );
  expect(
    resolveVisualizerSettings(
      { ...DEFAULT_VISUALIZER_SETTINGS, glow: 0 },
      { separation: 0, glow: 0, scale: 0, persistence: 0, octaves: 0 },
    ).glow,
  ).toBe(0);
});
it("adds the real profile deltas and clamps every native control range", () => {
  expect(
    resolveVisualizerSettings(DEFAULT_VISUALIZER_SETTINGS, {
      separation: 10,
      glow: -30,
      scale: 10,
      persistence: -20,
      octaves: 10,
    }),
  ).toEqual({ separation: 0.5, glow: 0, scale: 3, persistence: 0, octaves: 5 });
});
