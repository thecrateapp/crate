import { describe, expect, it } from "vitest";
import admin from "./data/admin.beats.json";
import listen from "./data/listen.beats.json";
import {
  cutAt,
  editErrors,
  repetitionErrors,
  sourceTime,
  takesIn,
  type ShotEdit,
} from "./edit";
import { ADMIN_EDIT } from "./edits/admin";
import { LISTEN_EDIT } from "./edits/listen";
import type { BeatGrid } from "./grid";
import { ADMIN, LISTEN, type Storyboard } from "./storyboard";

const listenGrid = listen as BeatGrid;
const adminGrid = admin as BeatGrid;

describe("film edits", () => {
  it.each([
    { name: "listen", board: LISTEN, edit: LISTEN_EDIT, grid: listenGrid },
    { name: "admin", board: ADMIN, edit: ADMIN_EDIT, grid: adminGrid },
  ])("$name cuts every shot on its beats", ({ board, edit, grid }) => {
    expect(editErrors(board, edit, grid)).toEqual([]);
  });

  it.each([
    { time: 0, shot: "Waveform", index: 0 },
    { time: 31.99, shot: "Dig", index: 0 },
    { time: 32, shot: "Playlists", index: 0 },
    { time: 40.5, shot: "Crates", index: 0 },
    { time: 41, shot: "Crates", index: 1 },
    { time: 59.9, shot: "End card", index: 0 },
  ])("listen at $time s plays $shot cut $index", ({ time, shot, index }) => {
    const active = cutAt(LISTEN, LISTEN_EDIT, listenGrid, time);

    expect(LISTEN.shots[active.shot].title).toBe(shot);
    expect(active.index).toBe(index);
  });

  it("starts the Listen drop exactly on bar 179", () => {
    const active = cutAt(LISTEN, LISTEN_EDIT, listenGrid, 32);

    expect(active.start).toBeCloseTo(32, 2);
    expect(active.local).toBeCloseTo(0, 2);
  });

  it("holds the last frame of the film after its end", () => {
    const active = cutAt(LISTEN, LISTEN_EDIT, listenGrid, 120);

    expect(LISTEN.shots[active.shot].title).toBe("End card");
    expect(active.progress).toBe(1);
  });

  it("reports cuts that do not add up and duo cuts with one device", () => {
    const board: Storyboard = {
      id: "listen",
      sections: [],
      shots: [{ bar: 163, bars: 1, title: "A", detail: "", devices: [] }],
    };
    const edit: ShotEdit[] = [
      {
        shot: "A",
        cuts: [
          {
            beats: 3,
            layout: "duo",
            sources: [
              { take: "x", device: "desktop", from: 0 },
              { take: "y", device: "desktop", from: 0 },
            ],
          },
        ],
      },
    ];

    expect(editErrors(board, edit, listenGrid)).toEqual([
      '"A" cuts last 3 beats, the shot 4',
      '"A" has a duo cut without both devices',
    ]);
  });

  it("plays sources at their speed from their in-point", () => {
    expect(
      sourceTime({ take: "x", device: "desktop", from: 0.3, speed: 0.6 }, 2),
    ).toBeCloseTo(1.5);
    expect(sourceTime({ take: "x", device: "desktop", from: 1 }, 2)).toBe(3);
  });

  it("lists every take the films need", () => {
    expect(takesIn(LISTEN_EDIT)).toContain("crates/desktop");
    expect(takesIn(ADMIN_EDIT)).toContain("analysis/mobile");
  });

  it.each([
    { name: "listen", edit: LISTEN_EDIT, stars: ["crates"] },
    { name: "admin", edit: ADMIN_EDIT, stars: ["analysis"] },
  ])("$name keeps its takes varied", ({ edit, stars }) => {
    expect(repetitionErrors(edit, stars)).toEqual([]);
  });

  it("reports a take that repeats or takes over the film", () => {
    const cut = {
      beats: 4,
      layout: "desktop" as const,
      sources: [{ take: "home", device: "desktop" as const, from: 0 }],
    };
    const edit: ShotEdit[] = [{ shot: "A", cuts: [cut, cut] }];

    expect(repetitionErrors(edit, [])).toEqual([
      "home/desktop fills two cuts in a row",
      "home fills 100% of the film",
    ]);
    expect(repetitionErrors(edit, ["home"])).toEqual([]);
  });
});
