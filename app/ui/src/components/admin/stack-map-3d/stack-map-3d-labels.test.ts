import { describe, expect, it } from "vitest";
import {
  labelRect,
  overlaps,
  placeLabels,
  preferredSide,
  type LabelCandidate,
  type Rect,
} from "./stack-map-3d-labels";

const candidate = (
  id: string,
  x: number,
  y: number,
  extra: Partial<LabelCandidate> = {},
): LabelCandidate => ({
  id,
  x,
  y,
  depth: 1,
  width: 60,
  height: 14,
  gap: 14,
  preferred: "below",
  priority: 4,
  ...extra,
});

const node = (x: number, y: number): Rect => ({
  x: x - 8,
  y: y - 8,
  w: 16,
  h: 16,
});

describe("label placement", () => {
  it("keeps the preferred side when nothing collides", () => {
    const placements = placeLabels(
      [candidate("a", 100, 100, { preferred: "right" })],
      new Map([["a", node(100, 100)]]),
    );
    expect(placements.get("a")).toEqual({ side: "right", hidden: false });
  });

  it("moves a label to a free side instead of overlapping a neighbour", () => {
    const placements = placeLabels(
      [candidate("a", 100, 100), candidate("b", 100, 130, { priority: 2 })],
      new Map([
        ["a", node(100, 100)],
        ["b", node(100, 130)],
      ]),
    );
    expect(placements.get("a")?.side).not.toBe("below");
    expect(placements.get("a")?.hidden).toBe(false);
    const a = placements.get("a")!;
    const b = placements.get("b")!;
    expect(
      overlaps(
        labelRect(a.side, 100, 100, 60, 14, 14),
        labelRect(b.side, 100, 130, 60, 14, 14),
      ),
    ).toBe(false);
  });

  it("hides low priority labels with no room but always shows selected ones", () => {
    const wall: Rect[] = [{ x: 0, y: 0, w: 400, h: 400 }];
    const placements = placeLabels(
      [
        candidate("quiet", 200, 200),
        candidate("selected", 220, 220, { priority: 0, preferred: "above" }),
      ],
      new Map(),
      wall,
    );
    expect(placements.get("quiet")).toEqual({ side: "below", hidden: true });
    expect(placements.get("selected")).toEqual({
      side: "above",
      hidden: false,
    });
  });

  it("widens the gap for large halos so state words clear them", () => {
    const tight = labelRect("right", 100, 100, 60, 14, 14);
    const failing = labelRect("right", 100, 100, 60, 14, 26);
    expect(failing.x - tight.x).toBe(12);
  });

  it("points labels away from the dome centre", () => {
    expect(preferredSide(-50, 5)).toBe("left");
    expect(preferredSide(50, -5)).toBe("right");
    expect(preferredSide(5, -50)).toBe("above");
    expect(preferredSide(5, 50)).toBe("below");
  });
});
