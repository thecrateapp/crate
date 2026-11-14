import { describe, expect, it } from "vitest";
import { bouncePosition } from "./beam";

describe("bouncePosition", () => {
  const track = 300;
  const segment = 60;

  it("stays inside the track at any time", () => {
    for (let t = 0; t < 10_000; t += 7) {
      const { x } = bouncePosition(t, track, segment);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(track - segment);
    }
  });

  it("starts at the left end and reaches the right end after one leg", () => {
    expect(bouncePosition(0, track, segment).x).toBeCloseTo(0);
    expect(bouncePosition(899.999, track, segment).x).toBeCloseTo(240, 3);
  });

  it("eases: the middle of a leg is the middle of the track", () => {
    expect(bouncePosition(450, track, segment).x).toBeCloseTo(120);
  });

  it("flags the return leg and comes back to the start", () => {
    expect(bouncePosition(300, track, segment).back).toBe(false);
    expect(bouncePosition(1200, track, segment).back).toBe(true);
    expect(bouncePosition(1800, track, segment).x).toBeCloseTo(0);
  });

  it("honours a custom leg length", () => {
    expect(bouncePosition(1000, track, segment, 2000).x).toBeCloseTo(120);
  });

  it("parks at 0 when the segment fills the track", () => {
    expect(bouncePosition(500, 50, 80).x).toBe(0);
  });
});
