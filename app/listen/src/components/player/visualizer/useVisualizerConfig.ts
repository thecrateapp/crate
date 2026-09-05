import { useEffect, useState, type MutableRefObject } from "react";

import type { CrossfadeTransition } from "@/contexts/PlayerContext";
import type { Track } from "@/contexts/player-types";
import {
  DEFAULT_VISUALIZER_SETTINGS,
  PLAYER_VIZ_PREFS_EVENT,
  getTrackAdaptiveVisualizerPreference,
  getPlayerSurfaceModePreference,
  getUseAlbumPalettePreference,
  getVisualizerSettingsPreference,
  setPlayerSurfaceModePreference,
  setTrackAdaptiveVisualizerPreference,
  setUseAlbumPalettePreference,
  setVisualizerSettingsPreference,
  type PlayerSurfaceMode,
  type VisualizerSettingsPreference,
} from "@/lib/player-visualizer-prefs";
import type { MusicVisualizer } from "./MusicVisualizer";
import {
  useTrackVisualizerProfile,
  type VisualizerTrackProfile,
} from "./useTrackVisualizerProfile";
import { clamp } from "./visualizer-palette-math";
import { useVisualizerPalette } from "./useVisualizerPalette";

const ZERO_VIZ_DELTA = {
  separation: 0,
  glow: 0,
  scale: 0,
  persistence: 0,
  octaves: 0,
} as const;

export interface VisualizerConfigState {
  surfaceMode: PlayerSurfaceMode;
  vizEnabled: boolean;
  useAlbumPalette: boolean;
  trackAdaptiveViz: boolean;
  vizConfig: VisualizerSettingsPreference;
  effectiveVizConfig: VisualizerSettingsPreference;
  trackVizProfile: VisualizerTrackProfile;
  setSurfaceMode: (mode: PlayerSurfaceMode) => void;
  toggleAlbumPalette: () => void;
  toggleTrackAdaptive: () => void;
  updateConfig: (next: VisualizerSettingsPreference) => void;
  resetConfig: () => void;
}

export function useVisualizerConfig(
  vizRef: MutableRefObject<MusicVisualizer | null>,
  currentTrack: Track | undefined,
  isOpen: boolean,
  crossfadeTransition: CrossfadeTransition | null = null,
  visualizerAllowed = true,
): VisualizerConfigState {
  const [surfaceModePreference, setSurfaceModeState] = useState(
    getPlayerSurfaceModePreference,
  );
  const [useAlbumPalette, setUseAlbumPalette] = useState(
    getUseAlbumPalettePreference,
  );
  const [trackAdaptiveViz, setTrackAdaptiveViz] = useState(
    getTrackAdaptiveVisualizerPreference,
  );
  const [vizConfig, setVizConfig] = useState(getVisualizerSettingsPreference);
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
  const effectiveVizConfig = {
    separation: clamp(
      vizConfig.separation + effectiveVizDelta.separation,
      0,
      0.5,
    ),
    glow: clamp(vizConfig.glow + effectiveVizDelta.glow, 0, 15),
    scale: clamp(vizConfig.scale + effectiveVizDelta.scale, 0.2, 3),
    persistence: clamp(
      vizConfig.persistence + effectiveVizDelta.persistence,
      0,
      2,
    ),
    octaves: clamp(vizConfig.octaves + effectiveVizDelta.octaves, 1, 5),
  };

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

  // Sync preferences from storage events
  useEffect(() => {
    const sync = () => {
      setSurfaceModeState(getPlayerSurfaceModePreference());
      setUseAlbumPalette(getUseAlbumPalettePreference());
      setVizConfig(getVisualizerSettingsPreference());
      setTrackAdaptiveViz(getTrackAdaptiveVisualizerPreference());
    };
    window.addEventListener("storage", sync);
    window.addEventListener(PLAYER_VIZ_PREFS_EVENT, sync as EventListener);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(PLAYER_VIZ_PREFS_EVENT, sync as EventListener);
    };
  }, []);

  // Apply config to visualizer
  useEffect(() => {
    if (!isOpen || !vizEnabled) return;

    const timers: number[] = [];

    const apply = (attempt = 0) => {
      if (vizRef.current) {
        vizRef.current.setMode("spheres");
        vizRef.current.separation = effectiveVizConfig.separation;
        vizRef.current.glow = effectiveVizConfig.glow;
        vizRef.current.scale = effectiveVizConfig.scale;
        vizRef.current.persistence = effectiveVizConfig.persistence;
        vizRef.current.octaves = effectiveVizConfig.octaves;
        vizRef.current.orbitSpeed = trackAdaptiveViz
          ? trackVizProfile.motion.orbitSpeed
          : 1;
        vizRef.current.cameraDrift = trackAdaptiveViz
          ? trackVizProfile.motion.cameraDrift
          : 1;
        vizRef.current.cameraDepth = trackAdaptiveViz
          ? trackVizProfile.motion.cameraDepth
          : 0;
        vizRef.current.pulseGain = trackAdaptiveViz
          ? trackVizProfile.motion.pulseGain
          : 1;
        vizRef.current.turbulence = trackAdaptiveViz
          ? trackVizProfile.motion.turbulence
          : 1;
        vizRef.current.orbitPhase = trackAdaptiveViz
          ? trackVizProfile.motion.orbitPhase
          : 0;
        vizRef.current.shellDensity = trackAdaptiveViz
          ? trackVizProfile.motion.shellDensity
          : 1;
        vizRef.current.beatResponse = trackAdaptiveViz
          ? trackVizProfile.motion.beatResponse
          : 1;
        vizRef.current.beatDecay = trackAdaptiveViz
          ? trackVizProfile.motion.beatDecay
          : 0.88;
        vizRef.current.sectionRate = trackAdaptiveViz
          ? trackVizProfile.motion.sectionRate
          : 1;
        vizRef.current.sectionDepth = trackAdaptiveViz
          ? trackVizProfile.motion.sectionDepth
          : 0.12;
        vizRef.current.lowBandWeight = trackAdaptiveViz
          ? trackVizProfile.motion.lowBandWeight
          : 1;
        vizRef.current.midBandWeight = trackAdaptiveViz
          ? trackVizProfile.motion.midBandWeight
          : 1;
        vizRef.current.highBandWeight = trackAdaptiveViz
          ? trackVizProfile.motion.highBandWeight
          : 1;
        return;
      }
      if (attempt < 8) {
        timers.push(window.setTimeout(() => apply(attempt + 1), 80));
      }
    };
    apply();
    timers.push(window.setTimeout(() => apply(), 300));
    return () => {
      for (const t of timers) window.clearTimeout(t);
    };
  }, [
    currentTrack?.id,
    effectiveVizConfig,
    isOpen,
    trackAdaptiveViz,
    trackVizProfile,
    vizEnabled,
    vizRef,
  ]);

  // Accent on track change
  useEffect(() => {
    if (!isOpen || !vizEnabled || !currentTrack) return;
    let attempts = 0;
    let timer = 0;
    const applyAccent = () => {
      attempts += 1;
      if (vizRef.current) {
        vizRef.current.accentTrackChange(trackAdaptiveViz ? 1 : 0.75);
        return;
      }
      if (attempts < 8) timer = window.setTimeout(applyAccent, 80);
    };
    applyAccent();
    return () => window.clearTimeout(timer);
  }, [currentTrack?.id, isOpen, trackAdaptiveViz, vizEnabled, vizRef]);

  const setSurfaceMode = (mode: PlayerSurfaceMode) => {
    const next = !visualizerAllowed && mode === "visualizer" ? "cover" : mode;
    setSurfaceModeState(next);
    setPlayerSurfaceModePreference(next);
  };

  const toggleAlbumPalette = () => {
    const next = !useAlbumPalette;
    setUseAlbumPalette(next);
    setUseAlbumPalettePreference(next);
  };

  const toggleTrackAdaptive = () => {
    const next = !trackAdaptiveViz;
    setTrackAdaptiveViz(next);
    setTrackAdaptiveVisualizerPreference(next);
  };

  const updateConfig = (next: VisualizerSettingsPreference) => {
    setVizConfig(next);
    setVisualizerSettingsPreference(next);
  };

  const resetConfig = () => updateConfig(DEFAULT_VISUALIZER_SETTINGS);

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
