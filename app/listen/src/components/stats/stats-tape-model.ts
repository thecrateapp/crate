import type {
  StatsTape,
  StatsTapeMonth,
  StatsTapePeak,
} from "@/components/stats/stats-model";

export const TAPE_WIDTH = 1000;
export const TAPE_HEIGHT = 220;
const SQRT_SCALE_MIN_POINTS = 120;
const STAGGER_TOTAL_MS = 900;

export interface TapeBar {
  index: number;
  bucket: string;
  x: number;
  width: number;
  y: number;
  height: number;
  hot: boolean;
  today: boolean;
  delayMs: number;
}

export interface TapeAxisLabel {
  key: string;
  label: string;
  position: number;
}

export interface TapeModel {
  bars: TapeBar[];
  moodPath: string | null;
  axis: TapeAxisLabel[];
  monthsByKey: Map<string, StatsTapeMonth>;
  peaksByBucket: Map<string, StatsTapePeak>;
}

function dayTime(value: string): number {
  return Date.parse(`${value}T00:00:00Z`);
}

function buildMoodPath(tape: StatsTape): string | null {
  const start = dayTime(tape.start);
  const span = dayTime(tape.end) - start;
  const points = tape.mood
    .filter((item) => typeof item.energy === "number")
    .map((item) => {
      const x = ((dayTime(item.bucket) - start) / span) * TAPE_WIDTH;
      const y =
        TAPE_HEIGHT * 0.06 + (1 - (item.energy ?? 0)) * TAPE_HEIGHT * 0.3;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
  if (points.length < 2) return null;
  return `M${points.join(" L")}`;
}

function buildAxis(tape: StatsTape, locale: string): TapeAxisLabel[] {
  const points = tape.points;
  if (!points.length) return [];
  const position = (index: number) => index / points.length;
  if (tape.granularity === "week") {
    const seen = new Set<string>();
    return points.flatMap((point, index) => {
      const year = point.bucket.slice(0, 4);
      if (seen.has(year)) return [];
      seen.add(year);
      return [{ key: year, label: year, position: position(index) }];
    });
  }
  if (points.length > 62) {
    const monthFormat = new Intl.DateTimeFormat(locale, {
      month: "short",
      timeZone: "UTC",
    });
    return points.flatMap((point, index) =>
      point.bucket.endsWith("-01") || index === 0
        ? [
            {
              key: point.bucket,
              label: monthFormat.format(new Date(dayTime(point.bucket))),
              position: position(index),
            },
          ]
        : [],
    );
  }
  const dayFormat = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const step = Math.max(1, Math.round(points.length / 5));
  return points.flatMap((point, index) =>
    index % step === 0
      ? [
          {
            key: point.bucket,
            label: dayFormat.format(new Date(dayTime(point.bucket))),
            position: position(index),
          },
        ]
      : [],
  );
}

export function buildTapeModel(
  tape: StatsTape,
  { locale, today }: { locale: string; today: string },
): TapeModel {
  const points = tape.points;
  const count = points.length;
  const max = Math.max(1, ...points.map((point) => point.minutes));
  const sqrtScale = count >= SQRT_SCALE_MIN_POINTS;
  const slot = count ? TAPE_WIDTH / count : TAPE_WIDTH;
  const peaksByBucket = new Map(tape.peaks.map((peak) => [peak.bucket, peak]));
  const hotBuckets = new Set(peaksByBucket.keys());
  if (tape.granularity === "day" && !sqrtScale) {
    [...points]
      .filter((point) => point.minutes > 0)
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 3)
      .forEach((point) => hotBuckets.add(point.bucket));
  }
  const todayBucket =
    tape.granularity === "week"
      ? [...points].reverse().find((point) => point.bucket <= today)?.bucket
      : today;

  const bars = points.map((point, index) => {
    const ratio = point.minutes / max;
    const height =
      point.minutes > 0
        ? Math.max(
            2,
            (sqrtScale ? Math.sqrt(ratio) : ratio) * TAPE_HEIGHT * 0.8,
          )
        : 0;
    const hot = hotBuckets.has(point.bucket);
    const width = sqrtScale
      ? hot
        ? Math.max(3, slot * 0.62)
        : slot * 0.62
      : slot * 0.7;
    return {
      index,
      bucket: point.bucket,
      x: index * slot + (slot - width) / 2,
      width,
      y: TAPE_HEIGHT - height,
      height,
      hot,
      today: point.bucket === todayBucket,
      delayMs: Math.round((index * STAGGER_TOTAL_MS) / Math.max(1, count)),
    };
  });

  return {
    bars,
    moodPath: buildMoodPath(tape),
    axis: buildAxis(tape, locale),
    monthsByKey: new Map(tape.months.map((month) => [month.month, month])),
    peaksByBucket,
  };
}

export function tapeIndexAt(
  offsetX: number,
  width: number,
  count: number,
): number {
  if (!count || width <= 0) return 0;
  return Math.min(
    count - 1,
    Math.max(0, Math.floor((offsetX / width) * count)),
  );
}
