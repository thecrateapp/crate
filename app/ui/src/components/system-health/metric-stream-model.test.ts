import { describe, expect, it } from "vitest";
import { metricStreams, buildMetricSeries } from "./metric-stream-model";

describe("metric stream model", () => {
  it("uses counts for events and average/maximum for measurements", () => {
    expect(metricStreams).toHaveLength(13);
    for (const id of [
      "api.requests",
      "api.errors",
      "api.slow",
      "stream.requests",
      "worker.resource.deferred",
    ]) {
      expect(metricStreams.find((stream) => stream.id === id)?.fields).toEqual([
        "count",
      ]);
    }
    expect(
      metricStreams.find((stream) => stream.id === "api.latency")?.fields,
    ).toEqual(["avg", "max"]);
  });
  it.each([60, 3600])(
    "positions timestamps numerically and breaks absent %s-second buckets",
    (seconds) => {
      const start = Date.parse("2026-10-24T10:00:00Z");
      const data = [
        { timestamp: new Date(start).toISOString(), count: 0, avg: null },
        {
          timestamp: new Date(start + seconds * 3000).toISOString(),
          count: 7,
          avg: 0,
        },
      ];
      expect(buildMetricSeries(data, ["count"], seconds)[0]!.data).toEqual([
        { x: start, y: 0 },
        { x: start + seconds * 1000, y: null },
        { x: start + seconds * 3000, y: 7 },
      ]);
      expect(
        buildMetricSeries(data, ["avg"], seconds)[0]!.data.map(
          (point) => point.y,
        ),
      ).toEqual([null, null, 0]);
    },
  );
});
