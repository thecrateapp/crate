import type { StatsGenre, StatsGenreTrend, StatsHeatmap } from "./stats-types";

/** D30: the instance grid needs at least this many listeners. */
export const HEATMAP_MIN_LISTENERS = 3;
/** PD43: the instance builder's `hidden_reason` below three listeners. */
export const HEATMAP_HIDDEN_FEW_LISTENERS = "few_listeners";
/** The backend's `_NIGHT_HOURS`, for payloads older than `night_hours`. */
export const DEFAULT_NIGHT_HOURS: readonly number[] = [
  22, 23, 0, 1, 2, 3, 4, 5,
];
/** Delay between diagonals of the entrance wave. */
export const HEATMAP_WAVE_STEP_MS = 18;
const GLOW_LEVEL = 0.6;
const WEEKDAYS = 7;
const HOURS = 24;
/** `cells[weekday]`: 0 is Monday (ISO day - 1), matching `_heatmap`. */
const INTL_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export type HeatmapScope = "personal" | "user" | "global";

export interface HeatmapSlot {
  weekday: number;
  hour: number;
}

export interface HeatmapCellModel extends HeatmapSlot {
  /** Row-major position, `weekday * 24 + hour`. */
  index: number;
  minutes: number;
  /** 0..1 against the busiest cell. */
  level: number;
  night: boolean;
  glow: boolean;
  peak: boolean;
  /** The single style each cell carries. */
  vars: { "--stats-level": string; "--stats-delay": string };
}

export interface HeatmapModel {
  rows: HeatmapCellModel[][];
  total: number;
  max: number;
  peak: (HeatmapSlot & { minutes: number }) | null;
  nightHours: number[];
  /** Null when unknown: hidden by the server, or no listening at all. */
  nightShare: number | null;
  nightRange: { start: number; end: number } | null;
  nowCell: HeatmapSlot | null;
}

function minutesAt(heatmap: StatsHeatmap, weekday: number, hour: number) {
  const value = heatmap.cells?.[weekday]?.[hour];
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

function isSlot(slot: HeatmapSlot | null | undefined): slot is HeatmapSlot {
  return (
    !!slot &&
    Number.isInteger(slot.weekday) &&
    Number.isInteger(slot.hour) &&
    slot.weekday >= 0 &&
    slot.weekday < WEEKDAYS &&
    slot.hour >= 0 &&
    slot.hour < HOURS
  );
}

function zoneParts(timezone: string | null | undefined, now: Date) {
  if (!timezone) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((item) => item.type === type)?.value ?? "";
    const weekday = INTL_WEEKDAYS.indexOf(part("weekday"));
    const hour = Number(part("hour")) % HOURS;
    const minute = Number(part("minute"));
    const second = Number(part("second"));
    if (weekday < 0 || [hour, minute, second].some(Number.isNaN)) return null;
    return { weekday, hour, minute, second };
  } catch {
    // RangeError: the zone is not a valid IANA name.
    return null;
  }
}

/** The weekday/hour cell `now` falls in, in `timezone`; null for a missing or invalid zone. */
export function heatmapNowCell(
  timezone: string | null | undefined,
  now: Date,
): HeatmapSlot | null {
  const parts = zoneParts(timezone, now);
  return parts ? { weekday: parts.weekday, hour: parts.hour } : null;
}

/**
 * Milliseconds until the wall clock in `timezone` next reaches :00. Works for
 * :30 and :45 offsets and DST jumps (each fire recomputes); null for an invalid zone.
 */
export function msUntilNextHour(
  timezone: string | null | undefined,
  now: Date,
): number | null {
  const parts = zoneParts(timezone, now);
  if (!parts) return null;
  const elapsed =
    (parts.minute * 60 + parts.second) * 1000 + now.getUTCMilliseconds();
  return 3_600_000 - elapsed;
}

export function buildHeatmapModel(
  heatmap: StatsHeatmap,
  { timezone, now }: { timezone: string | null; now: Date },
): HeatmapModel {
  let total = 0;
  let max = 0;
  let argmax: (HeatmapSlot & { minutes: number }) | null = null;
  for (let weekday = 0; weekday < WEEKDAYS; weekday++) {
    for (let hour = 0; hour < HOURS; hour++) {
      const minutes = minutesAt(heatmap, weekday, hour);
      total += minutes;
      if (minutes > max) {
        max = minutes;
        argmax = { weekday, hour, minutes };
      }
    }
  }
  const nightHours = (
    heatmap.night_hours?.length ? heatmap.night_hours : DEFAULT_NIGHT_HOURS
  ).filter((hour) => Number.isInteger(hour) && hour >= 0 && hour < HOURS);
  const night = new Set(nightHours);
  const peak =
    total > 0
      ? isSlot(heatmap.peak)
        ? {
            weekday: heatmap.peak.weekday,
            hour: heatmap.peak.hour,
            minutes: minutesAt(
              heatmap,
              heatmap.peak.weekday,
              heatmap.peak.hour,
            ),
          }
        : argmax
      : null;
  const rows = Array.from({ length: WEEKDAYS }, (_, weekday) =>
    Array.from({ length: HOURS }, (_, hour): HeatmapCellModel => {
      const minutes = minutesAt(heatmap, weekday, hour);
      const level = max > 0 ? minutes / max : 0;
      return {
        weekday,
        hour,
        index: weekday * HOURS + hour,
        minutes,
        level,
        night: night.has(hour),
        glow: level >= GLOW_LEVEL,
        peak: peak !== null && peak.weekday === weekday && peak.hour === hour,
        vars: {
          "--stats-level": level.toFixed(3),
          "--stats-delay": `${(weekday + hour) * HEATMAP_WAVE_STEP_MS}ms`,
        },
      };
    }),
  );
  return {
    rows,
    total,
    max,
    peak,
    nightHours,
    nightShare:
      total > 0 &&
      typeof heatmap.night_share === "number" &&
      Number.isFinite(heatmap.night_share)
        ? heatmap.night_share
        : null,
    nightRange: nightHours.length
      ? { start: nightHours[0]!, end: nightHours[nightHours.length - 1]! }
      : null,
    nowCell: heatmapNowCell(timezone, now),
  };
}

/** The first ranked genre; the appended biggest faller is never the top genre. */
export function heatmapTopGenre(
  topGenres: readonly StatsGenre[] | null | undefined,
  trend: readonly StatsGenreTrend[] | null | undefined,
): string | null {
  const name =
    topGenres?.[0]?.genre_name?.trim() ||
    trend?.find((genre) => !genre.faller)?.genre_name?.trim();
  return name || null;
}

/**
 * D30/PD43: the instance grid stays hidden below three listeners. The server's
 * `hidden_reason` decides; the count (or its absence) is the fallback for
 * payloads built before the server rule.
 */
export function heatmapGridHidden(
  heatmap: StatsHeatmap,
  scope: HeatmapScope,
): boolean {
  if (heatmap.hidden_reason === HEATMAP_HIDDEN_FEW_LISTENERS) return true;
  return (
    scope === "global" && (heatmap.listener_count ?? 0) < HEATMAP_MIN_LISTENERS
  );
}
