import { describe, expect, it } from "vitest";

import {
  centeredCropForAspect,
  constrainCoverFrame,
  cropFrameForCanvas,
  cropFromCanvasFrame,
  fillPositionFromCanvas,
  fillSubjectFrame,
  zoomCrop,
} from "./hero-composition-geometry";

describe("hero composition geometry", () => {
  it("creates a centered crop for the requested artboard ratio", () => {
    expect(
      centeredCropForAspect({ width: 2400, height: 1200 }, 21 / 9),
    ).toEqual({ x: 0, y: 86, width: 2400, height: 1029 });
    expect(centeredCropForAspect({ width: 1200, height: 2400 }, 4 / 5)).toEqual(
      { x: 0, y: 450, width: 1200, height: 1500 },
    );
  });

  it("converts a dragged cover image back into a bounded crop recipe", () => {
    expect(
      cropFrameForCanvas(
        { width: 2000, height: 1000 },
        { width: 1000, height: 500 },
        { x: 333, y: 0, width: 1333, height: 667 },
      ),
    ).toEqual({ x: -250, y: 0, width: 1500, height: 750 });
    expect(
      constrainCoverFrame(
        { x: 80, y: -400, width: 1500, height: 750 },
        { width: 1000, height: 500 },
      ),
    ).toEqual({ x: 0, y: -250, width: 1500, height: 750 });
    expect(
      cropFromCanvasFrame(
        { width: 2000, height: 1000 },
        { width: 1000, height: 500 },
        { x: -250, y: 0, width: 1500, height: 750 },
      ),
    ).toEqual({ x: 333, y: 0, width: 1333, height: 667 });
  });

  it("zooms a crop around its center without escaping the source", () => {
    expect(
      zoomCrop(
        { x: 200, y: 100, width: 1600, height: 800 },
        { width: 2000, height: 1000 },
        1.25,
        2,
      ),
    ).toEqual({ x: 360, y: 180, width: 1280, height: 640 });
  });

  it("covers the canvas before applying Fill placement", () => {
    const frame = fillSubjectFrame(
      { width: 1000, height: 1000 },
      { width: 1000, height: 500 },
      { positionX: 0.5, positionY: 0.5, scale: 1 },
    );

    expect(frame).toEqual({ x: 0, y: -250, width: 1000, height: 1000 });
    expect(
      fillPositionFromCanvas(
        { width: 1000, height: 1000 },
        { width: 1000, height: 500 },
        1,
        { x: frame.x, y: frame.y },
      ),
    ).toEqual({ positionX: 0.5, positionY: 0.5 });
  });

  it("allows Fill placement beyond the canvas edge", () => {
    const frame = fillSubjectFrame(
      { width: 1000, height: 1000 },
      { width: 1000, height: 500 },
      { positionX: 1.4, positionY: -0.25, scale: 1 },
    );

    expect(frame).toEqual({ x: 400, y: 125, width: 1000, height: 1000 });
    expect(
      fillPositionFromCanvas(
        { width: 1000, height: 1000 },
        { width: 1000, height: 500 },
        1,
        { x: frame.x, y: frame.y },
      ),
    ).toEqual({ positionX: 1.4, positionY: -0.25 });
  });
});
