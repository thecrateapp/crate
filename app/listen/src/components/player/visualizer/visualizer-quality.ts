export type VisualizerQualityProfileName = "default" | "tauri-linux";

export interface VisualizerQualityProfile {
  maxRenderDimension: number;
  bloomBlurPasses: number;
  bloomResolutionScale: number;
  innerSphereSubdivisions: number;
  middleSphereSubdivisions: number;
  outerSphereSubdivisions: number;
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
