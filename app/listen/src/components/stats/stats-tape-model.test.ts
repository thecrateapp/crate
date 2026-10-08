import { describe, expect, it } from "vitest";

import type { StatsTape } from "@/components/stats/stats-model";
import {
  TAPE_HEIGHT,
  buildTapeModel,
  tapeIndexAt,
} from "@/components/stats/stats-tape-model";

function dailyTape(
  days: number,
  minutes: (index: number) => number,
): StatsTape {
  const start = Date.UTC(2026, 0, 1);
  const points = Array.from({ length: days }, (_, index) => ({
    bucket: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
    minutes: minutes(index),
    plays: 1,
  }));
  return {
    granularity: "day",
    start: points[0]!.bucket,
    end: new Date(start + days * 86_400_000).toISOString().slice(0, 10),
    points,
    mood: [
      { bucket: points[0]!.bucket, energy: 0.2 },
      { bucket: points[days - 1]!.bucket, energy: 0.9 },
    ],
    peaks: [
      {
        kind: "obsession",
        bucket: points[3]!.bucket,
        day: points[3]!.bucket,
        value: 9,
      },
    ],
    months: [{ month: "2026-01", minutes: 100, plays: 20 }],
  };
}

describe("buildTapeModel", () => {
  it("highlights peaks, the three biggest days and today on short tapes", () => {
    const tape = dailyTape(30, (index) => (index === 10 ? 300 : index));
    const model = buildTapeModel(tape, { locale: "en", today: "2026-01-30" });

    expect(model.bars).toHaveLength(30);
    expect(model.bars.filter((bar) => bar.hot).map((bar) => bar.index)).toEqual(
      [3, 10, 28, 29],
    );
    expect(model.bars.find((bar) => bar.today)?.index).toBe(29);
    expect(model.bars[10]!.height).toBeCloseTo(TAPE_HEIGHT * 0.8);
    expect(model.moodPath).toMatch(/^M0\.0,/);
    expect(model.axis.length).toBeGreaterThan(3);
  });

  it("uses square-root heights and month labels on a full year", () => {
    const tape = dailyTape(365, (index) => (index % 7) * 10);
    const model = buildTapeModel(tape, { locale: "en", today: "2026-06-01" });

    const quarter = model.bars.find((bar) => bar.bucket === "2026-01-02")!;
    const full = model.bars.find((bar) => bar.bucket === "2026-01-07")!;
    expect(quarter.height / full.height).toBeCloseTo(Math.sqrt(10 / 60), 2);
    expect(model.axis.map((label) => label.label)).toHaveLength(12);
    expect(model.bars[model.bars.length - 1]!.delayMs).toBeLessThanOrEqual(900);
  });

  it("labels weekly tapes by year and marks the current week", () => {
    const tape: StatsTape = {
      granularity: "week",
      start: "2024-12-30",
      end: "2026-10-09",
      points: ["2024-12-30", "2025-01-06", "2026-10-05"].map((bucket) => ({
        bucket,
        minutes: 10,
        plays: 1,
      })),
      mood: [],
      peaks: [],
      months: [],
    };
    const model = buildTapeModel(tape, { locale: "en", today: "2026-10-08" });

    expect(model.axis.map((label) => label.label)).toEqual([
      "2024",
      "2025",
      "2026",
    ]);
    expect(model.bars.find((bar) => bar.today)?.bucket).toBe("2026-10-05");
    expect(model.moodPath).toBeNull();
  });
});

describe("tapeIndexAt", () => {
  it("clamps pointer positions to the tape", () => {
    expect(tapeIndexAt(-5, 100, 10)).toBe(0);
    expect(tapeIndexAt(55, 100, 10)).toBe(5);
    expect(tapeIndexAt(200, 100, 10)).toBe(9);
  });
});
