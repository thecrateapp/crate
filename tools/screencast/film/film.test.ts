import { describe, expect, it } from "vitest";
import admin from "./data/admin.beats.json";
import listen from "./data/listen.beats.json";
import { barTime, positionAt, type BeatGrid } from "./grid";
import {
  ADMIN,
  LISTEN,
  sectionAt,
  shotAt,
  storyboardErrors,
  type Storyboard,
} from "./storyboard";

const grid: BeatGrid = {
  id: "test",
  artist: "",
  title: "",
  bpm: 120,
  beatsPerBar: 4,
  firstBar: 10,
  bars: 4,
  sourceStart: 0,
  duration: 8,
  beats: [],
  energy: [],
};

describe("positionAt", () => {
  it.each([
    { time: 0, bar: 10, beat: 1, beatProgress: 0 },
    { time: 0.75, bar: 10, beat: 2, beatProgress: 0.5 },
    { time: 2, bar: 11, beat: 1, beatProgress: 0 },
    { time: 7.9, bar: 13, beat: 4, beatProgress: 0.8 },
    { time: -1, bar: 10, beat: 1, beatProgress: 0 },
    { time: 9, bar: 13, beat: 4, beatProgress: 1 },
  ])("at $time s is bar $bar beat $beat", ({ time, ...expected }) => {
    const position = positionAt(grid, time);

    expect(position.bar).toBe(expected.bar);
    expect(position.beat).toBe(expected.beat);
    expect(position.beatProgress).toBeCloseTo(expected.beatProgress);
  });
});

describe("barTime", () => {
  it.each([
    { bar: 10, time: 0 },
    { bar: 12, time: 4 },
    { bar: 14, time: 8 },
  ])("bar $bar starts at $time s", ({ bar, time }) => {
    expect(barTime(grid, bar)).toBeCloseTo(time);
  });
});

describe("storyboards", () => {
  it.each([
    { board: LISTEN, beats: listen as BeatGrid },
    { board: ADMIN, beats: admin as BeatGrid },
  ])("$board.id covers its soundtrack bar by bar", ({ board, beats }) => {
    expect(storyboardErrors(board, beats)).toEqual([]);
    expect(beats.beats).toHaveLength(beats.bars * beats.beatsPerBar);
  });

  it("reports gaps, overlaps and a short ending", () => {
    const broken: Storyboard = {
      id: "listen",
      sections: [{ bar: 10, bars: 4, name: "All" }],
      shots: [
        { bar: 10, bars: 1, title: "a", detail: "", devices: [] },
        { bar: 12, bars: 1, title: "b", detail: "", devices: [] },
      ],
    };

    expect(storyboardErrors(broken, grid)).toEqual([
      "shot at bar 12 should start at bar 11",
      "shots end at bar 13, the soundtrack at bar 14",
    ]);
  });

  it("finds the shot and section playing at a bar", () => {
    expect(shotAt(LISTEN, 178).title).toBe("Dig");
    expect(shotAt(LISTEN, 186).title).toBe("Crates");
    expect(sectionAt(LISTEN, 179).name).toBe("Drop");
    expect(sectionAt(ADMIN, 69).name).toBe("Drop");
  });
});
