import { describe, expect, it } from "vitest";

import {
  EQ_CHART_BANDS,
  bandX,
  clampGain,
  eqCurvePath,
  formatGain,
  gainToY,
  snapGain,
} from "./eq-curve";

const FLAT = Array.from({ length: EQ_CHART_BANDS.length }, () => 0);

describe("eq-curve", () => {
  it("maps gains to a 0-100 vertical axis with +12 dB at the top", () => {
    expect(gainToY(12)).toBe(0);
    expect(gainToY(0)).toBe(50);
    expect(gainToY(-12)).toBe(100);
    expect(gainToY(30)).toBe(0);
  });

  it("centres each band in its column", () => {
    expect(bandX(0)).toBe(5);
    expect(bandX(9)).toBe(95);
  });

  it("clamps and snaps gains to 0.5 dB", () => {
    expect(clampGain(-20)).toBe(-12);
    expect(snapGain(3.2)).toBe(3);
    expect(snapGain(3.3)).toBe(3.5);
    expect(snapGain(40)).toBe(12);
  });

  it("formats gains to 0.1 dB with typographic signs", () => {
    expect(formatGain(2)).toBe("+2");
    expect(formatGain(0)).toBe("0");
    expect(formatGain(-1.5)).toBe("−1.5");
    expect(formatGain(1.04)).toBe("+1");
    expect(formatGain(-0.04)).toBe("0");
  });

  it("builds a smooth path through every band centre", () => {
    const path = eqCurvePath(FLAT);

    expect(path.startsWith("M5 50")).toBe(true);
    expect(path.match(/C/g)).toHaveLength(9);
    expect(path.endsWith("95 50")).toBe(true);
  });
});
