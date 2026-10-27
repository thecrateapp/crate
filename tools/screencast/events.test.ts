import { describe, expect, it } from "vitest";
import { createEventLog } from "./events";

describe("createEventLog", () => {
  it("logs a click at the centre of the box, relative to the start time", () => {
    const log = createEventLog(10_000);
    const box = { x: 100, y: 200, width: 40, height: 20 };

    log.click(box, 11_500);

    expect(log.events).toEqual([
      { t: 1.5, type: "click", x: 120, y: 210, box },
    ]);
  });

  it("logs a click at an offset inside the box when given", () => {
    const log = createEventLog(0);
    const box = { x: 100, y: 200, width: 160, height: 220 };

    log.click(box, 250, { x: 80, y: 200 });

    expect(log.events).toEqual([
      { t: 0.25, type: "click", x: 180, y: 400, box },
    ]);
  });

  it("logs scrolls at the last pointer position", () => {
    const log = createEventLog(0, { x: 720, y: 450 });

    log.scroll(400, 500);
    log.click({ x: 10, y: 10, width: 20, height: 20 }, 1_000);
    log.scroll(-200, 2_250);

    expect(log.events[0]).toEqual({
      t: 0.5,
      type: "scroll",
      x: 720,
      y: 450,
      deltaY: 400,
    });
    expect(log.events[2]).toEqual({
      t: 2.25,
      type: "scroll",
      x: 20,
      y: 20,
      deltaY: -200,
    });
  });

  it("moves the pointer when a scroll names its position", () => {
    const log = createEventLog(0, { x: 720, y: 450 });

    log.scroll(300, 1_000, { x: 1000, y: 400 });
    log.scroll(-300, 2_000);

    expect(log.events.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 1000, y: 400 },
      { x: 1000, y: 400 },
    ]);
  });
});
