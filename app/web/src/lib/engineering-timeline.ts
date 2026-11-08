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
      return { ...item, status: post.data.draft ? "draft" : "available" };
    }
    const { href: _href, ...history } = item;
    return { ...history, status: "planned" };
  });
}

/** Several milestones can belong to one article; start at its first occurrence. */
export function initialTimelineIndex(
  items: EngineeringMilestone[],
  currentPostHref?: string,
): number {
  if (!currentPostHref) return 0;
  return Math.max(
    0,
    items.findIndex((item) => item.href === currentPostHref),
  );
}
