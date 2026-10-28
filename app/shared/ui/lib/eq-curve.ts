export const EQ_CHART_BANDS = [
  { freq: 32, label: "32" },
  { freq: 64, label: "64" },
  { freq: 125, label: "125" },
  { freq: 250, label: "250" },
  { freq: 500, label: "500" },
  { freq: 1000, label: "1K" },
  { freq: 2000, label: "2K" },
  { freq: 4000, label: "4K" },
  { freq: 8000, label: "8K" },
  { freq: 16000, label: "16K" },
] as const;

export const EQ_CHART_GAIN_MIN = -12;
export const EQ_CHART_GAIN_MAX = 12;
export const EQ_CHART_GAIN_RANGE = EQ_CHART_GAIN_MAX - EQ_CHART_GAIN_MIN;
export const EQ_CHART_GAIN_STEP = 0.5;
export const EQ_CHART_GAIN_PAGE_STEP = 3;

export function clampGain(gain: number): number {
  return Math.max(EQ_CHART_GAIN_MIN, Math.min(EQ_CHART_GAIN_MAX, gain));
}

export function snapGain(raw: number): number {
  return Math.round(clampGain(raw) / EQ_CHART_GAIN_STEP) * EQ_CHART_GAIN_STEP;
}

export function formatGain(gain: number): string {
  const rounded = Math.round(gain * 10) / 10;
  if (rounded === 0) return "0";
  return rounded > 0 ? `+${rounded}` : `−${Math.abs(rounded)}`;
}

export function gainToY(gain: number): number {
  return ((EQ_CHART_GAIN_MAX - clampGain(gain)) / EQ_CHART_GAIN_RANGE) * 100;
}

export function bandX(index: number): number {
  return ((index + 0.5) / EQ_CHART_BANDS.length) * 100;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function eqCurvePath(gains: readonly number[]): string {
  const points = EQ_CHART_BANDS.map((_, index) => ({
    x: bandX(index),
    y: gainToY(gains[index] ?? 0),
  }));

  return points.reduce((path, point, index) => {
    if (index === 0) return `M${round(point.x)} ${round(point.y)}`;
    const p0 = points[index - 2] ?? points[index - 1]!;
    const p1 = points[index - 1]!;
    const p3 = points[index + 1] ?? point;
    const c1x = p1.x + (point.x - p0.x) / 6;
    const c1y = p1.y + (point.y - p0.y) / 6;
    const c2x = point.x - (p3.x - p1.x) / 6;
    const c2y = point.y - (p3.y - p1.y) / 6;
    return `${path} C${round(c1x)} ${round(c1y)} ${round(c2x)} ${round(
      c2y,
    )} ${round(point.x)} ${round(point.y)}`;
  }, "");
}
