import type { EngineeringMilestone } from "../data/engineering-timeline";
import { postUrl, publishedPosts, type BlogEntry } from "./blog";

/** Keep the history intact while exposing only articles rendered in this build. */
export function prepareTimeline(
  items: EngineeringMilestone[],
  posts: BlogEntry[],
  options: { includeDrafts?: boolean } = {},
): EngineeringMilestone[] {
  const visible = new Map(
    publishedPosts(posts, options).map((post) => [postUrl(post.id), post]),
  );

  return items.map((item) => {
    const post = item.href ? visible.get(item.href) : undefined;
    if (post) {
      return {
        ...item,
        article: { title: post.data.title, part: post.data.series?.part },
        status: post.data.draft ? "draft" : "available",
      };
    }
    const { href: _href, article: _article, ...history } = item;
    return { ...history, status: "planned" };
  });
}

/** Honour an incoming milestone only when it belongs to the visible article. */
export function initialTimelineIndex(
  items: Pick<EngineeringMilestone, "id" | "href">[],
  currentPostHref?: string,
  requestedMilestoneId?: string,
): number {
  if (!currentPostHref) return 0;
  const requested = items.findIndex(
    (item) => item.id === requestedMilestoneId && item.href === currentPostHref,
  );
  if (requested !== -1) return requested;
  return Math.max(
    0,
    items.findIndex((item) => item.href === currentPostHref),
  );
}

/** Keep the selected event when several events share the same article. */
export function timelineArticleHref(
  item: Pick<EngineeringMilestone, "id" | "href">,
  currentPostHref?: string,
): string | undefined {
  if (!item.href) return undefined;
  const anchor = item.href === currentPostHref ? "#post-content" : "";
  return `${item.href}?milestone=${encodeURIComponent(item.id)}${anchor}`;
}
