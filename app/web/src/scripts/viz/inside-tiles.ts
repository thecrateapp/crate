import { mulberry32 } from "../field/sources";
import { nearestPoints, soundField, type Point } from "./inside-math";

export const FIELD = { width: 240, height: 104 };
export const NEIGHBOURS = 5;
export const PICKS = 3;
export const HEAT = {
  cell: 10,
  tall: 16,
  pitch: 12,
  row: 19,
  width: 24 * 12 - 2,
  height: 7 * 19 - 3,
};

const SPREAD = { x: 112, y: 46 };
const ANCHORS: Point[] = [
  { x: -0.5, y: -0.2 },
  { x: 0.45, y: 0.3 },
  { x: 0.05, y: -0.45 },
  { x: -0.15, y: 0.4 },
];

const toField = (point: Point): Point => ({
  x: FIELD.width / 2 + point.x * SPREAD.x,
  y: FIELD.height / 2 + point.y * SPREAD.y,
});

export function soundPoints(): Point[] {
  return soundField(84, mulberry32(7)).map(toField);
}

export function radioSeeds(points: readonly Point[]): number[] {
  return ANCHORS.map((anchor) => nearestPoints(points, toField(anchor), 1)[0]!);
}
