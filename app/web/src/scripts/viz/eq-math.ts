export interface Point {
  x: number;
  y: number;
}

export interface Spring {
  value: number;
  velocity: number;
}

export function lerpGains(
  from: readonly number[],
  to: readonly number[],
  t: number,
): number[] {
  const k = Math.min(1, Math.max(0, t));
  return from.map((value, index) => value + ((to[index] ?? 0) - value) * k);
}

export function gainToY(
  gain: number,
  top: number,
  bottom: number,
  max: number,
): number {
  const clamped = Math.max(-max, Math.min(max, gain));
  const mid = (top + bottom) / 2;
  return mid - (clamped / max) * ((bottom - top) / 2);
}

export function bandPoints(
  gains: readonly number[],
  left: number,
  right: number,
  top: number,
  bottom: number,
  max: number,
): Point[] {
  const step = (right - left) / gains.length;
  return gains.map((gain, index) => ({
    x: left + step * (index + 0.5),
    y: gainToY(gain, top, bottom, max),
  }));
}

export function smoothPath(points: readonly Point[]): string {
  if (points.length === 0) return "";
  const f = (n: number) => n.toFixed(1);
  let path = `M${f(points[0]!.x)} ${f(points[0]!.y)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    path += ` C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(p2.x)} ${f(
      p2.y,
    )}`;
  }
  return path;
}

export function stepSpring(
  spring: Spring,
  target: number,
  dt: number,
  stiffness = 170,
  damping = 18,
): Spring {
  const force = (target - spring.value) * stiffness - spring.velocity * damping;
  const velocity = spring.velocity + force * dt;
  return { value: spring.value + velocity * dt, velocity };
}

export function nextInCycle(cycle: readonly string[], current: string): string {
  const index = cycle.indexOf(current);
  return cycle[(index + 1) % cycle.length]!;
}

export function formatGain(gain: number): string {
  const rounded = Math.round(gain);
  if (rounded === 0) return "0";
  return rounded > 0 ? `+${rounded}` : `−${Math.abs(rounded)}`;
}
