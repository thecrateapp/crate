import { describe, expect, it } from "vitest";
import { cursorAt } from "./cursor";
import type { CaptureEvent } from "../events";

const origin = { x: 720, y: 450 };

function click(t: number, x: number, y: number): CaptureEvent {
  return { t, type: "click", x, y, box: { x, y, width: 0, height: 0 } };
}

describe("cursorAt", () => {
  const events = [click(1, 200, 100), click(2, 1200, 800), click(4, 600, 300)];

  it("waits at the origin before the first move", () => {
    expect(cursorAt(events, 0, origin)).toEqual({ x: 720, y: 450, pulse: 0 });
  });

  it("lands exactly on each event at its time", () => {
    for (const event of events) {
      expect(cursorAt(events, event.t, origin)).toMatchObject({
        x: event.x,
        y: event.y,
      });
    }
  });

  it("travels between points without overshooting the segment far away", () => {
    const { x, y } = cursorAt(events, 1.7, origin);

    expect(x).toBeGreaterThan(200);
    expect(x).toBeLessThan(1200);
    expect(y).toBeGreaterThan(100);
    expect(y).toBeLessThan(800);
  });

  it("pulses on clicks and fades out", () => {
    expect(cursorAt(events, 1, origin).pulse).toBe(1);
    expect(cursorAt(events, 1.1, origin).pulse).toBeGreaterThan(0);
    expect(cursorAt(events, 1.1, origin).pulse).toBeLessThan(1);
    expect(cursorAt(events, 1.5, origin).pulse).toBe(0);
  });

  it("stays on the last point after the last event", () => {
    expect(cursorAt(events, 9, origin)).toEqual({ x: 600, y: 300, pulse: 0 });
  });
});
