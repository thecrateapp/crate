// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  formatPostDate,
  postUrl,
  publishedPosts,
  readingMinutes,
  readingWords,
  sourceUrl,
  type BlogEntry,
} from "./blog";

function entry(id: string, date: string, draft = false): BlogEntry {
  return {
    id,
    data: {
      title: id,
      description: "",
      date: new Date(`${date}T00:00:00Z`),
      draft,
      tags: [],
      sources: [],
    },
  };
}

describe("publishedPosts", () => {
  const posts = [
    entry("older", "2026-11-17"),
    entry("draft", "2026-12-01", true),
    entry("newer", "2026-11-24"),
  ];

  it("hides drafts and sorts newest first", () => {
    expect(publishedPosts(posts).map((post) => post.id)).toEqual([
      "newer",
      "older",
    ]);
  });

  it("can include drafts for local preview", () => {
    expect(
      publishedPosts(posts, { includeDrafts: true }).map((post) => post.id),
    ).toEqual(["draft", "newer", "older"]);
  });
});

describe("readingMinutes", () => {
  it("rounds to whole minutes at 220 words per minute", () => {
    expect(readingMinutes("word ".repeat(660))).toBe(3);
  });

  it("never reports less than a minute", () => {
    expect(readingMinutes("short")).toBe(1);
  });

  it("ignores code fences and markdown punctuation", () => {
    const text = "One two.\n\n```ts\nconst a = 1;\n```\n\n## Three";
    expect(readingMinutes(text)).toBe(1);
  });
});

describe("readingWords", () => {
  it("counts prose words and skips code blocks", () => {
    expect(readingWords("It's a 20-number vector.\n\n```\nskip me\n```")).toBe(
      4,
    );
  });
});

describe("formatPostDate", () => {
  it("uses an ISO date in UTC", () => {
    expect(formatPostDate(new Date("2026-11-17T23:30:00Z"))).toBe("2026-11-17");
  });
});

describe("sourceUrl", () => {
  it("links files to the blob view on main", () => {
    expect(sourceUrl("app/crate/projector.py")).toBe(
      "https://github.com/thecrateapp/crate/blob/main/app/crate/projector.py",
    );
  });

  it("links directories to the tree view on main", () => {
    expect(sourceUrl("app/readplane/internal/snapshots")).toBe(
      "https://github.com/thecrateapp/crate/tree/main/app/readplane/internal/snapshots",
    );
  });
});

describe("postUrl", () => {
  it("builds the canonical path without a trailing slash", () => {
    expect(postUrl("read-plane")).toBe("/blog/read-plane");
  });
});
