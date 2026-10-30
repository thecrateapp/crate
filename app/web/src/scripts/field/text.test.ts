import { describe, expect, it } from "vitest";
import { mulberry32 } from "./sources";
import { pickTextPoints } from "./text";

function image(
  width: number,
  height: number,
  ink: [number, number, "plain" | "hl"][],
) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (const [x, y, kind] of ink) {
    const i = (y * width + x) * 4;
    pixels[i] = kind === "plain" ? 255 : 0;
    pixels[i + 1] = kind === "hl" ? 255 : 0;
    pixels[i + 3] = 255;
  }
  return pixels;
}

describe("pickTextPoints", () => {
  it("places every particle on an inked pixel in document coordinates", () => {
    const pixels = image(10, 4, [
      [2, 1, "plain"],
      [7, 3, "plain"],
    ]);

    const points = pickTextPoints(
      pixels,
      10,
      4,
      50,
      { x: 100, y: 2000 },
      mulberry32(1),
    )!;

    expect(points).toHaveLength(150);
    for (let i = 0; i < 50; i++) {
      const x = points[i * 3];
      const y = points[i * 3 + 1];
      const onFirst = x >= 102 && x < 103 && y >= 2001 && y < 2002;
      const onSecond = x >= 107 && x < 108 && y >= 2003 && y < 2004;
      expect(onFirst || onSecond).toBe(true);
    }
  });

  it("marks particles that land on highlighted words", () => {
    const pixels = image(4, 1, [
      [0, 0, "plain"],
      [3, 0, "hl"],
    ]);

    const points = pickTextPoints(
      pixels,
      4,
      1,
      200,
      { x: 0, y: 0 },
      mulberry32(2),
    )!;

    for (let i = 0; i < 200; i++) {
      expect(points[i * 3 + 2]).toBe(points[i * 3] >= 3 ? 1 : 0);
    }
  });

  it("ignores faint antialiasing and returns nothing for blank text", () => {
    const pixels = new Uint8ClampedArray(4 * 4 * 4).fill(40);

    expect(pickTextPoints(pixels, 4, 4, 10, { x: 0, y: 0 })).toBeNull();
  });
});
