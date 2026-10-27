import { describe, expect, it } from "vitest";
import { CHAT } from "../../content/admin/telegram-agent";
import { mulberry32 } from "../field/sources";
import {
  barsPath,
  columnTimes,
  decibels,
  gateStage,
  lowsPath,
  mixReadout,
  nearestPoints,
  planChanges,
  soundField,
  steer,
  tempoNudge,
  ticksPath,
} from "./inside-math";
import { mixSeconds, type MixPlan } from "./mix-math";

const plan: MixPlan = {
  outgoingBpm: 124,
  incomingBpm: 120,
  beats: 12,
  prerollS: 2.5,
  restoreS: 4,
  swapFraction: 0.125,
  cutDb: -24,
};
const length = mixSeconds(plan);
const lane = { top: 10, bottom: 50 };

describe("columnTimes", () => {
  it("samples one column per pitch inside the requested span", () => {
    const times = columnTimes(0, 10, 2, 6, 100, 4);
    expect(times).toHaveLength(10);
    expect(times[0]).toBeCloseTo(2, 6);
    expect(times.every((t) => t >= 2 && t < 6)).toBe(true);
  });

  it("clips the span to the visible window", () => {
    expect(columnTimes(0, 10, -5, 20, 100, 10)).toHaveLength(10);
  });
});

describe("barsPath", () => {
  it("draws one closed bar per column, centred on the lane", () => {
    const d = barsPath([0, 1], [1, 0.5], (t) => t * 10, lane, 2);
    expect(d.match(/Z/g)).toHaveLength(2);
    expect(d.startsWith("M0.0 10.0h2v40.0")).toBe(true);
    expect(d).toContain("M10.0 20.0h2v20.0");
  });
});

describe("ticksPath", () => {
  it("splits downbeats from beats and drops beats outside the window", () => {
    const beats = [0, 1, 2, 3, 4, 5].map((beat) => ({ time: beat, beat }));
    const { down, beat } = ticksPath(beats, (t) => t, lane, {
      start: 0,
      end: 4,
    });
    expect(down.match(/M/g)).toHaveLength(2);
    expect(beat.match(/M/g)).toHaveLength(3);
    expect(down).toContain("V50.0");
  });
});

describe("lowsPath", () => {
  it("is a closed area that hands the lows over at the midpoint", () => {
    const d = lowsPath(plan, "out", 0, length, (t) => t, lane, true, 8);
    expect(d.endsWith("Z")).toBe(true);
    expect(d.startsWith(`M0.0 ${lane.top.toFixed(1)}`)).toBe(true);
    const incoming = lowsPath(plan, "in", 0, length, (t) => t, lane, true, 8);
    expect(incoming.startsWith(`M0.0 ${lane.bottom.toFixed(1)}`)).toBe(true);
  });

  it("leaves the outline open when only the level line is wanted", () => {
    const line = lowsPath(plan, "out", 0, length, (t) => t, lane, false, 8);
    expect(line.endsWith("Z")).toBe(false);
    expect(line.match(/[ML]/g)).toHaveLength(9);
  });
});

describe("decibels", () => {
  it("formats gain as dB with a typographic minus", () => {
    expect(decibels(1)).toBe("0.0");
    expect(decibels(Math.SQRT1_2)).toBe("−3.0");
    expect(decibels(0)).toBe("−∞");
    expect(decibels(2)).toBe("+6.0");
  });
});

describe("tempoNudge", () => {
  it("reports how far B is pushed off its own tempo", () => {
    expect(tempoNudge(plan, -10)).toBe("0.0%");
    expect(tempoNudge(plan, length / 2)).toBe("+3.3%");
    expect(tempoNudge(plan, length + plan.restoreS + 1)).toBe("0.0%");
  });
});

describe("mixReadout", () => {
  it("reads the midpoint as locked, −3 dB each side and the lows changing hands", () => {
    const readout = mixReadout(plan, length / 2, 1, 210, 1);
    expect(readout).toEqual({
      phase: "locked",
      tempo: "+3.3%",
      gainA: "−3.0",
      gainB: "−3.0",
      lows: "A → B",
    });
  });

  it("starts cued with A alone and ends with B alone at its trim", () => {
    expect(mixReadout(plan, -3, 0, 210, 1)).toMatchObject({
      phase: "cued",
      gainA: "0.0",
      gainB: "−∞",
      lows: "A",
    });
    expect(mixReadout(plan, -1, 0.5, 210, 1).phase).toBe("105 ms");
    expect(mixReadout(plan, length + 1, 1, 210, 0.5)).toMatchObject({
      gainA: "−∞",
      gainB: "−6.0",
      lows: "B",
    });
  });
});

describe("planChanges", () => {
  it("reads the targets and changes out of the plan pages", () => {
    const pages = CHAT.flatMap((entry) =>
      entry.kind === "page" ? [entry] : [],
    );
    expect(planChanges(pages)).toEqual([
      { target: "3 album folders", change: "move into the artist layout" },
      { target: "14 files on disk", change: "index into the catalog" },
    ]);
  });
});

describe("gateStage", () => {
  it("reviews, then checks the box, then presses Approve", () => {
    expect(gateStage(1, 3, 0.9, 0.6)).toBe("idle");
    expect(gateStage(3, 3, 0.1, 0.6)).toBe("review");
    expect(gateStage(3, 3, 0.4, 0.6)).toBe("checked");
    expect(gateStage(3, 3, 0.6, 0.6)).toBe("pressed");
    expect(gateStage(4, 3, 0, 0.6)).toBe("pressed");
  });
});

describe("soundField", () => {
  it("scatters a repeatable cloud of points inside the unit disc", () => {
    const a = soundField(64, mulberry32(3));
    expect(a).toHaveLength(64);
    expect(soundField(64, mulberry32(3))).toEqual(a);
    for (const point of a)
      expect(Math.hypot(point.x, point.y)).toBeLessThanOrEqual(1);
  });
});

describe("nearestPoints", () => {
  it("returns the k closest points, nearest first", () => {
    const points = [
      { x: 0.9, y: 0 },
      { x: 0.1, y: 0 },
      { x: -0.5, y: 0 },
      { x: 0.3, y: 0 },
    ];
    expect(nearestPoints(points, { x: 0, y: 0 }, 2)).toEqual([1, 3]);
    expect(nearestPoints(points, { x: 1, y: 0 }, 1)).toEqual([0]);
  });
});

describe("steer", () => {
  it("moves the target a share of the way towards a liked track", () => {
    expect(steer({ x: 0, y: 0 }, { x: 1, y: -1 }, 0.25)).toEqual({
      x: 0.25,
      y: -0.25,
    });
    expect(steer({ x: 0.5, y: 0.5 }, { x: 1, y: 1 }, 0)).toEqual({
      x: 0.5,
      y: 0.5,
    });
  });
});
