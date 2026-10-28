import { useMemo, type MutableRefObject } from "react";

import type { CrossfadeTransition } from "@/contexts/PlayerContext";
import type { Track } from "@/contexts/player-types";
import {
  resolveVisualizerSettings,
  type VisualizerPanelState,
} from "./visualizer-settings";
import { type PlayerSurfaceMode } from "@/lib/player-visualizer-prefs";
import type { MusicVisualizer } from "./MusicVisualizer";
import {
  useTrackVisualizerProfile,
  type VisualizerTrackProfile,
} from "./useTrackVisualizerProfile";
import { useVisualizerEngineSettings } from "./useVisualizerEngineSettings";
import { useVisualizerPalette } from "./useVisualizerPalette";
import { useVisualizerPreferences } from "./useVisualizerPreferences";

const ZERO_VIZ_DELTA = {
  separation: 0,
  glow: 0,
  scale: 0,
  persistence: 0,
  octaves: 0,
} as const;

export interface VisualizerConfigState extends VisualizerPanelState {
  trackVizProfile: VisualizerTrackProfile;
  setSurfaceMode: (mode: PlayerSurfaceMode) => void;
}

export function useVisualizerConfig(
  vizRef: MutableRefObject<MusicVisualizer | null>,
  currentTrack: Track | undefined,
  isOpen: boolean,
  crossfadeTransition: CrossfadeTransition | null = null,
  visualizerAllowed = true,
): VisualizerConfigState {
  const {
    surfaceModePreference,
    useAlbumPalette,
    trackAdaptiveViz,
    vizConfig,
    setSurfaceMode,
    toggleAlbumPalette,
    toggleTrackAdaptive,
    updateConfig,
    resetConfig,
  } = useVisualizerPreferences(visualizerAllowed);
  const surfaceMode =
    visualizerAllowed || surfaceModePreference !== "visualizer"
      ? surfaceModePreference
      : "cover";
  const trackVizProfile = useTrackVisualizerProfile(
    currentTrack,
    visualizerAllowed && trackAdaptiveViz,
  );
  const vizEnabled = visualizerAllowed && surfaceMode === "visualizer";

  const effectiveVizDelta = trackAdaptiveViz
    ? trackVizProfile.settingsDelta
    : ZERO_VIZ_DELTA;
  const effectiveVizConfig = useMemo(
    () => resolveVisualizerSettings(vizConfig, effectiveVizDelta),
    [effectiveVizDelta, vizConfig],
  );

  useVisualizerPalette({
    vizRef,
    currentTrack,
    isOpen,
    crossfadeTransition,
    trackAdaptiveViz,
    trackVizProfile,
    useAlbumPalette,
    vizEnabled,
  });

  useVisualizerEngineSettings({
    vizRef,
    currentTrack,
    isOpen,
    trackAdaptiveViz,
    trackVizProfile,
    effectiveVizConfig,
    vizEnabled,
  });

  return {
    surfaceMode,
    vizEnabled,
    useAlbumPalette,
    trackAdaptiveViz,
    vizConfig,
    effectiveVizConfig,
    trackVizProfile,
    setSurfaceMode,
    toggleAlbumPalette,
    toggleTrackAdaptive,
    updateConfig,
    resetConfig,
  };
}
