export type UpcomingTypeFilter = "all" | "releases" | "shows";

export interface UpcomingFilterItem {
  type: "release" | "show";
  artist: string;
  genres?: string[];
  city?: string;
}

export interface UpcomingFilterState {
  type: UpcomingTypeFilter;
  search?: string;
  genre?: string;
  city?: string;
}

function normalize(value: string | undefined): string {
  return (value || "").trim().toLowerCase();
}

export function filterUpcomingItems<T extends UpcomingFilterItem>(
  items: T[],
  filters: UpcomingFilterState,
): T[] {
  const search = normalize(filters.search);
  const genre = normalize(filters.genre);
  const city = normalize(filters.city);

  return items.filter((item) => {
    if (filters.type === "releases" && item.type !== "release") return false;
    if (filters.type === "shows" && item.type !== "show") return false;
    if (search && !normalize(item.artist).includes(search)) return false;
    if (
      genre &&
      !(item.genres || []).some((itemGenre) => normalize(itemGenre) === genre)
    ) {
      return false;
    }
    if (city) {
      return item.type === "show" && normalize(item.city) === city;
    }
    return true;
  });
}

export function buildUpcomingGenreOptions<T extends UpcomingFilterItem>(
  items: T[],
  filters: Pick<UpcomingFilterState, "type" | "search">,
): [string, number][] {
  const counts: Record<string, number> = {};
  for (const item of filterUpcomingItems(items, { ...filters })) {
    for (const genre of item.genres || []) {
      counts[genre] = (counts[genre] || 0) + 1;
    }
  }
  return Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 30);
}

export function buildUpcomingCityOptions<T extends UpcomingFilterItem>(
  items: T[],
  filters: Pick<UpcomingFilterState, "type">,
): [string, number][] {
  const counts: Record<string, number> = {};
  for (const item of items) {
    if (filters.type === "releases" || item.type !== "show") continue;
    const city = (item.city || "").trim();
    if (!city) continue;
    counts[city] = (counts[city] || 0) + 1;
  }
  return Object.entries(counts).sort(
    ([cityA, countA], [cityB, countB]) =>
      countB - countA || cityA.localeCompare(cityB),
  );
}

export interface UpcomingShowRef {
  type: "release" | "show";
  artist: string;
  date: string;
  show_id?: number;
}

/**
 * A show and the other listed shows that look like the same performance:
 * the same artist (trimmed, case-insensitive) on the same date. The show
 * itself comes first; at most `limit` IDs, as the merge editor takes.
 */
export function sameShowIds<T extends UpcomingShowRef>(
  items: T[],
  show: T,
  limit = 10,
): number[] {
  if (show.show_id === undefined) return [];
  const artist = normalize(show.artist);
  const ids = [show.show_id];
  for (const item of items) {
    if (
      item.type === "show" &&
      item.show_id !== undefined &&
      !ids.includes(item.show_id) &&
      item.date === show.date &&
      normalize(item.artist) === artist
    )
      ids.push(item.show_id);
  }
  return ids.slice(0, limit);
}
