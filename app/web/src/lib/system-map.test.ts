import { describe, expect, it } from "vitest";
import {
  edgePath,
  routeEdges,
  segmentProgress,
  stepAt,
  viewBox,
} from "./system-map";

const left = { x: 0, y: 0, w: 100, h: 40 };

describe("edgePath", () => {
  it("joins side by side boxes with a straight line through their shared band", () => {
    expect(edgePath(left, { x: 150, y: 0, w: 100, h: 40 })).toBe(
      "M 100 20 C 125 20 125 20 150 20",
    );
  });

  it("joins stacked boxes with a straight vertical line", () => {
    expect(edgePath(left, { x: 0, y: 100, w: 100, h: 40 })).toBe(
      "M 50 40 C 50 70 50 70 50 100",
    );
  });

  it("curves between offset boxes, leaving from the side that faces the target", () => {
    expect(edgePath({ x: 200, y: 100, w: 100, h: 40 }, left)).toBe(
      "M 200 112 C 150 112 150 28 100 28",
    );
  });
});

describe("routeEdges", () => {
  const edges = [
    { id: "a-b", from: "a", to: "b" },
    { id: "b-c", from: "b", to: "c" },
  ];

  it("walks edges forwards and backwards", () => {
    expect(routeEdges(["a", "b", "c"], edges)).toEqual([
      { id: "a-b", reversed: false },
      { id: "b-c", reversed: false },
    ]);
    expect(routeEdges(["c", "b"], edges)).toEqual([
      { id: "b-c", reversed: true },
    ]);
  });

  it("throws when two route stops are not connected", () => {
    expect(() => routeEdges(["a", "c"], edges)).toThrow("a → c");
  });
});

describe("stepAt", () => {
  it("splits progress evenly across steps", () => {
    expect(stepAt(0, 4)).toEqual({ index: 0, local: 0 });
    expect(stepAt(0.375, 4)).toEqual({ index: 1, local: 0.5 });
  });

  it("holds the last step at the end", () => {
    expect(stepAt(1, 4)).toEqual({ index: 3, local: 1 });
    expect(stepAt(1.5, 4)).toEqual({ index: 3, local: 1 });
  });
});

describe("segmentProgress", () => {
  it("draws segments one after another", () => {
    expect(segmentProgress(0.25, 2, 0)).toBe(0.5);
    expect(segmentProgress(0.25, 2, 1)).toBe(0);
    expect(segmentProgress(0.75, 2, 1)).toBe(0.5);
  });
});

describe("viewBox", () => {
  it("frames every box with padding", () => {
    expect(viewBox([left, { x: 150, y: 100, w: 100, h: 40 }], 4)).toBe(
      "-4 -4 258 148",
    );
  });
});
