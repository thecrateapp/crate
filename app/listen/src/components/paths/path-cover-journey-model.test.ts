import { describe, it, expect } from "vitest";
import {
  buildPathCoverSteps,
  coverPreloadWindow,
  medianStepDistance,
  pathStepJump,
  peakCells,
  retargetTransition,
  transitionDirection,
  type PathCoverStep,
} from "./path-cover-journey-model";

const step = (
  index: number,
  sound: Partial<PathCoverStep> = {},
): PathCoverStep => ({ index, title: `T${index}`, artist: "Coast", ...sound });

describe("path cover sequence", () => {
  it("keeps real album identity, sequence and sound data, including missing artwork", () => {
    const steps = buildPathCoverSteps([
      {
        step: 8,
        track_id: 4,
        title: "Night",
        artist: "Coast",
        album_id: 22,
        distance: 0,
        progress: 0,
        energy: 0.4,
        valence: 0.2,
        danceability: 0.6,
        bpm: 120,
        bliss_vector: [0.1, 0.2],
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
    expect(steps[0]).toMatchObject({
      energy: 0.4,
      valence: 0.2,
      danceability: 0.6,
      bpm: 120,
      blissVector: [0.1, 0.2],
    });
    expect(steps[1]!.coverUrl).toBeUndefined();
    expect(steps[1]!.blissVector).toBeUndefined();
  });
});

describe("sonic jump between steps", () => {
  const vectors = [
    [0, 0],
    [1, 0],
    [2, 0],
    [5, 0],
  ].map((blissVector, index) => step(index, { blissVector }));

  it("normalises bliss distances by twice the path's median step", () => {
    expect(medianStepDistance(vectors)).toBe(1);
    expect(pathStepJump(vectors, 0, 1)).toBeCloseTo(0.5);
    expect(pathStepJump(vectors, 2, 3)).toBe(1);
  });

  it("falls back to features with neutral defaults when vectors are missing", () => {
    const steps = [
      step(0, { energy: 0.2, valence: 0.5, danceability: 0.5, bpm: 120 }),
      step(1, { energy: 0.75 }),
      step(2),
    ];
    expect(medianStepDistance(steps)).toBeNull();
    expect(pathStepJump(steps, 0, 1)).toBeCloseTo(1);
    expect(pathStepJump(steps, 1, 2)).toBeCloseTo(0.25 / 0.55);
    expect(pathStepJump(steps, 2, 2)).toBe(0);
  });

  it("raises the floor when several steps are skipped and stays within 0–1", () => {
    const flat = Array.from({ length: 12 }, (_, index) => step(index));
    expect(pathStepJump(flat, 0, 1)).toBe(0);
    expect(pathStepJump(flat, 0, 4)).toBeCloseTo(0.5);
    expect(pathStepJump(flat, 11, 0)).toBe(1);
    expect(pathStepJump(flat, 0, 99)).toBe(0);
  });
});

describe("transition geometry", () => {
  it("pixelates harder for larger jumps, bounded", () => {
    expect(peakCells(0)).toBeCloseTo(28 / 1.2);
    expect(peakCells(1)).toBeCloseTo(8 / 1.2);
    expect(peakCells(1, 4)).toBe(4);
    expect(peakCells(0, 0.1)).toBe(64);
  });

  it("sweeps along the path direction", () => {
    expect(transitionDirection(2, 3)).toBe(1);
    expect(transitionDirection(3, 2)).toBe(-1);
  });

  it("retargets an interrupted transition without a coarseness jump", () => {
    expect(retargetTransition({ from: 1, to: 2, t: 0.3 }, 3)).toEqual({
      from: 1,
      startT: 0.3,
    });
    expect(retargetTransition({ from: 1, to: 2, t: 0.8 }, 3)).toEqual({
      from: 2,
      startT: expect.closeTo(0.2),
    });
    // Going back to the cover still dominant resolves to it from the flipped side.
    expect(retargetTransition({ from: 1, to: 2, t: 0.3 }, 1)).toEqual({
      from: 2,
      startT: expect.closeTo(0.7),
    });
    expect(retargetTransition({ from: 1, to: 2, t: 0.8 }, 2)).toEqual({
      from: 1,
      startT: 0.8,
    });
  });

  it("preloads a bounded window around the inspected step", () => {
    expect(coverPreloadWindow(50, 24)).toEqual([22, 23, 24, 25, 26]);
    expect(coverPreloadWindow(3, 0)).toEqual([0, 1, 2]);
    expect(coverPreloadWindow(0, 0)).toEqual([]);
    expect(coverPreloadWindow(50, 80)).toEqual([47, 48, 49]);
  });
});
