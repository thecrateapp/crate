import { describe, expect, it } from "vitest";
import { mulberry32 } from "../field/sources";
import {
  closestIndex,
  densestIndex,
  nearest,
  labelAbove,
  PATH_ROUTE,
  pathLabels,
  pickNodes,
  placeLabels,
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

describe("pathLabels", () => {
  it("heads the endpoints with genres and the stops with their place in the path", () => {
    const labels = pathLabels(PATH_ROUTE);
    expect(labels).toHaveLength(6);
    expect(labels[0]).toBe("RAP\nJPEGMAFIA\neither on or off the drugs");
    expect(labels[2]).toBe("08 / 34\nThe Clash\nShould I Stay or Should I Go");
    expect(labels[5]).toBe("PUNK ROCK\nEskorbuto\nHistoria triste");
  });

  it("keeps the stops in path order inside the saved track count", () => {
    const positions = PATH_ROUTE.stops.map((stop) => stop.position);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(positions[0]).toBe(1);
    expect(positions.at(-1)).toBe(PATH_ROUTE.tracks);
  });
});

describe("labelAbove", () => {
  it("puts each label on the outside of the bend", () => {
    const ys = [100, 220, 215, 130, 10, 5];
    expect(ys.map((_, i) => labelAbove(ys, i))).toEqual([
      true,
      false,
      false,
      false,
      true,
      true,
    ]);
  });
});

describe("placeLabels", () => {
  const box = { width: 190, height: 48 };

  it("uses the outside of the bend when labels are far apart", () => {
    const points = [
      { x: 0, y: 100 },
      { x: 400, y: 300 },
      { x: 800, y: 100 },
    ];
    expect(placeLabels(points, [box, box, box])).toEqual([-62, 14, -62]);
  });

  it("moves a label to a free slot when neighbours would overlap", () => {
    const points = [
      { x: 0, y: 100 },
      { x: 80, y: 215 },
      { x: 160, y: 222 },
      { x: 260, y: 130 },
    ];
    const offsets = placeLabels(points, [box, box, box, box]);
    expect(offsets).not.toContain(null);
    const rects = points.map((p, i) => ({
      left: p.x - 20,
      right: p.x - 20 + box.width,
      top: p.y + (offsets[i] ?? 0),
      bottom: p.y + (offsets[i] ?? 0) + box.height,
    }));
    rects.forEach((a, i) =>
      rects.slice(i + 1).forEach((b) => {
        const overlap =
          a.left < b.right &&
          b.left < a.right &&
          a.top < b.bottom &&
          b.top < a.bottom;
        expect(overlap).toBe(false);
      }),
    );
  });

  it("places the endpoints first and hides middle stops with no free slot", () => {
    const points = Array.from({ length: 6 }, () => ({ x: 100, y: 100 }));
    const offsets = placeLabels(
      points,
      points.map(() => box),
    );
    expect(offsets[0]).not.toBeNull();
    expect(offsets[5]).not.toBeNull();
    expect(offsets.filter((offset) => offset === null)).toHaveLength(2);
  });

  it("hides a middle stop that would run past the bounds", () => {
    const points = [
      { x: 0, y: 100 },
      { x: 300, y: 400 },
      { x: 360, y: 100 },
    ];
    expect(placeLabels(points, [box, box, box], [], 390)[1]).toBeNull();
  });

  it("keeps the previous slot while it stays free", () => {
    const points = [
      { x: 0, y: 100 },
      { x: 400, y: 300 },
    ];
    expect(placeLabels(points, [box, box], [-62, -62])).toEqual([-62, -62]);
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
