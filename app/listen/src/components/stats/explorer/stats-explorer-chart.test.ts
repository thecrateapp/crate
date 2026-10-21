import { describe, expect, it } from "vitest";

import type { StatsTape } from "@/components/stats/stats-types";
import {
  bucketOfDay,
  explorerAxisLabels,
  explorerMonthLabels,
  minuteTicks,
  resizeWindow,
} from "@/components/stats/explorer/stats-explorer-chart";
import { explorerMode } from "@/components/stats/explorer/stats-explorer-model";

const DAY = 86_400_000;

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function tape(
  granularity: "day" | "week",
  start: number,
  count: number,
): StatsTape {
  const step = granularity === "week" ? 7 * DAY : DAY;
  return {
    granularity,
    start: iso(start),
    end: iso(start + count * step),
    points: Array.from({ length: count }, (_, index) => ({
      bucket: iso(start + index * step),
      minutes: 10,
      plays: 1,
    })),
    mood: [],
    peaks: [],
    months: [],
  };
}

describe("stats explorer chart", () => {
  it("labels every month of a daily tape and marks alternates as minor", () => {
    const labels = explorerMonthLabels(tape("day", Date.UTC(2026, 6, 1), 92));

    expect(labels.map((label) => label.month)).toEqual([
      "2026-07",
      "2026-08",
      "2026-09",
    ]);
    expect(labels.map((label) => label.index)).toEqual([0, 31, 62]);
    expect(labels.every((label) => !label.minor && !label.showYear)).toBe(true);
  });

  it("thins multi-year weekly tapes to quarters and names January by year", () => {
    // Monday 2023-01-02 plus 156 weeks reaches late December 2025.
    const labels = explorerMonthLabels(tape("week", Date.UTC(2023, 0, 2), 156));

    expect(labels.length).toBeLessThanOrEqual(13);
    expect(labels.map((label) => label.month.slice(5))).toEqual(
      expect.arrayContaining(["01", "04", "07", "10"]),
    );
    expect(
      labels.every((label) =>
        ["01", "04", "07", "10"].includes(label.month.slice(5)),
      ),
    ).toBe(true);
    expect(
      labels.filter((label) => label.showYear).map((l) => l.month),
    ).toEqual(["2023-01", "2024-01", "2025-01"]);
  });

  it("skips weekly Mondays that start before the tape and labels too close to the end", () => {
    const weekly: StatsTape = {
      ...tape("week", Date.UTC(2025, 11, 29), 10),
      start: "2026-01-01",
    };
    expect(explorerMonthLabels(weekly)[0]?.month).toBe("2026-01");
    // August starts in the second-to-last bucket of this 63-day tape.
    const daily = tape("day", Date.UTC(2026, 5, 1), 63);
    expect(explorerMonthLabels(daily).map((label) => label.month)).toEqual([
      "2026-06",
      "2026-07",
    ]);
  });

  it("drops a short leading month whose label would collide with the next", () => {
    // 2025-10-22 leaves ten days of October before November starts.
    const labels = explorerMonthLabels(tape("day", Date.UTC(2025, 9, 22), 365));
    expect(labels[0]?.month).toBe("2025-11");
    expect(labels.filter((label) => label.minor).map((l) => l.month)).toEqual([
      "2025-12",
      "2026-02",
      "2026-04",
      "2026-06",
      "2026-08",
      "2026-10",
    ]);
  });

  it("returns at most four round minute ticks below the maximum", () => {
    expect(minuteTicks(0)).toEqual([]);
    expect(minuteTicks(50)).toEqual([15, 30, 45]);
    expect(minuteTicks(200)).toEqual([60, 120, 180]);
    expect(minuteTicks(3200)).toEqual([900, 1800, 2700]);
    expect(minuteTicks(100_000).length).toBeLessThanOrEqual(4);
  });

  it("resizes from one edge while keeping the other and the span limits", () => {
    const daily = tape("day", Date.UTC(2026, 0, 1), 365);
    const mode = explorerMode("365d", daily);
    const window = { from: 300, to: 330 };

    expect(resizeWindow(window, "start", 290.4, 365, mode)).toEqual({
      from: 290,
      to: 330,
    });
    expect(resizeWindow(window, "start", 328, 365, mode)).toEqual({
      from: 323,
      to: 330,
    });
    expect(resizeWindow(window, "end", 400, 365, mode)).toEqual({
      from: 300,
      to: 365,
    });
    expect(resizeWindow(window, "end", 302, 365, mode)).toEqual({
      from: 300,
      to: 307,
    });

    const weekly = tape("week", Date.UTC(2020, 0, 6), 300);
    const allTime = explorerMode("all_time", weekly);
    expect(
      resizeWindow({ from: 250, to: 262 }, "start", 0, 300, allTime),
    ).toEqual({ from: 205, to: 262 });
  });

  it("spreads about six axis labels and marks alternates as minor", () => {
    expect(explorerAxisLabels(30).map((label) => label.offset)).toEqual([
      0, 5, 10, 15, 20, 25,
    ]);
    expect(explorerAxisLabels(30).filter((label) => label.minor)).toHaveLength(
      3,
    );
    expect(explorerAxisLabels(3).map((label) => label.offset)).toEqual([
      0, 1, 2,
    ]);
    expect(explorerAxisLabels(3).some((label) => label.minor)).toBe(false);
  });

  it("maps a day to its tape bucket", () => {
    const daily = tape("day", Date.UTC(2026, 0, 1), 30);
    const weekly = tape("week", Date.UTC(2025, 11, 29), 4);
    expect(bucketOfDay(daily, "2026-01-07")).toBe("2026-01-07");
    expect(bucketOfDay(weekly, "2026-01-07")).toBe("2026-01-05");
  });
});
