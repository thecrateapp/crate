import { clamp } from "../../../lib/utils";
import type {
  PlayerSurfaceMode,
  VisualizerSettingsPreference,
} from "../../../lib/player-visualizer-prefs";
export function resolveVisualizerSettings(
  base: VisualizerSettingsPreference,
  delta?: VisualizerSettingsPreference,
): VisualizerSettingsPreference {
  return {
    separation: clamp(base.separation + (delta?.separation ?? 0), 0, 0.5),
    glow: clamp(base.glow + (delta?.glow ?? 0), 0, 15),
    scale: clamp(base.scale + (delta?.scale ?? 0), 0.2, 3),
    persistence: clamp(base.persistence + (delta?.persistence ?? 0), 0, 2),
    octaves: clamp(base.octaves + (delta?.octaves ?? 0), 1, 5),
  };
}

/** Portable settings contract; authenticated profile/palette lifecycle stays in the hook. */
export interface VisualizerPanelState {
  surfaceMode: PlayerSurfaceMode;
  vizEnabled: boolean;
  useAlbumPalette: boolean;
  trackAdaptiveViz: boolean;
  vizConfig: VisualizerSettingsPreference;
  effectiveVizConfig: VisualizerSettingsPreference;
  trackVizProfile: { hasAnalysis: boolean; summary: string | null };
  toggleAlbumPalette: () => void;
  toggleTrackAdaptive: () => void;
  updateConfig: (next: VisualizerSettingsPreference) => void;
  resetConfig: () => void;
}
