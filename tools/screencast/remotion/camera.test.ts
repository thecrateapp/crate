import { describe, expect, it } from "vitest";
import { cameraAt } from "./camera";
import type { CaptureEvent } from "../events";

const viewport = { width: 1440, height: 900 };
const fps = 30;

function click(t: number, x: number, y: number): CaptureEvent {
  return {
    t,
    type: "click",
    x,
    y,
    box: { x: x - 10, y: y - 10, width: 20, height: 20 },
  };
}

describe("cameraAt", () => {
  it("rests at the centre of the viewport without events", () => {
    expect(cameraAt([], 3, { viewport, fps })).toEqual({
      x: 720,
      y: 450,
      zoom: 1,
    });
  });

  it("zooms towards a click and holds on it", () => {
    const camera = cameraAt([click(2, 900, 500)], 2.4, { viewport, fps });

    expect(Math.hypot(camera.x - 900, camera.y - 500)).toBeLessThan(40);
    expect(camera.zoom).toBeGreaterThan(1.4);
  });

  it("releases back to the full view after the hold", () => {
    const camera = cameraAt([click(2, 1000, 600)], 6, { viewport, fps });

    expect(camera.x).toBeCloseTo(720, 1);
    expect(camera.y).toBeCloseTo(450, 1);
    expect(camera.zoom).toBeCloseTo(1, 3);
  });

  it("moves from one target to the next without releasing in between", () => {
    const events = [click(2, 300, 200), click(3, 950, 580)];

    const between = cameraAt(events, 2.9, { viewport, fps });
    const after = cameraAt(events, 3.4, { viewport, fps });

    expect(between.zoom).toBeGreaterThan(1.4);
    expect(after.zoom).toBeGreaterThan(1.4);
    expect(Math.hypot(after.x - 950, after.y - 580)).toBeLessThan(40);
  });

  it("never shows anything outside the captured frame", () => {
    const camera = cameraAt([click(1, 1430, 890)], 1.5, { viewport, fps });
    const halfWidth = viewport.width / (2 * camera.zoom);
    const halfHeight = viewport.height / (2 * camera.zoom);

    expect(camera.x + halfWidth).toBeLessThanOrEqual(viewport.width + 1e-9);
    expect(camera.y + halfHeight).toBeLessThanOrEqual(viewport.height + 1e-9);
  });

  it("ignores scroll events", () => {
    const scroll: CaptureEvent = {
      t: 1,
      type: "scroll",
      x: 100,
      y: 100,
      deltaY: 400,
    };

    expect(cameraAt([scroll], 1.5, { viewport, fps })).toEqual({
      x: 720,
      y: 450,
      zoom: 1,
    });
  });
});
