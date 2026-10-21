import { expect, it } from "vitest";
import { formatStatsDelta, formatStatsRelativeTime } from "./stats-format";

it("formats signed integer deltas and nulls when there is no base", () => {
  expect(formatStatsDelta(112, 100, "en")).toBe("+12%");
  expect(formatStatsDelta(97, 100, "en")).toBe("−3%");
  expect(formatStatsDelta(100, 100, "en")).toBe("0%");
  expect(formatStatsDelta(5, 0, "en")).toBeNull();
  expect(formatStatsDelta(5, undefined, "en")).toBeNull();
});

it("formats relative time by minute, hour and day, never in the future", () => {
  const now = Date.parse("2026-10-21T12:00:00Z");
  expect(formatStatsRelativeTime("2026-10-21T11:56:00Z", now, "en")).toBe(
    "4 minutes ago",
  );
  expect(formatStatsRelativeTime("2026-10-21T12:00:30Z", now, "en")).toBe(
    "this minute",
  );
  expect(formatStatsRelativeTime("2026-10-19T12:00:00Z", now, "en")).toBe(
    "2 days ago",
  );
  expect(formatStatsRelativeTime(null, now, "en")).toBeNull();
  expect(formatStatsRelativeTime("nope", now, "en")).toBeNull();
});
