import { describe, expect, it } from "vitest";

import type { StatsTape } from "@/components/stats/stats-types";
import {
  bucketRange,
  clampWindow,
  defaultWindow,
  explorerMode,
  stretchRange,
  summarizeStretch,
} from "@/components/stats/explorer/stats-explorer-model";

const DAY = 86_400_000;

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function dailyTape(
  days: number,
  minutes: (index: number) => number = () => 10,
): StatsTape {
  const start = Date.UTC(2026, 0, 1);
  return {
    granularity: "day",
    start: iso(start),
    end: iso(start + days * DAY),
    points: Array.from({ length: days }, (_, index) => ({
      bucket: iso(start + index * DAY),
      minutes: minutes(index),
      plays: 1,
    })),
    mood: [],
    peaks: [],
    months: [],
  };
}

// 2026-01-01 is a Thursday; the first weekly bucket is Monday 2025-12-29.
function weeklyTape(): StatsTape {
  const buckets = ["2025-12-29", "2026-01-05", "2026-01-12"];
  return {
    granularity: "week",
    start: "2026-01-01",
    end: "2026-01-14", // exclusive: last day is Wednesday 2026-01-13
    points: buckets.map((bucket, index) => ({
      bucket,
      minutes: index === 1 ? 0 : 70,
      plays: 1,
    })),
    mood: [
      { bucket: "2025-12-29", energy: 0.2, valence: 0.4 },
      { bucket: "2026-01-12", energy: 0.8, valence: null },
    ],
    peaks: [],
    months: [],
  };
}

describe("stats explorer model", () => {
  it("chooses full mode for short periods", () => {
    const tape = dailyTape(30);
    expect(explorerMode("7d", tape)).toEqual({ kind: "full" });
    expect(explorerMode("30d", tape)).toEqual({ kind: "full" });
    expect(explorerMode("month:2026-01", tape)).toEqual({ kind: "full" });
    expect(explorerMode("90d", dailyTape(90))).toEqual({
      kind: "window",
      defaultSpan: 30,
      minSpan: 7,
      maxSpan: 90,
    });
    expect(explorerMode("365d", dailyTape(900))).toMatchObject({
      maxSpan: 400,
    });
  });

  it("uses weekly spans on all-time tapes", () => {
    expect(explorerMode("all_time", weeklyTape())).toEqual({
      kind: "window",
      defaultSpan: 12,
      minSpan: 2,
      maxSpan: 57,
    });
  });

  it("clamps windows to min/max and edges", () => {
    const mode = explorerMode("90d", dailyTape(90));
    expect(defaultWindow(90, mode)).toEqual({ from: 60, to: 90 });
    expect(defaultWindow(10, mode)).toEqual({ from: 0, to: 10 });
    expect(defaultWindow(5, mode)).toEqual({ from: 0, to: 5 });
    expect(clampWindow({ from: 10, to: 12 }, 90, mode)).toEqual({
      from: 10,
      to: 17,
    });
    expect(clampWindow({ from: 80, to: 90 }, 90, mode)).toEqual({
      from: 80,
      to: 90,
    });
    expect(clampWindow({ from: 85, to: 87 }, 90, mode)).toEqual({
      from: 83,
      to: 90,
    });
    expect(clampWindow({ from: -5, to: 20 }, 90, mode)).toEqual({
      from: 0,
      to: 25,
    });
    expect(clampWindow({ from: 0, to: 200 }, 90, mode)).toEqual({
      from: 0,
      to: 90,
    });
    expect(clampWindow({ from: 2, to: 4 }, 5, mode)).toEqual({
      from: 0,
      to: 5,
    });
    expect(clampWindow({ from: 3, to: 9 }, 30, { kind: "full" })).toEqual({
      from: 0,
      to: 30,
    });
  });

  it("weekly bucket range is clipped to the tape end", () => {
    const tape = weeklyTape();
    expect(bucketRange(tape, 0)).toEqual({
      start: "2026-01-01",
      end: "2026-01-04",
    });
    expect(bucketRange(tape, 1)).toEqual({
      start: "2026-01-05",
      end: "2026-01-11",
    });
    expect(bucketRange(tape, 2)).toEqual({
      start: "2026-01-12",
      end: "2026-01-13",
    });
    expect(bucketRange(dailyTape(3), 1)).toEqual({
      start: "2026-01-02",
      end: "2026-01-02",
    });
    expect(stretchRange(tape, { from: 0, to: 3 })).toEqual({
      start: "2026-01-01",
      end: "2026-01-13",
    });
  });

  it("summarizes minutes, silent days and weighted mood", () => {
    const tape = dailyTape(4, (index) => (index === 1 ? 0 : 10));
    tape.mood = [
      { bucket: "2026-01-01", energy: 0.2, valence: 0.5 },
      { bucket: "2026-01-03", energy: 0.8, valence: null },
    ];
    tape.points[2]!.minutes = 30;
    const summary = summarizeStretch(tape, { from: 0, to: 4 });
    expect(summary.buckets).toBe(4);
    expect(summary.minutes).toBe(50);
    expect(summary.average).toBeCloseTo(12.5);
    expect(summary.silent).toBe(1);
    expect(summary.energy).toBeCloseTo((0.2 * 10 + 0.8 * 30) / 40);
    expect(summary.valence).toBeCloseTo(0.5);

    const weekly = summarizeStretch(weeklyTape(), { from: 0, to: 3 });
    expect(weekly.minutes).toBe(140);
    expect(weekly.average).toBeCloseTo(140 / 13);
    expect(weekly.silent).toBe(1);
    expect(weekly.energy).toBeCloseTo((0.2 * 70 + 0.8 * 70) / 140);
    expect(weekly.valence).toBeCloseTo(0.4);
  });

  it("matches weekly mood buckets on long daily tapes", () => {
    const tape = dailyTape(14);
    // 2026-01-05 is a Monday; mood of a 121+ day daily tape is weekly.
    tape.mood = [{ bucket: "2026-01-05", energy: 0.6, valence: 0.3 }];
    const summary = summarizeStretch(tape, { from: 4, to: 11 });
    expect(summary.energy).toBeCloseTo(0.6);
    expect(summary.valence).toBeCloseTo(0.3);
  });

  it("summarizes an empty stretch without NaN", () => {
    const empty = summarizeStretch(
      dailyTape(5, () => 0),
      { from: 0, to: 5 },
    );
    expect(empty).toEqual({
      buckets: 5,
      minutes: 0,
      average: 0,
      silent: 5,
      energy: null,
      valence: null,
    });
    expect(summarizeStretch(dailyTape(0), { from: 0, to: 0 })).toEqual({
      buckets: 0,
      minutes: 0,
      average: 0,
      silent: 0,
      energy: null,
      valence: null,
    });
  });
});
