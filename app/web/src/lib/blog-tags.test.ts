// @vitest-environment node
import { describe, expect, it } from "vitest";
import { blogTags, postTags, tagSlug, tagUrl } from "./blog-tags";
import type { BlogEntry } from "./blog";

function entry(id: string, tags: string[], draft = false, date = "2026-11-10"): BlogEntry {
  return { id, data: { title: id, description: "", date: new Date(date), draft, tags, sources: [] } };
}

describe("blog topics", () => {
  it("shares a readable route for case, spacing and compatibility Unicode variants", () => {
    expect(tagSlug(" Smart   Mix ")).toBe("smart-mix");
    expect(tagSlug("SMART MIX")).toBe("smart-mix");
    expect(tagSlug("Ｐｙｔｈｏｎ")).toBe("python");
    expect(tagUrl("Smart Mix")).toBe("/blog/tags/smart-mix");
    expect(tagUrl("  ")).toBe("/blog/tags");
  });

  it("does not collapse punctuation, accents or literal hyphens into other topics", () => {
    const labels = ["C", "C++", "C#", "a b", "a-b", "café", "cafe", "~e9~", "é", "a/b", "a_b"];
    const slugs = labels.map(tagSlug);
    expect(new Set(slugs).size).toBe(labels.length);
    expect(slugs.every((slug) => /^[a-z0-9~-]+$/.test(slug))).toBe(true);
  });

  it("preserves authored chip order and spelling while removing empty and duplicate values", () => {
    expect(postTags(["Smart Mix", " ", "smart  mix", "PostgreSQL", "postgresql"]))
      .toEqual([
        { key: "smart mix", label: "Smart Mix", slug: "smart-mix", href: "/blog/tags/smart-mix" },
        { key: "postgresql", label: "PostgreSQL", slug: "postgresql", href: "/blog/tags/postgresql" },
      ]);
  });

  it("counts each post once per normalized topic and keeps calendar ordering", () => {
    const posts = [entry("a", ["Audio", "audio"]), entry("b", ["audio", "Python"]), entry("c", ["Audio"])];
    const groups = blogTags(posts, { order: ["b", "c", "a"] });
    expect(groups.map((tag) => tag.key)).toEqual(["audio", "python"]);
    expect(groups[0].posts.map((post) => post.id)).toEqual(["b", "c", "a"]);
    expect(groups[1].posts.map((post) => post.id)).toEqual(["b"]);
    expect(posts.map((post) => post.id)).toEqual(["a", "b", "c"]);
  });

  it("excludes draft posts and draft-only topics from publication, including their labels", () => {
    const posts = [entry("public", ["Audio"]), entry("draft", ["AUDIO", "Secret topic"], true, "2027-01-01")];
    const groups = blogTags(posts);
    expect(groups.map((tag) => tag.label)).toEqual(["Audio"]);
    expect(groups[0].posts.map((post) => post.id)).toEqual(["public"]);
    const preview = blogTags(posts, { includeDrafts: true });
    expect(preview.map((tag) => tag.key)).toEqual(["audio", "secret topic"]);
    expect(preview[0].posts.map((post) => post.id)).toEqual(["draft", "public"]);
  });

  it("uses the blog's draft flag rather than imposing a new scheduled-date rule", () => {
    const groups = blogTags([entry("future-public", ["Audio"], false, "2099-01-01")]);
    expect(groups[0].posts[0].id).toBe("future-public");
  });

  it("keeps existing topic URLs stable when more labels are added", () => {
    const first = blogTags([entry("one", ["C++", "Smart Mix"])]);
    const next = blogTags([entry("new", ["C", "C#", "smart-mix"]), entry("one", ["C++", "Smart Mix"])]);
    for (const tag of first) expect(next.find((item) => item.key === tag.key)?.href).toBe(tag.href);
  });
});
