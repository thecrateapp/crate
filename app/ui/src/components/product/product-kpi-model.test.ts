import { describe, expect, it } from "vitest";
import {
  KPI_CATALOGUE,
  breakdownRows,
  formatChange,
  formatKpiValue,
  summarizeKpi,
  type ProductKpiResponse,
} from "./product-kpi-model";

function response(series: ProductKpiResponse["series"]): ProductKpiResponse {
  return {
    window_days: 7,
    current_start: "2026-10-27",
    previous_start: "2026-10-20",
    end: "2026-11-02",
    computed_at: "2026-11-02T14:00:00Z",
    minimum_sample: 3,
    series,
  };
}

const point = (
  day: string,
  value: number | null,
  sample: number | null = 5,
  suppressed = false,
) => ({
  day,
  value,
  sample,
  suppressed,
});

const definition = (kpi: string) =>
  KPI_CATALOGUE.find((item) => item.kpi === kpi)!;

describe("summarizeKpi", () => {
  it("sums flows over the window and compares them with the previous window", () => {
    const data = response([
      {
        kpi: "listening.plays",
        dims: {},
        points: [
          point("2026-10-21", 40),
          point("2026-10-28", 30),
          point("2026-11-02", 30),
        ],
      },
    ]);

    const reading = summarizeKpi(definition("listening.plays"), data);

    expect(reading.value).toBe(60);
    expect(reading.previous).toBe(40);
    expect(reading.change).toBeCloseTo(0.5);
    expect(reading.coveredDays).toBe(2);
    expect(formatChange(reading, 7)).toBe("+50% vs previous 7 days");
  });

  it("takes the latest level and averages means", () => {
    const data = response([
      {
        kpi: "users.total",
        dims: {},
        points: [point("2026-10-28", 8), point("2026-11-01", 10)],
      },
      {
        kpi: "users.daily_listeners",
        dims: {},
        points: [point("2026-10-28", 2), point("2026-11-01", 4)],
      },
    ]);

    expect(summarizeKpi(definition("users.total"), data).value).toBe(10);
    expect(summarizeKpi(definition("users.daily_listeners"), data).value).toBe(
      3,
    );
  });

  it("reports missing data instead of zero and no change without a previous window", () => {
    const empty = summarizeKpi(definition("listening.plays"), response([]));
    const firstWindow = summarizeKpi(
      definition("users.signups"),
      response([
        { kpi: "users.signups", dims: {}, points: [point("2026-11-01", 3)] },
      ]),
    );

    expect(empty.value).toBeNull();
    expect(formatKpiValue(empty.value, "count")).toBe("—");
    expect(formatChange(empty, 7)).toBe("No data in this window");
    expect(formatChange(firstWindow, 7)).toBe("No comparable previous 7 days");
  });

  it("adds breakdown segments into the tile total", () => {
    const data = response([
      {
        kpi: "acquisition.completed",
        dims: { source: "soulseek" },
        points: [point("2026-10-30", 3, null)],
      },
      {
        kpi: "acquisition.completed",
        dims: { source: "tidal" },
        points: [point("2026-10-31", 2, null)],
      },
    ]);

    expect(summarizeKpi(definition("acquisition.completed"), data).value).toBe(
      5,
    );
  });
});

describe("breakdownRows", () => {
  it("orders visible segments by value and keeps hidden ones without a share", () => {
    const data = response([
      {
        kpi: "listening.plays_by_platform",
        dims: { platform: "android" },
        points: [point("2026-10-30", 60), point("2026-10-31", 20)],
      },
      {
        kpi: "listening.plays_by_platform",
        dims: { platform: "web" },
        points: [point("2026-10-30", 20)],
      },
      {
        kpi: "listening.plays_by_platform",
        dims: { platform: "ios" },
        points: [point("2026-10-30", null, 2, true)],
      },
    ]);

    const rows = breakdownRows(definition("listening.plays_by_platform"), data);

    expect(rows.map((row) => row.label)).toEqual(["android", "web", "ios"]);
    expect(rows[0]).toMatchObject({ value: 80, share: 0.8, hidden: false });
    expect(rows[2]).toMatchObject({ value: null, share: null, hidden: true });
  });
});

describe("formatKpiValue", () => {
  it("formats each unit", () => {
    expect(formatKpiValue(0.256, "ratio")).toBe("25.6%");
    expect(formatKpiValue(12.34, "hours")).toBe("12.3 h");
    expect(formatKpiValue(1234.5, "count")).toBe("1,235");
    expect(formatKpiValue(2.5, "gib")).toBe("2.5 GiB");
  });
});
