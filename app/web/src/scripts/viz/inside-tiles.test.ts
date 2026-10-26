import { describe, expect, it } from "vitest";
import { FIELD, HEAT, radioSeeds, soundPoints } from "./inside-tiles";

describe("soundPoints", () => {
  it("keeps the whole sound field inside the drawing", () => {
    const points = soundPoints();
    expect(points.length).toBeGreaterThan(20);
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(FIELD.width);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(FIELD.height);
    }
  });
});

describe("radioSeeds", () => {
  it("picks distinct seeds from the field", () => {
    const seeds = radioSeeds(soundPoints());
    expect(seeds.length).toBeGreaterThan(1);
    expect(new Set(seeds).size).toBe(seeds.length);
  });
});

describe("HEAT", () => {
  it("lays 24 hours by 7 days on a whole-unit grid", () => {
    expect(HEAT.width).toBe(23 * HEAT.pitch + HEAT.cell);
    expect(HEAT.height).toBe(6 * HEAT.row + HEAT.tall);
  });
});
