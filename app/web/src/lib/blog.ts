export interface BlogData {
  title: string;
  description: string;
  date: Date;
  updated?: Date;
  draft: boolean;
  tags: string[];
  sources: string[];
  series?: { id: string; title: string; part: number };
  related?: string[];
}

export interface BlogEntry {
  id: string;
  body?: string;
  data: BlogData;
}

const WORDS_PER_MINUTE = 220;

export function publishedPosts<T extends BlogEntry>(
  posts: T[],
  {
    includeDrafts = false,
    order = [],
  }: { includeDrafts?: boolean; order?: string[] } = {},
): T[] {
  const rank = (id: string) => {
    const index = order.indexOf(id);
    return index === -1 ? order.length : index;
  };
  return posts
    .filter((post) => includeDrafts || !post.data.draft)
    .sort(
      (a, b) =>
        b.data.date.getTime() - a.data.date.getTime() ||
        rank(a.id) - rank(b.id) ||
        a.id.localeCompare(b.id),
    );
}

export function readingWords(markdown: string): number {
  const prose = markdown.replace(/```[\s\S]*?```/g, " ");
  return (prose.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
}

export function readingMinutes(markdown: string): number {
  return Math.max(1, Math.round(readingWords(markdown) / WORDS_PER_MINUTE));
}

export function formatPostDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function postUrl(id: string): string {
  return `/blog/${id}`;
}

const REPO = "https://github.com/thecrateapp/crate";

export function sourceUrl(path: string): string {
  const name = path.split("/").pop() ?? "";
  const view = name.includes(".") ? "blob" : "tree";
  return `${REPO}/${view}/main/${path}`;
}
