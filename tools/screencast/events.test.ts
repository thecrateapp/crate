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
});
