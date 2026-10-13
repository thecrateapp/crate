import { describe, expect, it } from "vitest";
import { mulberry32 } from "../field/sources";
import {
  closestIndex,
  densestIndex,
  nearest,
  pathReadouts,
  pickNodes,
  radioPicks,
  segment,
} from "./scene";

const positions = new Float32Array([
  0, 0, 0, 1, 0, 0, 0.2, 0, 0, 0, 0.5, 0, 3, 3, 3,
]);

describe("segment", () => {
  it("maps a phase window to 0..1 and clamps outside it", () => {
    expect(segment(1.5, 1)).toBe(0.5);
    expect(segment(0.2, 1)).toBe(0);
    expect(segment(4, 1, 2)).toBe(1);
  });
});

describe("nearest", () => {
  it("returns the k closest points to a target, closest first, skipping the excluded index", () => {
    expect(nearest(positions, [0, 0, 0], 3, 0)).toEqual([2, 3, 1]);
  });
});

describe("closestIndex", () => {
  it("finds the point closest to a target", () => {
    expect(closestIndex(positions, [2.9, 3, 3])).toBe(4);
  });
});

describe("pickNodes", () => {
  it("snaps each anchor to the nearest projected candidate", () => {
    const candidates = [
      { index: 10, x: 0, y: 0 },
      { index: 11, x: 100, y: 0 },
      { index: 12, x: 200, y: 10 },
    ];
    expect(
      pickNodes(candidates, [
        { x: 5, y: 0 },
        { x: 190, y: 0 },
      ]),
    ).toEqual([10, 12]);
  });
});

describe("pathReadouts", () => {
  it("labels six nodes from START to END with rising BPM and Camelot keys", () => {
    const readouts = pathReadouts(6, mulberry32(3));
    expect(readouts.map((r) => r.head)).toEqual([
      "START",
      "02",
      "03",
      "04",
      "05",
      "END",
    ]);
    const bpms = readouts.map((r) => r.bpm);
    expect([...bpms].sort((a, b) => a - b)).toEqual(bpms);
    expect(bpms[5] - bpms[0]).toBeGreaterThanOrEqual(24);
    readouts.forEach((r) => expect(r.key).toMatch(/^\d{1,2}A$/));
  });
});

describe("radioPicks", () => {
  it("returns five picks in descending score order", () => {
    const picks = radioPicks(5, mulberry32(9));
    expect(picks).toHaveLength(5);
    const scores = picks.map((p) => p.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    picks.forEach((p) => {
      expect(p.score).toBeLessThanOrEqual(1);
      expect(p.key).toMatch(/^\d{1,2}[AB]$/);
    });
  });
});

describe("densestIndex", () => {
  it("picks a point inside the tightest cluster", () => {
    const cloud = new Float32Array([
      5, 5, 5, 0, 0, 0, 0.01, 0, 0, 0, 0.01, 0, -4, 2, 0, 0.01, 0.01, 0,
    ]);
    expect([1, 2, 3, 5]).toContain(densestIndex(cloud, 0.1));
  });
});
