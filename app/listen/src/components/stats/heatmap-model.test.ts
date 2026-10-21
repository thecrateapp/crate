import { describe, expect, it } from "vitest";

import {
  buildHeatmapModel,
  heatmapGridHidden,
  heatmapNowCell,
  heatmapTopGenre,
  msUntilNextHour,
} from "@/components/stats/heatmap-model";
import type { StatsHeatmap } from "@/components/stats/stats-types";

function heatmap(
  minutes: (weekday: number, hour: number) => number,
  extra: Partial<StatsHeatmap> = {},
): StatsHeatmap {
  return {
    cells: Array.from({ length: 7 }, (_, weekday) =>
      Array.from({ length: 24 }, (_, hour) => minutes(weekday, hour)),
    ),
    peak: null,
    night_share: 0,
    ...extra,
  };
}

const at = (iso: string) => new Date(iso);

describe("heatmap model", () => {
  it("computes the now cell across DST", () => {
    // Europe/Madrid springs forward on Sunday 2026-03-29 at 01:00 UTC (02:00 -> 03:00).
    expect(heatmapNowCell("Europe/Madrid", at("2026-03-29T00:30:00Z"))).toEqual(
      { weekday: 6, hour: 1 },
    );
    expect(heatmapNowCell("Europe/Madrid", at("2026-03-29T01:30:00Z"))).toEqual(
      { weekday: 6, hour: 3 },
    );
    // The next local hour after 01:30 CET is the jump to 03:00 CEST, 30 minutes away.
    expect(msUntilNextHour("Europe/Madrid", at("2026-03-29T00:30:00Z"))).toBe(
      30 * 60_000,
    );
    // New York falls back on Sunday 2026-11-01: 01:30 happens twice.
    expect(
      heatmapNowCell("America/New_York", at("2026-11-01T05:30:00Z")),
    ).toEqual({ weekday: 6, hour: 1 });
    expect(
      heatmapNowCell("America/New_York", at("2026-11-01T06:30:00Z")),
    ).toEqual({ weekday: 6, hour: 1 });
    expect(
      msUntilNextHour("America/New_York", at("2026-11-01T06:30:00.250Z")),
    ).toBe(30 * 60_000 - 250);
    // The model carries the same cell.
    expect(
      buildHeatmapModel(
        heatmap(() => 1),
        {
          timezone: "Europe/Madrid",
          now: at("2026-03-29T01:30:00Z"),
        },
      ).nowCell,
    ).toEqual({ weekday: 6, hour: 3 });
  });

  it("handles St John's and Kathmandu offsets", () => {
    // Thursday 2026-01-15 12:00 UTC: St John's is UTC-3:30, Kathmandu UTC+5:45.
    const noon = at("2026-01-15T12:00:00Z");
    expect(heatmapNowCell("America/St_Johns", noon)).toEqual({
      weekday: 3,
      hour: 8,
    });
    expect(heatmapNowCell("Asia/Kathmandu", noon)).toEqual({
      weekday: 3,
      hour: 17,
    });
    // Their hours turn at :30 and :45 past the UTC hour.
    expect(msUntilNextHour("America/St_Johns", noon)).toBe(30 * 60_000);
    expect(msUntilNextHour("Asia/Kathmandu", noon)).toBe(15 * 60_000);
    // 18:20 UTC is already Friday 00:05 in Kathmandu.
    expect(
      heatmapNowCell("Asia/Kathmandu", at("2026-01-15T18:20:00Z")),
    ).toEqual({ weekday: 4, hour: 0 });
  });

  it("returns no now cell for an invalid zone", () => {
    const now = at("2026-01-15T12:00:00Z");
    expect(heatmapNowCell("Not/AZone", now)).toBeNull();
    expect(heatmapNowCell("", now)).toBeNull();
    expect(heatmapNowCell(null, now)).toBeNull();
    expect(msUntilNextHour("Not/AZone", now)).toBeNull();
    expect(
      buildHeatmapModel(
        heatmap(() => 1),
        { timezone: "Not/AZone", now },
      ).nowCell,
    ).toBeNull();
  });

  it("derives levels, glow, the peak and the night band", () => {
    const model = buildHeatmapModel(
      heatmap((weekday, hour) => (weekday === 6 && hour === 22 ? 100 : 30), {
        peak: { weekday: 6, hour: 22 },
        night_share: 0.38,
        night_hours: [22, 23, 0, 1, 2, 3, 4, 5],
      }),
      { timezone: null, now: at("2026-01-15T12:00:00Z") },
    );
    expect(model.rows).toHaveLength(7);
    expect(model.rows.every((row) => row.length === 24)).toBe(true);
    const peak = model.rows[6]![22]!;
    expect(peak).toMatchObject({ peak: true, level: 1, glow: true });
    expect(model.rows[0]![12]).toMatchObject({
      peak: false,
      level: 0.3,
      glow: false,
      night: false,
    });
    expect(model.rows[0]![3]!.night).toBe(true);
    expect(model.rows[0]![23]!.night).toBe(true);
    expect(model.rows[0]![6]!.night).toBe(false);
    expect(model.peak).toEqual({ weekday: 6, hour: 22, minutes: 100 });
    expect(model.nightRange).toEqual({ start: 22, end: 5 });
    expect(model.nightShare).toBe(0.38);
    // One shared style per cell: the level and the diagonal wave delay.
    expect(peak.vars).toEqual({
      "--stats-level": "1.000",
      "--stats-delay": `${(6 + 22) * 18}ms`,
    });
  });

  it("keeps a zero-minute grid flat with no peak", () => {
    const model = buildHeatmapModel(
      heatmap(() => 0, { peak: { weekday: 0, hour: 0 }, night_share: 0 }),
      { timezone: null, now: at("2026-01-15T12:00:00Z") },
    );
    expect(model.total).toBe(0);
    expect(model.peak).toBeNull();
    expect(model.rows.flat().every((cell) => cell.level === 0)).toBe(true);
    expect(model.rows.flat().some((cell) => cell.peak)).toBe(false);
  });

  it("finds the peak when the payload omits it and pads short rows", () => {
    const model = buildHeatmapModel(
      {
        cells: [
          [0, 5],
          [0, 0, 9],
        ],
        night_share: 0,
      },
      { timezone: null, now: at("2026-01-15T12:00:00Z") },
    );
    expect(model.rows).toHaveLength(7);
    expect(model.rows[6]![23]!.minutes).toBe(0);
    expect(model.peak).toEqual({ weekday: 1, hour: 2, minutes: 9 });
    // Older payloads without night_hours fall back to 22-05.
    expect(model.nightRange).toEqual({ start: 22, end: 5 });
  });

  it("names the first top genre, never the faller", () => {
    expect(
      heatmapTopGenre(
        [
          {
            genre_name: "Metalcore",
            play_count: 3,
            complete_play_count: 3,
            minutes_listened: 9,
          },
        ],
        [{ genre_name: "Post-Rock", share: 0.2 }],
      ),
    ).toBe("Metalcore");
    expect(
      heatmapTopGenre(
        [],
        [
          { genre_name: "Hardcore", share: 0, faller: true },
          { genre_name: "Post-Rock", share: 0.2 },
        ],
      ),
    ).toBe("Post-Rock");
    expect(
      heatmapTopGenre([], [{ genre_name: "Hardcore", share: 0, faller: true }]),
    ).toBeNull();
  });

  it("hides the instance grid below three listeners", () => {
    const sparse = heatmap(() => 1, { listener_count: 2 });
    expect(heatmapGridHidden(sparse, "global")).toBe(true);
    expect(heatmapGridHidden({ ...sparse, listener_count: 3 }, "global")).toBe(
      false,
    );
    expect(heatmapGridHidden(sparse, "personal")).toBe(false);
    // A global payload without a count is treated as too few listeners.
    expect(
      heatmapGridHidden({ ...sparse, listener_count: null }, "global"),
    ).toBe(true);
  });
});
