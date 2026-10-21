import type { StatsPeriodKey, StatsTape } from "../stats-types";

/** Bucket indexes into `tape.points`; `to` is exclusive. */
export type ExplorerWindow = { from: number; to: number };

export type ExplorerMode =
  | { kind: "full" }
  | { kind: "window"; defaultSpan: number; minSpan: number; maxSpan: number };

export interface StretchSummary {
  buckets: number;
  minutes: number;
  /** Minutes per day of the stretch (days, not buckets, on weekly tapes). */
  average: number;
  /** Buckets with zero minutes (days on daily tapes, weeks on weekly tapes). */
  silent: number;
  energy: number | null;
  valence: number | null;
}

const DAY_MS = 86_400_000;
const WEEKLY_SPANS = { defaultSpan: 12, minSpan: 2, maxSpan: 57 } as const;
const DAILY_SPANS = { defaultSpan: 30, minSpan: 7 } as const;
const DAILY_MAX_SPAN = 400;

function dayTime(value: string): number {
  return Date.parse(`${value}T00:00:00Z`);
}

function isoDay(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  return isoDay(dayTime(value) + days * DAY_MS);
}

/** Monday (UTC calendar day) of the ISO week that contains `value`. */
export function mondayOf(value: string): string {
  const weekday = (new Date(dayTime(value)).getUTCDay() + 6) % 7;
  return addDays(value, -weekday);
}

export function explorerMode(
  selection: StatsPeriodKey,
  tape: StatsTape,
): ExplorerMode {
  if (
    selection === "7d" ||
    selection === "30d" ||
    selection.startsWith("month:")
  ) {
    return { kind: "full" };
  }
  if (tape.granularity === "week") {
    return { kind: "window", ...WEEKLY_SPANS };
  }
  return {
    kind: "window",
    ...DAILY_SPANS,
    maxSpan: Math.min(tape.points.length, DAILY_MAX_SPAN),
  };
}

function spanLimits(count: number, mode: ExplorerMode) {
  if (mode.kind === "full") return { min: count, max: count };
  const max = Math.min(mode.maxSpan, count);
  return { min: Math.min(mode.minSpan, max), max };
}

export function defaultWindow(
  count: number,
  mode: ExplorerMode,
): ExplorerWindow {
  if (mode.kind === "full" || count <= 0)
    return { from: 0, to: Math.max(0, count) };
  const { min, max } = spanLimits(count, mode);
  const span = Math.min(max, Math.max(min, mode.defaultSpan));
  return { from: count - span, to: count };
}

export function clampWindow(
  window: ExplorerWindow,
  count: number,
  mode: ExplorerMode,
): ExplorerWindow {
  if (mode.kind === "full" || count <= 0)
    return { from: 0, to: Math.max(0, count) };
  const { min, max } = spanLimits(count, mode);
  const span = Math.min(max, Math.max(min, window.to - window.from));
  const from = Math.min(count - span, Math.max(0, window.from));
  return { from, to: from + span };
}

/**
 * Inclusive local-day range of one bucket. `tape.end` is exclusive (the
 * backend sends `today + 1` for open periods), and the first weekly bucket
 * starts on the Monday before `tape.start`, so weekly ranges are clipped to
 * `[tape.start, tape.end - 1]`.
 */
export function bucketRange(
  tape: StatsTape,
  index: number,
): { start: string; end: string } {
  const bucket = tape.points[index]?.bucket;
  if (!bucket) return { start: tape.start, end: tape.start };
  if (tape.granularity !== "week") return { start: bucket, end: bucket };
  const lastDay = addDays(tape.end, -1);
  const start = bucket > tape.start ? bucket : tape.start;
  const sunday = addDays(bucket, 6);
  return { start, end: sunday < lastDay ? sunday : lastDay };
}

export function stretchRange(
  tape: StatsTape,
  window: ExplorerWindow,
): { start: string; end: string } {
  const last = Math.max(window.from, window.to - 1);
  return {
    start: bucketRange(tape, window.from).start,
    end: bucketRange(tape, last).end,
  };
}

function daysIn(range: { start: string; end: string }): number {
  return Math.max(
    0,
    Math.round((dayTime(range.end) - dayTime(range.start)) / DAY_MS) + 1,
  );
}

export function summarizeStretch(
  tape: StatsTape,
  window: ExplorerWindow,
): StretchSummary {
  const from = Math.max(0, window.from);
  const to = Math.min(tape.points.length, window.to);
  const empty: StretchSummary = {
    buckets: 0,
    minutes: 0,
    average: 0,
    silent: 0,
    energy: null,
    valence: null,
  };
  if (to <= from) return empty;

  // Mood buckets are daily for short ranges and Monday-keyed weekly beyond
  // that, independent of the points granularity; fall back to the Monday.
  const mood = new Map(tape.mood.map((item) => [item.bucket, item]));
  let minutes = 0;
  let silent = 0;
  let days = 0;
  let energySum = 0;
  let energyWeight = 0;
  let valenceSum = 0;
  let valenceWeight = 0;

  for (let index = from; index < to; index += 1) {
    const point = tape.points[index]!;
    minutes += point.minutes;
    if (point.minutes <= 0) silent += 1;
    days += daysIn(bucketRange(tape, index));
    const item = mood.get(point.bucket) ?? mood.get(mondayOf(point.bucket));
    if (!item || point.minutes <= 0) continue;
    if (typeof item.energy === "number") {
      energySum += item.energy * point.minutes;
      energyWeight += point.minutes;
    }
    if (typeof item.valence === "number") {
      valenceSum += item.valence * point.minutes;
      valenceWeight += point.minutes;
    }
  }

  return {
    buckets: to - from,
    minutes,
    average: days > 0 ? minutes / days : 0,
    silent,
    energy: energyWeight > 0 ? energySum / energyWeight : null,
    valence: valenceWeight > 0 ? valenceSum / valenceWeight : null,
  };
}
