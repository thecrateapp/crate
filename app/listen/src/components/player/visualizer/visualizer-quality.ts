export type VisualizerQualityProfileName = "default" | "tauri-linux";

export interface VisualizerQualityProfile {
  maxRenderDimension: number;
  bloomBlurPasses: number;
  bloomResolutionScale: number;
  innerSphereSubdivisions: number;
  middleSphereSubdivisions: number;
  outerSphereSubdivisions: number;
}

export function getVisualizerRenderSize(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  maxRenderDimension: number,
): { width: number; height: number } {
  const dpr =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
      ? Math.min(devicePixelRatio, 2)
      : 1;
  const cap =
    Number.isFinite(maxRenderDimension) && maxRenderDimension > 0
      ? Math.floor(maxRenderDimension)
      : 0;
  const width = Math.max(0, Math.floor(cssWidth * dpr));
  const height = Math.max(0, Math.floor(cssHeight * dpr));
  const longestDimension = Math.max(width, height);
  const scale =
    cap > 0 && longestDimension > 0 ? Math.min(1, cap / longestDimension) : 0;

  return {
    width: Math.floor(width * scale),
    height: Math.floor(height * scale),
  };
}

export const VISUALIZER_QUALITY_PROFILES: Record<
  VisualizerQualityProfileName,
  VisualizerQualityProfile
> = {
  default: {
    maxRenderDimension: 1024,
    bloomBlurPasses: 10,
    bloomResolutionScale: 1,
    innerSphereSubdivisions: 5,
    middleSphereSubdivisions: 4,
    outerSphereSubdivisions: 3,
  },
  "tauri-linux": {
    // Keep the same image quality as the browser. Tauri asks WebKitGTK for
    // hardware acceleration at startup instead of hiding slow rendering by
    // reducing resolution and sphere detail.
    maxRenderDimension: 1024,
    bloomBlurPasses: 10,
    bloomResolutionScale: 1,
    innerSphereSubdivisions: 5,
    middleSphereSubdivisions: 4,
    outerSphereSubdivisions: 3,
  },
};
