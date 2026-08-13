import { describe, expect, it } from "vitest";

import {
  applyPillowBrightness,
  applyPillowContrast,
  applyPillowGrayscale,
} from "./hero-image-treatment";

function pixels(values: number[], width: number, height: number) {
  return {
    data: new Uint8ClampedArray(values),
    width,
    height,
  };
}

describe("hero image treatment", () => {
  it("uses the same grayscale and multiplicative brightness contract as Pillow", () => {
    const image = pixels([10, 20, 30, 255, 100, 150, 200, 255], 2, 1);

    applyPillowGrayscale(image);
    applyPillowBrightness(image, 0.82);

    expect(Array.from(image.data)).toEqual([
      14, 14, 14, 255, 115, 115, 115, 255,
    ]);
  });

  it("computes contrast around the image luminance mean", () => {
    const image = pixels([10, 20, 30, 255, 100, 150, 200, 255], 2, 1);

    applyPillowContrast(image, 1.18);

    expect(Array.from(image.data)).toEqual([0, 9, 21, 255, 103, 162, 221, 255]);
  });
});
