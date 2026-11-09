import { publishedPosts, type BlogEntry } from "./blog";

export interface PostNavigation<T extends BlogEntry> {
  previous?: T;
  next?: T;
  related: T[];
}

/** Resolve only real, visible entries; series order is independent of publish dates. */
export function postNavigation<T extends BlogEntry>(
  current: T,
  entries: T[],
  options: { includeDrafts?: boolean; order?: string[] } = {},
): PostNavigation<T> {
  const visible = publishedPosts(entries, options);
  if (!visible.some((entry) => entry.id === current.id)) return { related: [] };

  const sequence = current.data.series
    ? visible
        .filter((entry) => entry.data.series?.id === current.data.series!.id)
        .sort(
          (a, b) =>
            a.data.series!.part - b.data.series!.part ||
            a.id.localeCompare(b.id),
        )
    : // Standalone articles step through each other: oldest first, calendar order on the same day.
      visible
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => !entry.data.series)
        .sort(
          (a, b) =>
            a.entry.data.date.getTime() - b.entry.data.date.getTime() ||
            a.index - b.index,
        )
        .map(({ entry }) => entry);
  const index = sequence.findIndex((entry) => entry.id === current.id);
  const previous = sequence[index - 1];
  const next = sequence[index + 1];
  const excluded = new Set([current.id, previous?.id, next?.id]);
  const candidates = visible.filter((entry) => !excluded.has(entry.id));
  const curated = [...new Set(current.data.related ?? [])]
    .map((id) => candidates.find((entry) => entry.id === id))
    .filter((entry): entry is T => Boolean(entry));
  const tags = new Set(
    current.data.tags.map((tag) => tag.trim().toLowerCase()),
  );
  const scored = candidates
    .filter((entry) => !curated.includes(entry))
    .map((entry) => ({
      entry,
      score: [
        ...new Set(entry.data.tags.map((tag) => tag.trim().toLowerCase())),
      ].filter((tag) => tags.has(tag)).length,
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  return {
    previous,
    next,
    related: [...curated, ...scored.map(({ entry }) => entry)].slice(0, 3),
  };
}
