import type {
  EffectiveEq,
  EqDataStatus,
  EqFeatures,
  TrackGenre,
} from "../../lib/equalizer-types";
import type { EqPresetName } from "../../lib/equalizer";
export interface EqualizerPanelState {
  enabled: boolean;
  preset: string;
  gains: readonly number[];
  smart: boolean;
  adaptive: boolean;
  genreAdaptive: boolean;
  smartStatus: EqDataStatus;
  adaptiveStatus: EqDataStatus;
  genreAdaptiveStatus: EqDataStatus;
  effectiveEq: EffectiveEq | null;
  adaptiveFeatures: EqFeatures | null;
  trackGenre: TrackGenre | null;
  toggleEnabled: (enabled: boolean) => void;
  toggleSmart: (enabled: boolean) => void;
  toggleAdaptive: (enabled: boolean) => void;
  toggleGenreAdaptive: (enabled: boolean) => void;
  applyPreset: (preset: EqPresetName) => void;
  updateBand: (band: number, gain: number) => void;
  commitBand: (band: number, gain: number) => void;
  resetToFlat: () => void;
}
