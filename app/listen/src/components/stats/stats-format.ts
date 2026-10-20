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
