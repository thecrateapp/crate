import type { StatsTape } from "../stats-types";

import {
  clampWindow,
  mondayOf,
  type ExplorerMode,
  type ExplorerWindow,
} from "./stats-explorer-model";

export interface ExplorerMonthLabel {
  /** `YYYY-MM`, the value the month view (`?month=`) expects. */
  month: string;
  /** First bucket of the month in `tape.points`. */
  index: number;
  /** `index / points.length`, for CSS positioning. */
  position: number;
  /** Alternate labels that narrow containers hide. */
  minor: boolean;
  /** January on a multi-year tape shows its year instead of the month. */
  showYear: boolean;
}

export interface ExplorerAxisLabel {
  /** Offset from the first bucket of the stretch. */
  offset: number;
  minor: boolean;
}

const MONTH_STEPS = [1, 2, 3, 4, 6, 12] as const;
const MAX_MONTH_LABELS = 13;
const MAX_AXIS_LABELS = 6;
// The last few buckets have no room for a label without overflowing the strip.
const MONTH_TAIL_SHARE = 0.035;
const MONTH_MIN_GAP_SHARE = 0.05;
/** With more labels than this, alternates are minor (hidden when narrow). */
const MINOR_MONTH_THRESHOLD = 6;
const MINUTE_STEPS = [
  15, 30, 60, 120, 180, 240, 300, 600, 900, 1200, 1800, 2400, 3000, 6000, 12000,
] as const;
const MAX_TICKS = 4;

export function explorerMonthLabels(tape: StatsTape): ExplorerMonthLabel[] {
  const count = tape.points.length;
  if (!count) return [];
  const firstMonth = tape.start.slice(0, 7);
  const starts: { month: string; index: number }[] = [];
  let previous = "";
  tape.points.forEach((point, index) => {
    const month = point.bucket.slice(0, 7);
    if (month === previous) return;
    previous = month;
    // Weekly buckets are Mondays: the first one can fall before the tape.
    if (month >= firstMonth) starts.push({ month, index });
  });
  if (!starts.length) return [];

  const step =
    MONTH_STEPS.find((size) => starts.length / size <= MAX_MONTH_LABELS) ?? 12;
  const tail = Math.max(1, Math.ceil(count * MONTH_TAIL_SHARE));
  const multiYear =
    starts[0]!.month.slice(0, 4) !==
    starts[starts.length - 1]!.month.slice(0, 4);
  const kept = starts.filter(
    ({ month, index }) =>
      (Number(month.slice(5, 7)) - 1) % step === 0 && count - index >= tail,
  );
  // A short partial month at the start would print on top of the next one.
  if (
    kept.length > 1 &&
    kept[1]!.index - kept[0]!.index < count * MONTH_MIN_GAP_SHARE
  ) {
    kept.shift();
  }
  return kept.map(({ month, index }, ordinal) => ({
    month,
    index,
    position: index / count,
    minor: kept.length > MINOR_MONTH_THRESHOLD && ordinal % 2 === 1,
    showYear: multiYear && month.endsWith("-01"),
  }));
}

/** Round minute gridlines strictly below `max`, at most four. */
export function minuteTicks(max: number): number[] {
  if (!Number.isFinite(max) || max <= 0) return [];
  const step =
    MINUTE_STEPS.find((value) => max / value <= MAX_TICKS) ??
    Math.ceil(max / MAX_TICKS / 600) * 600;
  const ticks: number[] = [];
  for (let value = step; value < max; value += step) ticks.push(value);
  return ticks;
}

/** About six labels along the detail chart; alternates hide when narrow. */
export function explorerAxisLabels(buckets: number): ExplorerAxisLabel[] {
  if (buckets <= 0) return [];
  const step = Math.max(1, Math.ceil(buckets / MAX_AXIS_LABELS));
  const offsets: number[] = [];
  for (let offset = 0; offset < buckets; offset += step) offsets.push(offset);
  return offsets.map((offset, ordinal) => ({
    offset,
    minor: offsets.length > 3 && ordinal % 2 === 1,
  }));
}

/** Symmetric resize step for `+`/`-`: about a tenth of the default span. */
export function resizeStep(mode: ExplorerMode): number {
  return mode.kind === "window"
    ? Math.max(1, Math.round(mode.defaultSpan / 10))
    : 0;
}

/** Move one edge to `index` while the other stays put, within the spans. */
export function resizeWindow(
  window: ExplorerWindow,
  edge: "start" | "end",
  index: number,
  count: number,
  mode: ExplorerMode,
): ExplorerWindow {
  if (mode.kind === "full") return clampWindow(window, count, mode);
  const maxSpan = Math.min(mode.maxSpan, count);
  const minSpan = Math.min(mode.minSpan, maxSpan);
  const at = Math.round(index);
  if (edge === "start") {
    const from = Math.min(
      window.to - minSpan,
      Math.max(window.to - maxSpan, at, 0),
    );
    return clampWindow({ from, to: window.to }, count, mode);
  }
  const to = Math.max(
    window.from + minSpan,
    Math.min(window.from + maxSpan, at, count),
  );
  return clampWindow({ from: window.from, to }, count, mode);
}

export type ExplorerDragPart = "start" | "end" | "window" | "outside";

/** Hit areas reach this far outside the window edges (fine pointer, touch). */
const EDGE_REACH_FINE_PX = 8;
const EDGE_REACH_COARSE_PX = 38;
/** At most this much of each edge inside the window resizes; never over a quarter. */
const EDGE_INWARD_PX = 6;

/**
 * What a press at `x` grabs, from its position rather than the hit element:
 * edges reach outward (44 px in total on touch) but only `min(6 px, width/4)`
 * inward, so even a 16 px window keeps its middle for moving.
 */
export function dragPartAt(
  x: number,
  left: number,
  right: number,
  coarse: boolean,
): ExplorerDragPart {
  const reach = coarse ? EDGE_REACH_COARSE_PX : EDGE_REACH_FINE_PX;
  const inward = Math.min(EDGE_INWARD_PX, Math.max(0, right - left) / 4);
  if (x >= left - reach && x < left + inward) return "start";
  if (x > right - inward && x <= right + reach) return "end";
  if (x >= left && x <= right) return "window";
  return "outside";
}

/** Tape bucket that holds `day` (the day itself, or its Monday). */
export function bucketOfDay(tape: StatsTape, day: string): string {
  return tape.granularity === "week" ? mondayOf(day) : day;
}

function utcDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

/** "Sep 21", or "Sep 21, 2025" when the year is needed. */
export function formatExplorerDay(
  day: string,
  locale: string,
  withYear = false,
): string {
  return utcDate(day).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

/** Both ends of a range; the year shows only when they differ. */
export function formatExplorerRange(
  range: { start: string; end: string },
  locale: string,
): { start: string; end: string } {
  const withYear = range.start.slice(0, 4) !== range.end.slice(0, 4);
  return {
    start: formatExplorerDay(range.start, locale, withYear),
    end: formatExplorerDay(range.end, locale, withYear),
  };
}

/** "Fri, Aug 28" for the chart readout. */
export function formatExplorerWeekday(day: string, locale: string): string {
  return utcDate(day).toLocaleDateString(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** "Saturday, September 12" for the day detail. */
export function formatExplorerLongDay(day: string, locale: string): string {
  return utcDate(day).toLocaleDateString(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

/** Short month ("Aug") or full name with year ("August 2026"). */
export function formatExplorerMonth(
  month: string,
  locale: string,
  style: "short" | "long",
): string {
  return utcDate(`${month}-01`).toLocaleDateString(
    locale,
    style === "short"
      ? { month: "short", timeZone: "UTC" }
      : { month: "long", year: "numeric", timeZone: "UTC" },
  );
}
