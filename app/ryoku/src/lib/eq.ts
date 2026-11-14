/** The equalizer chart of crate-mark's panel: bands across, -12 to +12 dB down to up. */

export const MAX_DB = 12;

export const bandX = (index: number, count: number, width: number) =>
  ((index + 0.5) / count) * width;

export const gainY = (gain: number, height: number) => ((MAX_DB - gain) / (2 * MAX_DB)) * height;

/**
 * Samples the Catmull-Rom curve through the band gains, the same curve crate-mark draws,
 * from the first band's x to the last's. Points stay inside the chart.
 */
export function curve(
  gains: number[],
  width: number,
  height: number,
  samples = 200,
): [number, number][] {
  const n = gains.length;
  if (n === 0 || samples < 2) return [];
  const knots = gains.map((gain, i): [number, number] => [bandX(i, n, width), gainY(gain, height)]);
  if (n === 1) return Array.from({ length: samples }, () => knots[0]);

  const at = (i: number) => knots[Math.min(n - 1, Math.max(0, i))];
  const segments = n - 1;
  const points: [number, number][] = [];
  for (let s = 0; s < samples; s++) {
    const u = (s / (samples - 1)) * segments;
    const k = Math.min(segments - 1, Math.floor(u));
    const t = u - k;
    const [p0, p1, p2, p3] = [at(k - 1), at(k), at(k + 1), at(k + 2)];
    // Cubic Bezier with the Catmull-Rom control points crate-mark uses (tension 1/6).
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    const mt = 1 - t;
    const bez = (a: number, b: number, c: number, d: number) =>
      mt * mt * mt * a + 3 * mt * mt * t * b + 3 * mt * t * t * c + t * t * t * d;
    const x = bez(p1[0], c1[0], c2[0], p2[0]);
    const y = bez(p1[1], c1[1], c2[1], p2[1]);
    points.push([x, Math.min(height, Math.max(0, y))]);
  }
  return points;
}

/** The SVG path crate-mark builds from the same control points. */
export function curvePath(gains: number[], width: number, height: number): string {
  const n = gains.length;
  if (n === 0) return "";
  const p = gains.map((gain, i): [number, number] => [bandX(i, n, width), gainY(gain, height)]);
  const at = (i: number) => p[Math.min(n - 1, Math.max(0, i))];
  let d = `M ${p[0][0]} ${p[0][1]}`;
  for (let k = 0; k < n - 1; k++) {
    const [p0, p1, p2, p3] = [at(k - 1), at(k), at(k + 1), at(k + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2[0]} ${p2[1]}`;
  }
  return d;
}

/** Gain after a pointer at y, in crate-mark's 0.5 dB steps. */
export const gainAt = (y: number, height: number) =>
  Math.round(Math.min(MAX_DB, Math.max(-MAX_DB, MAX_DB - (y / height) * 2 * MAX_DB)) * 2) / 2;
