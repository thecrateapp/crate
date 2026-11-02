import { mat4, vec4 } from "gl-matrix";
import {
  DEFAULT_POLAR,
  MAX_POLAR,
  type Scene3D,
  type Vec3,
} from "./stack-map-3d-model";

export interface CameraState {
  target: Vec3;
  azimuth: number;
  polar: number;
  distance: number;
}

export const FOV = (34 * Math.PI) / 180;
const NEAR = 0.1;
const FAR = 200;
const MIN_POLAR = 0;

export interface Projection {
  viewProjection: mat4;
  eye: Vec3;
  target: Vec3;
  up: Vec3;
  width: number;
  height: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
  depth: number;
  visible: boolean;
}

export function cameraVectors(state: CameraState) {
  const { azimuth: a, polar: p, distance: d, target } = state;
  const eye: Vec3 = [
    target[0] + d * Math.sin(p) * Math.sin(a),
    target[1] + d * Math.cos(p),
    target[2] + d * Math.sin(p) * Math.cos(a),
  ];
  const up: Vec3 = [
    -Math.cos(p) * Math.sin(a),
    Math.sin(p),
    -Math.cos(p) * Math.cos(a),
  ];
  return { eye, up };
}

export function projectionFor(
  state: CameraState,
  width: number,
  height: number,
): Projection {
  const { eye, up } = cameraVectors(state);
  const projection = mat4.perspective(
    mat4.create(),
    FOV,
    width / Math.max(1, height),
    NEAR,
    FAR,
  );
  const view = mat4.lookAt(mat4.create(), eye, state.target, up);
  return {
    viewProjection: mat4.multiply(mat4.create(), projection, view),
    eye,
    target: state.target,
    up,
    width,
    height,
  };
}

const scratch = vec4.create();

export function project(projection: Projection, point: Vec3): ScreenPoint {
  vec4.set(scratch, point[0], point[1], point[2], 1);
  vec4.transformMat4(scratch, scratch, projection.viewProjection);
  const w = scratch[3];
  if (w <= 0) return { x: 0, y: 0, depth: w, visible: false };
  return {
    x: ((scratch[0] / w + 1) / 2) * projection.width,
    y: ((1 - scratch[1] / w) / 2) * projection.height,
    depth: w,
    visible: true,
  };
}

export function fitDistance(scene: Scene3D, aspect: number) {
  const halfWidth = (scene.bounds.max[0] - scene.bounds.min[0]) / 2;
  const halfDepth = (scene.bounds.max[2] - scene.bounds.min[2]) / 2;
  const vertical = Math.tan(FOV / 2);
  const horizontal = vertical * aspect;
  return Math.max(halfWidth / horizontal, (halfDepth * 1.15) / vertical) * 1.16;
}

export function defaultCamera(scene: Scene3D, aspect: number): CameraState {
  return {
    target: [...scene.bounds.center] as Vec3,
    azimuth: 0,
    polar: DEFAULT_POLAR,
    distance: fitDistance(scene, aspect),
  };
}

export function topDownCamera(scene: Scene3D, aspect: number): CameraState {
  return {
    ...defaultCamera(scene, aspect),
    target: [scene.bounds.center[0], 0, scene.bounds.center[2]],
    polar: 0,
    distance: fitDistance(scene, aspect) * 1.12,
  };
}

export function clampCamera(
  state: CameraState,
  scene: Scene3D,
  aspect: number,
): CameraState {
  const fit = fitDistance(scene, aspect);
  const { min, max } = scene.bounds;
  return {
    azimuth: state.azimuth,
    polar: Math.max(MIN_POLAR, Math.min(MAX_POLAR, state.polar)),
    distance: Math.max(fit * 0.32, Math.min(fit * 1.8, state.distance)),
    target: [
      Math.max(min[0], Math.min(max[0], state.target[0])),
      Math.max(0, Math.min(max[1], state.target[1])),
      Math.max(min[2], Math.min(max[2], state.target[2])),
    ],
  };
}

const easeInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

function lerpAngle(a: number, b: number, t: number) {
  let delta = (b - a) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return a + delta * t;
}

export function interpolateCamera(
  from: CameraState,
  to: CameraState,
  t: number,
  swoop = 0,
): CameraState {
  const k = easeInOut(t);
  const lift = Math.sin(Math.PI * k) * swoop;
  return {
    azimuth: lerpAngle(from.azimuth, to.azimuth, k),
    polar: from.polar + (to.polar - from.polar) * k,
    distance: (from.distance + (to.distance - from.distance) * k) * (1 + lift),
    target: [
      from.target[0] + (to.target[0] - from.target[0]) * k,
      from.target[1] + (to.target[1] - from.target[1]) * k,
      from.target[2] + (to.target[2] - from.target[2]) * k,
    ],
  };
}

export interface OrbitController {
  get(): CameraState;
  set(state: CameraState, animate?: number, swoop?: number): void;
  orbit(dAzimuth: number, dPolar: number): void;
  zoom(factor: number): void;
  isAnimating(): boolean;
  dispose(): void;
}

export function createOrbitController({
  element,
  scene,
  initial,
  aspect,
  onChange,
}: {
  element: HTMLElement;
  scene: Scene3D;
  initial: CameraState;
  aspect: () => number;
  onChange: (state: CameraState) => void;
}): OrbitController {
  let state = clampCamera(initial, scene, aspect());
  let tween = 0;
  let drag: {
    id: number;
    x: number;
    y: number;
    pan: boolean;
  } | null = null;

  const commit = (next: CameraState) => {
    state = clampCamera(next, scene, aspect());
    onChange(state);
  };
  const stopTween = () => {
    if (tween) window.cancelAnimationFrame(tween);
    tween = 0;
  };

  const onPointerDown = (event: PointerEvent) => {
    if ((event.target as HTMLElement).closest("button")) return;
    stopTween();
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      pan: event.button === 2 || event.shiftKey,
    };
    element.setPointerCapture(event.pointerId);
    element.dataset.dragging = "true";
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (drag.pan) {
      const unitsPerPixel =
        (2 * state.distance * Math.tan(FOV / 2)) / element.clientHeight;
      const a = state.azimuth;
      const right: Vec3 = [Math.cos(a), 0, -Math.sin(a)];
      const forward: Vec3 = [-Math.sin(a), 0, -Math.cos(a)];
      const k = unitsPerPixel;
      commit({
        ...state,
        target: [
          state.target[0] - right[0] * dx * k + forward[0] * dy * k,
          state.target[1],
          state.target[2] - right[2] * dx * k + forward[2] * dy * k,
        ],
      });
    } else {
      commit({
        ...state,
        azimuth: state.azimuth - dx * 0.006,
        polar: state.polar - dy * 0.005,
      });
    }
  };
  const onPointerUp = (event: PointerEvent) => {
    if (!drag || drag.id !== event.pointerId) return;
    drag = null;
    delete element.dataset.dragging;
  };
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    stopTween();
    commit({
      ...state,
      distance: state.distance * Math.exp(event.deltaY * 0.0012),
    });
  };
  const onContextMenu = (event: Event) => event.preventDefault();

  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("pointermove", onPointerMove);
  element.addEventListener("pointerup", onPointerUp);
  element.addEventListener("pointercancel", onPointerUp);
  element.addEventListener("wheel", onWheel, { passive: false });
  element.addEventListener("contextmenu", onContextMenu);

  return {
    get: () => state,
    set(next, animate = 0, swoop = 0) {
      stopTween();
      const target = clampCamera(next, scene, aspect());
      if (!animate) {
        commit(target);
        return;
      }
      const from = state;
      const start = performance.now();
      const step = (time: number) => {
        const t = Math.min(1, (time - start) / animate);
        commit(interpolateCamera(from, target, t, swoop));
        tween = t < 1 ? window.requestAnimationFrame(step) : 0;
      };
      tween = window.requestAnimationFrame(step);
    },
    orbit(dAzimuth, dPolar) {
      stopTween();
      commit({
        ...state,
        azimuth: state.azimuth + dAzimuth,
        polar: state.polar + dPolar,
      });
    },
    isAnimating: () => tween !== 0,
    zoom(factor) {
      stopTween();
      commit({ ...state, distance: state.distance * factor });
    },
    dispose() {
      stopTween();
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", onPointerUp);
      element.removeEventListener("pointercancel", onPointerUp);
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("contextmenu", onContextMenu);
    },
  };
}
