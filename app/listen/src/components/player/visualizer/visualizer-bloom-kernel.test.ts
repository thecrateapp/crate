import { describe, expect, it } from "vitest";

import {
  BLOOM_BLUR_GAUSSIAN_WEIGHTS,
  BLOOM_BLUR_PAIRED_TAPS,
} from "./visualizer-bloom-kernel";

describe("bloom blur kernel", () => {
  it("reconstructs each adjacent Gaussian tap pair with one linear sample", () => {
    expect(BLOOM_BLUR_PAIRED_TAPS).toHaveLength(2);

    for (const tap of BLOOM_BLUR_PAIRED_TAPS) {
      const firstIndex = Math.floor(tap.offset);
      const fraction = tap.offset - firstIndex;

      expect(tap.weight * (1 - fraction)).toBeCloseTo(
        BLOOM_BLUR_GAUSSIAN_WEIGHTS[firstIndex]!,
        12,
      );
      expect(tap.weight * fraction).toBeCloseTo(
        BLOOM_BLUR_GAUSSIAN_WEIGHTS[firstIndex + 1]!,
        12,
      );
    }
  });

  it("keeps the complete symmetric blur kernel normalized", () => {
    const [centerWeight, ...sideWeights] = BLOOM_BLUR_GAUSSIAN_WEIGHTS;
    const sum =
      centerWeight! +
      sideWeights.reduce((total, weight) => total + 2 * weight, 0);

    expect(sum).toBeCloseTo(1, 5);
  });
});
