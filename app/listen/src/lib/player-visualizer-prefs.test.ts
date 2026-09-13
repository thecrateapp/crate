import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_VISUALIZER_SETTINGS,
  getVisualizerSettingsPreference,
} from "./player-visualizer-prefs";

describe("player visualizer preferences", () => {
  beforeEach(() => localStorage.clear());

  it("returns defaults without persisted settings", () => {
    expect(getVisualizerSettingsPreference()).toEqual(
      DEFAULT_VISUALIZER_SETTINGS,
    );
  });

  it("migrates settings stored with the legacy key", () => {
    const settings = {
      separation: 0.2,
      glow: 4,
      scale: 1.8,
      persistence: 0.5,
      octaves: 3,
    };
    localStorage.setItem("listen-viz-settings", JSON.stringify(settings));

    expect(getVisualizerSettingsPreference()).toEqual(settings);
    expect(localStorage.getItem("listen-viz-settings:v1")).toBe(
      JSON.stringify(settings),
    );
    expect(localStorage.getItem("listen-viz-settings")).toBeNull();
  });
});
