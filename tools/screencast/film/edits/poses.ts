import type { Pose } from "../edit";

export const REST: Pose = { rotateX: 0, rotateY: 0, scale: 1, x: 0, y: 0 };
export const PUSH: Pose = { rotateX: 0, rotateY: 0, scale: 1.08, x: 0, y: 0 };
export const TILT_LEFT: Pose = {
  rotateX: 8,
  rotateY: -18,
  scale: 0.92,
  x: -40,
  y: 10,
};
export const TILT_RIGHT: Pose = {
  rotateX: 6,
  rotateY: 16,
  scale: 0.95,
  x: 40,
  y: 0,
};
export const HIGH: Pose = { rotateX: 18, rotateY: 0, scale: 0.9, x: 0, y: 40 };
export const LOW: Pose = {
  rotateX: -10,
  rotateY: 6,
  scale: 1.02,
  x: 0,
  y: -20,
};
