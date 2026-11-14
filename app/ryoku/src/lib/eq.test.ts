import { describe, expect, it } from "vitest";
import { bandX, curve, curvePath, gainAt, gainY } from "./eq";

const W = 500;
const H = 120;

describe("curve", () => {
  it("draws a straight centre line for flat gains", () => {
    const points = curve(Array(10).fill(0), W, H);
    expect(points).toHaveLength(200);
    for (const [, y] of points) expect(y).toBeCloseTo(H / 2);
  });

  it("puts a peak at its band's x", () => {
    const gains = Array(10).fill(0);
    gains[3] = 12;
    const points = curve(gains, W, H, 901);
    const top = points.reduce((best, point) => (point[1] < best[1] ? point : best));
    expect(top[0]).toBeCloseTo(bandX(3, 10, W), 0);
    expect(top[1]).toBeCloseTo(0);
  });

  it("runs from the first band to the last, left to right", () => {
    const points = curve([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], W, H, 50);
    expect(points[0][0]).toBeCloseTo(bandX(0, 10, W));
    expect(points.at(-1)?.[0]).toBeCloseTo(bandX(9, 10, W));
    for (let i = 1; i < points.length; i++) expect(points[i][0]).toBeGreaterThan(points[i - 1][0]);
  });

  it("maps +12 dB to the top and -12 dB to the bottom", () => {
    expect(gainY(12, H)).toBe(0);
    expect(gainY(-12, H)).toBe(H);
  });
});

describe("curvePath", () => {
  it("starts at the first band and has one cubic per gap", () => {
    const d = curvePath(Array(10).fill(0), W, H);
    expect(d.startsWith(`M ${bandX(0, 10, W)} ${H / 2}`)).toBe(true);
    expect(d.match(/ C /g)).toHaveLength(9);
  });
});

describe("gainAt", () => {
  it("snaps to 0.5 dB steps and clamps to the chart", () => {
    expect(gainAt(H / 2, H)).toBe(0);
    expect(gainAt(H * 0.27, H)).toBe(5.5);
    expect(gainAt(-40, H)).toBe(12);
    expect(gainAt(H + 40, H)).toBe(-12);
  });
});
