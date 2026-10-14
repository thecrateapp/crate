import { describe, expect, it } from "vitest";
import { beatTimes, equalPower, waveform } from "./mix-math";

describe("equalPower", () => {
  it("keeps constant power across the fade", () => {
    for (const t of [0, 0.1, 0.25, 0.5, 0.8, 1]) {
      const { out, in: incoming } = equalPower(t);
      expect(out ** 2 + incoming ** 2).toBeCloseTo(1, 6);
    }
    expect(equalPower(0)).toEqual({ out: 1, in: 0 });
    expect(equalPower(0.5).out).toBeCloseTo(Math.SQRT1_2, 6);
    expect(equalPower(3).in).toBe(1);
  });
});

describe("beatTimes", () => {
  it("places one tick per beat", () => {
    const ticks = beatTimes(120, 2);
    expect(ticks).toEqual([0, 0.5, 1, 1.5, 2]);
  });
});

describe("waveform", () => {
  it("is deterministic, bounded and quieter inside the intro ramp", () => {
    const shape = { bars: 200, seed: 3, rampIn: 0.25 };
    const a = waveform(shape);
    expect(a).toEqual(waveform(shape));
    expect(a).toHaveLength(200);
    a.forEach((value) => {
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThanOrEqual(1);
    });
    const mean = (values: number[]) =>
      values.reduce((s, v) => s + v, 0) / values.length;
    expect(mean(a.slice(0, 20))).toBeLessThan(mean(a.slice(100, 200)) * 0.6);
  });

  it("fades out after the outro point", () => {
    const values = waveform({ bars: 200, seed: 5, rampOut: 0.7 });
    expect(values[199]!).toBeLessThan(0.2);
  });
});
