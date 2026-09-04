export const SPECTRUM_RIBBON_COLOR_TOKENS = [
  "--visualizer-ribbon-stop-0",
  "--visualizer-ribbon-stop-1",
  "--visualizer-ribbon-stop-2",
  "--visualizer-ribbon-stop-3",
  "--visualizer-ribbon-stop-4",
  "--visualizer-ribbon-stop-5",
  "--visualizer-ribbon-stop-6",
] as const;

export const WAVEFORM_COLOR_TOKENS = {
  activeGradientBottom: "--visualizer-waveform-gradient-active-bottom",
  activeGradientTop: "--visualizer-waveform-gradient-active-top",
  idleGradientBottom: "--visualizer-waveform-gradient-idle-bottom",
  idleGradientTop: "--visualizer-waveform-gradient-idle-top",
  peakActive: "--visualizer-waveform-peak-active",
  peakIdle: "--visualizer-waveform-peak-idle",
} as const;
