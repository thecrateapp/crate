import type { GenreProfileItem } from "@crate/ui/domain/genres/GenrePill";
import type { StatsGenre } from "./stats-types";

export function buildStatsGenreProfile(
  genres: StatsGenre[],
  max = 8,
): GenreProfileItem[] {
  if (
    genres.length &&
    genres.every((genre) => typeof genre.share === "number")
  ) {
    return genres
      .map((genre) => ({
        name: genre.genre_name,
        slug: genre.slug ?? null,
        share: genre.share ?? 0,
      }))
      .sort((a, b) => b.share - a.share)
      .slice(0, max);
  }

  const weights = new Map<string, { name: string; weight: number }>();
  let total = 0;
  for (const genre of genres) {
    const labels = new Map<string, string>();
    for (const rawLabel of genre.genre_name.split(",")) {
      const label = rawLabel.trim();
      const key = label.toLowerCase();
      if (label && !labels.has(key)) labels.set(key, label);
    }
    if (!labels.size) continue;
    const plays = Math.max(0, genre.play_count || 0);
    const share = plays / labels.size;
    total += plays;
    for (const [key, label] of labels) {
      const entry = weights.get(key);
      if (entry) entry.weight += share;
      else weights.set(key, { name: label, weight: share });
    }
  }

  return [...weights.values()]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, max)
    .map(({ name, weight }) => ({
      name,
      weight,
      share: total > 0 ? weight / total : 0,
    }));
}

export function formatStatsMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0m";
  const rounded = Math.round(minutes);
  if (rounded >= 60) {
    const hours = Math.floor(rounded / 60);
    const remaining = rounded % 60;
    return remaining > 0 ? `${hours}h ${remaining}m` : `${hours}h`;
  }
  return `${rounded}m`;
}

export function formatStatsPercent(value: number): string {
  return `${Math.round((value || 0) * 100)}%`;
}

/** Signed integer percent change, "+12%" / "−3%" (U+2212). Null when there is nothing to compare. */
export function formatStatsDelta(
  current: number,
  previous: number | null | undefined,
  locale: string,
): string | null {
  if (!previous || !Number.isFinite(previous) || !Number.isFinite(current))
    return null;
  const percent = Math.round(((current - previous) / previous) * 100);
  const magnitude = new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(Math.abs(percent) / 100);
  if (percent === 0) return magnitude;
  return `${percent > 0 ? "+" : "−"}${magnitude}`;
}

/** Minute-granularity relative time ("4 minutes ago"). Null for a missing/invalid timestamp. */
export function formatStatsRelativeTime(
  iso: string | null | undefined,
  now: number,
  locale: string,
): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const minutes = Math.min(0, Math.round((then - now) / 60_000));
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (minutes > -60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours > -24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}
