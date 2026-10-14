import { describe, expect, it } from "vitest";
import { EQ_PRESETS } from "../../content/listen/viz";
import {
  bandPoints,
  formatGain,
  gainToY,
  lerpGains,
  nextInCycle,
  smoothPath,
  stepSpring,
} from "./eq-math";

describe("eq presets", () => {
  it("mirrors the 21 Listen presets with 10 bands each", () => {
    expect(Object.keys(EQ_PRESETS)).toHaveLength(21);
    Object.values(EQ_PRESETS).forEach((gains) =>
      expect(gains).toHaveLength(10),
    );
  });
});

describe("lerpGains", () => {
  it("interpolates band by band and clamps progress", () => {
    const from = EQ_PRESETS.black_metal!;
    const to = EQ_PRESETS.jazz!;
    expect(lerpGains(from, to, 0)).toEqual([...from]);
    expect(lerpGains(from, to, 1)).toEqual([...to]);
    expect(lerpGains(from, to, 2)).toEqual([...to]);
    expect(lerpGains([0, 4], [4, 0], 0.5)).toEqual([2, 2]);
  });
});

describe("gainToY", () => {
  it("maps +max to the top, 0 to the middle and clamps outside the range", () => {
    expect(gainToY(12, 0, 200, 12)).toBe(0);
    expect(gainToY(0, 0, 200, 12)).toBe(100);
    expect(gainToY(-30, 0, 200, 12)).toBe(200);
  });
});

describe("smoothPath", () => {
  it("passes through every band point", () => {
    const points = bandPoints([0, 6, -6], 0, 300, 0, 240, 12);
    const path = smoothPath(points);
    expect(path.startsWith("M50.0 120.0")).toBe(true);
    expect(path).toContain("150.0 60.0");
    expect(path.endsWith("250.0 180.0")).toBe(true);
    expect(path.match(/C/g)).toHaveLength(2);
  });
});

describe("stepSpring", () => {
  it("settles on the target", () => {
    let spring = { value: 0, velocity: 0 };
    for (let i = 0; i < 240; i += 1) spring = stepSpring(spring, 6, 1 / 60);
    expect(spring.value).toBeCloseTo(6, 2);
  });
});

describe("nextInCycle and formatGain", () => {
  it("wraps the preset cycle and formats signed gains", () => {
    expect(nextInCycle(["a", "b"], "b")).toBe("a");
    expect(formatGain(3.4)).toBe("+3");
    expect(formatGain(-2.6)).toBe("−3");
    expect(formatGain(0.2)).toBe("0");
  });
});
