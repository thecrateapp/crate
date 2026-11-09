import { describe, expect, it } from "vitest";
import fixture from "../../../data/blog-music-path-fixture.json";
import {
  attemptTime,
  laneY,
  MUSIC_PATHS_STATES,
  MUSIC_PATHS_TRACKS,
  pathLanes,
  pathsFrame,
  pathsReadout,
  slotX,
  TIMES,
  X0,
  X1,
} from "./music-paths";

const lanes = pathLanes(fixture);
const track = MUSIC_PATHS_TRACKS["anchor-first"];
const lane = (id: string) => lanes.findIndex((item) => item.id === id);
const at = (phase: number) => pathsFrame(lanes, track.pins![phase]!);
const end = pathsFrame(lanes, track.period - 0.001);
const appendedIds = (index: number, frame: ReturnType<typeof pathsFrame>) => {
  const item = lanes[index]!;
  const state = frame.lanes[index]!;
  return [
    ...(state.origin === "appended" ? [item.origin] : []),
    ...item.attempts
      .filter((attempt) => state.slots[attempt.step - 1] === "filled")
      .map((attempt) => attempt.selected),
    ...(state.destination === "appended" ? [item.destination] : []),
  ];
};

describe("Music Paths lanes", () => {
  it("has one phase start and one pin per phase of copy", () => {
    for (const state of MUSIC_PATHS_STATES) {
      const states = MUSIC_PATHS_TRACKS[state.id];
      expect(states.starts).toHaveLength(state.phases.length);
      expect(states.pins).toHaveLength(state.phases.length);
    }
  });

  it("reads the three regression cases and their candidate pools from the export", () => {
    expect(lanes.map((item) => item.id)).toEqual([
      "complete",
      "family",
      "sparse",
    ]);
    expect(lanes.map((item) => item.requested)).toEqual([5, 5, 20]);
    expect(lanes.map((item) => item.pool.map((row) => row.id))).toEqual([
      [2, 3, 4, 5],
      [3, 4],
      [2],
    ]);
    const family = lanes[lane("family")]!;
    expect(family.pool[0]!.label).toBe("#3 Destination (Live)");
    expect(family.names[family.destination]).toBe("#2 Destination");
    expect(lanes[lane("complete")]!.names[3]).toBe("#3");
  });

  it("places tracks at requested steps, as the builder's progress does", () => {
    for (const item of fixture.cases)
      for (const step of item.resultSteps)
        expect(step.progress).toBeCloseTo(step.step / (item.requested - 1), 4);
    expect(slotX(0, 5)).toBe(X0);
    expect(slotX(4, 5)).toBe(X1);
    expect(slotX(2, 5)).toBe((X0 + X1) / 2);
    expect(attemptTime(2, 5)).toBeCloseTo(
      (TIMES.sweep[0] + TIMES.sweep[1]) / 2,
    );
  });
});

describe("Music Paths frames", () => {
  it("reserves every destination before any middle step is searched", () => {
    const frame = at(0);
    for (const state of frame.lanes) {
      expect(state.origin).toBe("appended");
      expect(state.destination).toBe("reserved");
      expect(state.slots.every((slot) => slot === "todo")).toBe(true);
      expect(state.count).toBe(1);
    }
    expect(frame.lanes[lane("sparse")]!.chips).toEqual([
      { id: 2, state: "reserved" },
    ]);
    // Reserving the destination's song family already rules out its live version.
    expect(frame.lanes[lane("family")]!.chips).toEqual([
      { id: 3, state: "excluded" },
      { id: 4, state: "idle" },
    ]);
    expect(pathsFrame(lanes, TIMES.reserve - 0.1).lanes[lane("family")]!.chips[0]!.state).toBe("idle");
    const readout = pathsReadout(lanes, frame);
    expect(readout.destination).toEqual({ text: "Reserved", tone: "ok" });
    expect(readout.lanes.map((item) => item.text)).toEqual([
      "1 / 5",
      "1 / 5",
      "1 / 20",
    ]);
  });

  it("skips the destination's live version while step 1 is decided", () => {
    const frame = at(1);
    const family = frame.lanes[lane("family")]!;
    expect(family.slots[0]).toBe("todo");
    const pill = (id: number) => family.pills.find((item) => item.id === id)!;
    expect(pill(4)).toEqual({ id: 4, state: "selected", order: 0 });
    expect(pill(3)).toEqual({ id: 3, state: "excluded", order: 1 });
    expect(family.group?.x).toBe(slotX(1, 5));
    expect(family.drop).toBe(slotX(1, 5));

    const complete = frame.lanes[lane("complete")]!;
    expect(
      complete.pills.map((item) => [item.id, item.state]),
    ).toEqual([
      [2, "hidden"],
      [3, "selected"],
      [4, "candidate"],
      [5, "candidate"],
    ]);
    expect(frame.sweep).not.toBeNull();

    const after = pathsFrame(lanes, attemptTime(1, 5) + 0.1);
    expect(after.lanes[lane("family")]!.slots[0]).toBe("filled");
    expect(appendedIds(lane("family"), after)).toEqual([1, 4]);
  });

  it("leaves a requested step empty when no eligible row remains", () => {
    const frame = at(2);
    const family = frame.lanes[lane("family")]!;
    expect(family.slots).toEqual(["filled", "empty", "empty"]);
    expect(family.pills.find((pill) => pill.id === 3)!.state).toBe("excluded");
    const sparse = frame.lanes[lane("sparse")]!;
    expect(sparse.slots.filter((slot) => slot === "empty")).toHaveLength(18);
    expect(sparse.pills.every((pill) => pill.state === "hidden")).toBe(true);
    for (const state of frame.lanes) expect(state.destination).toBe("reserved");
    const readout = pathsReadout(lanes, frame);
    expect(readout.lanes[lane("sparse")]).toEqual({
      text: "1 / 20",
      empty: 18,
      tone: "warn",
    });
  });

  it("appends the reserved destination last and returns the exported results", () => {
    expect(TIMES.append).toBeGreaterThan(TIMES.sweep[1]);
    fixture.cases.forEach((item, index) => {
      expect(appendedIds(index, end)).toEqual(item.resultIds);
      expect(end.lanes[index]!.count).toBe(item.resultIds.length);
      expect(end.lanes[index]!.route.endsWith(`${X1} ${laneY(index, "route")}`)).toBe(true);
    });
    expect(end.sweep).toBeNull();
    const readout = pathsReadout(lanes, end);
    expect(readout.destination).toEqual({ text: "Appended", tone: "ok" });
    expect(readout.lanes).toEqual([
      { text: "5 / 5", empty: 0, tone: "ok" },
      { text: "3 / 5", empty: 2, tone: "warn" },
      { text: "2 / 20", empty: 18, tone: "warn" },
    ]);
  });

  it("states the exported counts in the phase copy", () => {
    const copy = MUSIC_PATHS_STATES[0].phases.map((phase) => phase.body).join(" ");
    const empty = lanes[lane("sparse")]!.attempts.length;
    expect(copy).toContain(`${empty} of them`);
    for (const item of fixture.cases)
      expect(copy).toContain(`${item.resultIds.length} of ${item.requested}`);
  });

  it("moves a candidate into a slot only while its step is being decided", () => {
    const complete = lanes[lane("complete")]!;
    const step = attemptTime(1, complete.requested);
    expect(pathsFrame(lanes, step - 0.3).lanes[lane("complete")]!.drop).toBe(
      slotX(1, 5),
    );
    expect(pathsFrame(lanes, step + 0.05).lanes[lane("complete")]!.drop).toBeNull();
    expect(pathsFrame(lanes, 1).lanes[lane("complete")]!.group).toBeNull();
  });
});
