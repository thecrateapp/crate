import { mulberry32 } from "../field/sources";

export const NIGHT_HOURS = [22, 23, 0, 1, 2, 3, 4, 5];

export interface Heatmap {
  cells: number[][];
  peak: { weekday: number; hour: number } | null;
  night_share: number;
}

function bump(hour: number, centre: number, width: number): number {
  const distance = Math.min(
    Math.abs(hour - centre),
    24 - Math.abs(hour - centre),
  );
  return Math.exp(-((distance / width) ** 2));
}

function weekdayCurve(hour: number): number {
  return (
    0.55 * bump(hour, 8.3, 1) +
    0.25 * bump(hour, 13, 2.6) +
    0.35 * bump(hour, 18, 1.2) +
    0.9 * bump(hour, 22, 1.8) +
    0.04
  );
}

function weekendCurve(hour: number, late: boolean): number {
  return (
    0.45 * bump(hour, 11.5, 2.2) +
    0.4 * bump(hour, 17, 2.5) +
    (late ? 1.05 : 0.7) * bump(hour, late ? 23.4 : 21.5, 2) +
    (late ? 0.3 * bump(hour, 2, 1.4) : 0) +
    0.04
  );
}

export function summarise(cells: number[][]): Heatmap {
  let total = 0;
  let night = 0;
  let peak: Heatmap["peak"] = null;
  let best = 0;
  cells.forEach((row, weekday) =>
    row.forEach((minutes, hour) => {
      total += minutes;
      if (NIGHT_HOURS.includes(hour)) night += minutes;
      if (minutes > best) {
        best = minutes;
        peak = { weekday, hour };
      }
    }),
  );
  return {
    cells,
    peak,
    night_share: total ? Number((night / total).toFixed(4)) : 0,
  };
}

export function normalise(cells: number[][], totalMinutes: number): number[][] {
  const total = cells.flat().reduce((sum, minutes) => sum + minutes, 0);
  if (!total) return cells;
  return cells.map((row) =>
    row.map((minutes) => Math.round((minutes * totalMinutes) / total)),
  );
}

export function generateHeatmap(seed = 11, scale = 90): Heatmap {
  const random = mulberry32(seed);
  const cells = Array.from({ length: 7 }, (_, weekday) =>
    Array.from({ length: 24 }, (_, hour) => {
      const base =
        weekday < 4
          ? weekdayCurve(hour)
          : weekday === 4
            ? 0.5 * weekdayCurve(hour) + 0.5 * weekendCurve(hour, true)
            : weekendCurve(hour, weekday === 5);
      const noise = 0.75 + random() * 0.5;
      return Math.round(base * noise * scale * 10) / 10;
    }),
  );
  return summarise(cells);
}
