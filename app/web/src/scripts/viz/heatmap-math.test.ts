import { describe, expect, it } from "vitest";
import {
  generateHeatmap,
  NIGHT_HOURS,
  normalise,
  summarise,
} from "./heatmap-math";

describe("generateHeatmap", () => {
  it("matches the Stats heatmap shape: 7 weekdays x 24 hours of minutes", () => {
    const heatmap = generateHeatmap();
    expect(heatmap.cells).toHaveLength(7);
    heatmap.cells.forEach((row) => {
      expect(row).toHaveLength(24);
      row.forEach((minutes) => expect(minutes).toBeGreaterThanOrEqual(0));
    });
    expect(generateHeatmap()).toEqual(heatmap);
  });

  it("peaks in the evening and has a plausible night share", () => {
    const { peak, night_share } = generateHeatmap();
    expect(peak).not.toBeNull();
    expect(peak!.hour === 0 || peak!.hour >= 20).toBe(true);
    expect(night_share).toBeGreaterThan(0.1);
    expect(night_share).toBeLessThan(0.6);
  });
});

describe("summarise", () => {
  it("uses the backend night hours and picks the busiest cell", () => {
    expect(NIGHT_HOURS).toEqual([22, 23, 0, 1, 2, 3, 4, 5]);
    const cells = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
    cells[2]![23] = 30;
    cells[4]![12] = 10;
    expect(summarise(cells)).toEqual({
      cells,
      peak: { weekday: 2, hour: 23 },
      night_share: 0.75,
    });
  });

  it("returns no peak for an empty week", () => {
    const empty = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
    expect(summarise(empty)).toMatchObject({ peak: null, night_share: 0 });
  });
});

describe("normalise", () => {
  it("rescales a week to a period total without moving the peak", () => {
    const { cells, peak } = generateHeatmap();
    const scaled = normalise(cells, 77040);
    const total = scaled.flat().reduce((sum, minutes) => sum + minutes, 0);
    expect(Math.abs(total - 77040)).toBeLessThan(200);
    expect(summarise(scaled).peak).toEqual(peak);
  });
});
