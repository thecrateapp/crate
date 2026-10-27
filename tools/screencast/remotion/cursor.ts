import type { CaptureEvent, Point } from "../events";

export interface CursorState extends Point {
  pulse: number;
}

const TRAVEL = 0.8;
const PULSE = 0.35;

function smoothstep(u: number): number {
  return u * u * (3 - 2 * u);
}

function catmullRom(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  u: number,
): number {
  return (
    0.5 *
    (2 * p1 +
      (p2 - p0) * u +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u +
      (3 * p1 - p0 - 3 * p2 + p3) * u * u * u)
  );
}

export function cursorAt(
  events: CaptureEvent[],
  time: number,
  origin: Point,
): CursorState {
  const sorted = [...events].sort((a, b) => a.t - b.t);
  const points = [{ t: 0, x: origin.x, y: origin.y }, ...sorted];

  const lastClick = sorted
    .filter((event) => event.type === "click" && event.t <= time)
    .at(-1);
  const sinceClick = lastClick ? time - lastClick.t : Infinity;
  const pulse = sinceClick < PULSE ? 1 - sinceClick / PULSE : 0;

  const next = points.findIndex((point, index) => index > 0 && point.t >= time);
  if (next === -1) {
    const last = points[points.length - 1];
    return { x: last.x, y: last.y, pulse };
  }

  const from = points[next - 1];
  const to = points[next];
  const departure = Math.max(from.t, to.t - TRAVEL);
  if (time <= departure || to.t === departure) {
    const at = time >= to.t ? to : from;
    return { x: at.x, y: at.y, pulse };
  }

  const u = smoothstep((time - departure) / (to.t - departure));
  const before = points[next - 2] ?? from;
  const after = points[next + 1] ?? to;
  return {
    x: catmullRom(before.x, from.x, to.x, after.x, u),
    y: catmullRom(before.y, from.y, to.y, after.y, u),
    pulse,
  };
}
