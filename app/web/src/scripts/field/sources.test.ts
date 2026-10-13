import { describe, expect, it } from "vitest";
import {
  cloudPositions,
  clusterCenters,
  decodeCloud,
  mulberry32,
} from "./sources";

describe("cloudPositions", () => {
  it("is deterministic for a given seed", () => {
    const a = cloudPositions(
      500,
      clusterCenters(8, 0.9, mulberry32(7)),
      mulberry32(7),
    );
    const b = cloudPositions(
      500,
      clusterCenters(8, 0.9, mulberry32(7)),
      mulberry32(7),
    );
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(a.positions.length).toBe(1500);
  });
});

describe("decodeCloud", () => {
  it("dequantises int16 xyz triples into the [-scale, scale] range", () => {
    const buffer = new Int16Array([32767, -32767, 0]).buffer;
    expect(Array.from(decodeCloud(buffer, 1.5))).toEqual([1.5, -1.5, 0]);
  });
});
