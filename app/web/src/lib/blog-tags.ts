import { publishedPosts, type BlogEntry } from "./blog";

export interface BlogTag {
  key: string;
  label: string;
  slug: string;
  href: string;
}

export interface BlogTagGroup<T extends BlogEntry = BlogEntry> extends BlogTag {
  posts: T[];
}

const cleanLabel = (tag: string) => tag.normalize("NFKC").trim().replace(/\s+/gu, " ");
const keyFor = (tag: string) => cleanLabel(tag).toLowerCase();

/** Spaces become hyphens; punctuation is escaped so C, C++ and C# never collide.
 * Unlike a numbered collision suffix, a tag's address cannot change when another
 * post or tag is added. Case and compatibility Unicode variants share a route.
 */
export function tagSlug(tag: string): string {
  return Array.from(keyFor(tag), (character) => {
    if (/^[a-z0-9]$/.test(character)) return character;
    if (character === " ") return "-";
    return `~${character.codePointAt(0)!.toString(16)}~`;
  }).join("");
}

export function tagUrl(tag: string): string {
  const slug = tagSlug(tag);
  return slug ? `/blog/tags/${slug}` : "/blog/tags";
}

/** Retain an author's display labels and ordering, removing duplicate topics. */
export function postTags(tags: string[]): BlogTag[] {
  const unique = new Map<string, BlogTag>();
  for (const value of tags) {
    const label = cleanLabel(value);
    const key = keyFor(label);
    if (!key || unique.has(key)) continue;
    unique.set(key, { key, label, slug: tagSlug(key), href: tagUrl(key) });
  }
  return Array.from(unique.values());
}

export function blogTags<T extends BlogEntry>(
  posts: T[],
  options: { includeDrafts?: boolean; order?: string[] } = {},
): BlogTagGroup<T>[] {
  const groups = new Map<string, BlogTagGroup<T>>();
  for (const post of publishedPosts(posts, options)) {
    for (const tag of postTags(post.data.tags)) {
      let group = groups.get(tag.key);
      if (!group) {
        group = { ...tag, posts: [] };
        groups.set(tag.key, group);
      }
      group.posts.push(post);
    }
  }
  return Array.from(groups.values()).sort((a, b) => a.key.localeCompare(b.key, "en"));
}
