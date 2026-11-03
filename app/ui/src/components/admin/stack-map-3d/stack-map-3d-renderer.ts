import type { StackMapConnection, StackMapService } from "../stack-map-model";
import type { CameraState, Projection } from "./stack-map-3d-camera";
import type { Edge3D, Scene3D, Vec3 } from "./stack-map-3d-model";
import type { StackMap3DTokens } from "./stack-map-3d-tokens";

export interface Highlight {
  active: Set<StackMapConnection>;
  live: Set<StackMapConnection>;
  activeIds: Set<string>;
  previewing: boolean;
  selectedId: string | null;
  hoveredId: string | null;
}

export interface VisibleDot {
  position: Vec3;
  opacity: number;
  error: boolean;
  edge: Edge3D;
  travelled: number;
  reverse: boolean;
  beam: boolean;
}

export interface FrameInput {
  projection: Projection;
  camera: CameraState;
  highlight: Highlight;
  dots: VisibleDot[];
  levels: Map<string, number>;
  levelsPaused: boolean;
}

export interface StackMapRenderer {
  render(input: FrameInput): void;
  dispose(): void;
}

export type RendererFactory = (
  container: HTMLElement,
  scene: Scene3D,
  options: {
    health: Map<string, StackMapService["health"]>;
    tokens: StackMap3DTokens;
    onContextLost: () => void;
    onQuality: (quality: "full" | "reduced") => void;
  },
) => StackMapRenderer;
