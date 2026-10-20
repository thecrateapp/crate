import { describe, it, expect } from "vitest";
import {
  buildPathCoverSteps,
  pathCoverWindow,
} from "./path-cover-journey-model";
describe("path cover sequence", () => {
  it("keeps real album identity and sequence, including missing artwork", () => {
    const steps = buildPathCoverSteps([
      {
        step: 8,
        track_id: 4,
        title: "Night",
        artist: "Coast",
        album_id: 22,
        distance: 0,
        progress: 0,
      },
      {
        step: 9,
        track_id: 5,
        title: "Dawn",
        artist: "Coast",
        distance: 0,
        progress: 1,
      },
    ]);
    expect(steps.map((s) => s.index)).toEqual([0, 1]);
    expect(steps[0]!.coverUrl).toContain("22");
    expect(steps[1]!.coverUrl).toBeUndefined();
  });
  it("bounds windows around the inspected step without fabricating nodes", () => {
    expect(pathCoverWindow(50, 24)).toEqual([21, 22, 23, 24, 25, 26, 27]);
    expect(pathCoverWindow(2, 0)).toEqual([0, 1]);
    expect(pathCoverWindow(0, 0)).toEqual([]);
    expect(pathCoverWindow(50, 80)).toEqual([46, 47, 48, 49]);
  });
});
