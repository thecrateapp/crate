import { resolveVisualizerSettings } from "../../../app/listen/src/components/player/visualizer/visualizer-settings";
import { DEFAULT_PROFILE } from "../../../app/listen/src/components/player/visualizer/visualizer-track-profile-model";
import {
  DEFAULT_VISUALIZER_SETTINGS,
  type PlayerSurfaceMode,
} from "../../../app/listen/src/lib/player-visualizer-prefs";
export const VISUALIZER_SCENARIOS = [
  "saved",
  "adaptive",
  "waiting",
  "zero",
  "long",
  "cd",
  "cover",
  "unavailable",
] as const;
export type VisualizerScenario = (typeof VISUALIZER_SCENARIOS)[number];
export function visualizerFixture(scenario: VisualizerScenario) {
  const adaptive = ["adaptive", "waiting", "zero", "long"].includes(scenario);
  const settings = {
    ...DEFAULT_VISUALIZER_SETTINGS,
    separation: 0.15,
    ...(scenario === "zero" ? { glow: 0 } : {}),
  };
  const surfaceMode: PlayerSurfaceMode =
    scenario === "cd"
      ? "cd"
      : scenario === "cover" || scenario === "unavailable"
        ? "cover"
        : "visualizer";
  const analysis = adaptive && scenario !== "waiting";
  const profile = {
    ...DEFAULT_PROFILE,
    settingsDelta: {
      ...DEFAULT_PROFILE.settingsDelta,
      ...(analysis && scenario !== "zero" ? { separation: 0.09, glow: 3 } : {}),
    },
    hasAnalysis: analysis,
    summary:
      scenario === "long"
        ? "An evolving arrangement with spacious percussion, very low recorded energy and a long descriptive analysis that remains readable inside a narrow settings panel."
        : analysis
          ? "Dark · 124 BPM"
          : null,
  };
  return {
    surfaceMode,
    vizEnabled: surfaceMode === "visualizer",
    trackAdaptiveViz: adaptive,
    useAlbumPalette: true,
    vizConfig: settings,
    effectiveVizConfig: resolveVisualizerSettings(
      settings,
      adaptive ? profile.settingsDelta : undefined,
    ),
    trackVizProfile: profile,
  };
}
