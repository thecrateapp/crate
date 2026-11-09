import { publishedPosts, type BlogEntry } from "./blog";

export const SERIES_ID = "how-to-forget-spotify";
export const SERIES_TITLE =
  "How to dismantle Spotify. Building Crate from the ground.";

/** Split visible posts into the chronological series and independent articles. */
export function blogHome<T extends BlogEntry>(
  entries: T[],
  options: { includeDrafts?: boolean; order?: string[] } = {},
): { chapters: T[]; articles: T[] } {
  const seen = new Set<string>();
  const visible = publishedPosts(entries, options).filter((post) => {
    if (seen.has(post.id)) return false;
    seen.add(post.id);
    return true;
  });

  return {
    chapters: visible
      .filter((post) => post.data.series?.id === SERIES_ID)
      .sort(
        (a, b) =>
          a.data.series!.part - b.data.series!.part || a.id.localeCompare(b.id),
      ),
    articles: visible.filter((post) => post.data.series?.id !== SERIES_ID),
  };
}
