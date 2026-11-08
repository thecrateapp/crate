// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { BlogEntry } from "./blog";
import { blogHome, SERIES_ID, SERIES_TITLE } from "./blog-home";

const post = (
  id: string,
  data: Partial<BlogEntry["data"]> = {},
): BlogEntry => ({
  id,
  data: {
    title: id,
    description: "",
    date: new Date("2026-11-10"),
    draft: false,
    tags: [],
    sources: [],
    ...data,
  },
});

const chapter = (
  id: string,
  part: number,
  data: Partial<BlogEntry["data"]> = {},
) =>
  post(id, {
    series: { id: SERIES_ID, title: SERIES_TITLE, part },
    ...data,
  });

describe("blogHome", () => {
  it("orders chapters by part even when publication dates disagree", () => {
    const first = chapter("first", 1, { date: new Date("2026-12-01") });
    const second = chapter("second", 2);
    const third = chapter("third", 3, { date: new Date("2026-01-01") });
    const article = post("article");

    const result = blogHome([third, article, first, second]);

    expect(result.chapters).toEqual([first, second, third]);
    expect(result.articles).toEqual([article]);
  });

  it("does not expose a draft first chapter or draft articles in production", () => {
    const first = chapter("unpublished-first", 1, { draft: true });
    const second = chapter("second", 2);
    const draftArticle = post("draft-article", { draft: true });
    const article = post("article");

    const result = blogHome([first, second, draftArticle, article]);

    expect(result.chapters).toEqual([second]);
    expect(result.articles).toEqual([article]);
    expect(blogHome([first, draftArticle])).toEqual({
      chapters: [],
      articles: [],
    });
  });

  it("includes both kinds of drafts when preview is explicitly enabled", () => {
    const first = chapter("first", 1, { draft: true });
    const second = chapter("second", 2);
    const draftArticle = post("draft-article", {
      draft: true,
      date: new Date("2026-12-08"),
    });
    const article = post("article");

    expect(
      blogHome([article, second, draftArticle, first], {
        includeDrafts: true,
      }),
    ).toEqual({
      chapters: [first, second],
      articles: [draftArticle, article],
    });
  });

  it("keeps other series among articles in date and calendar order", () => {
    const first = chapter("first", 1);
    const older = post("older", { date: new Date("2026-01-01") });
    const a = post("a");
    const b = post("b", {
      series: { id: "another-series", title: "Another series", part: 1 },
    });
    const newest = post("newest", { date: new Date("2026-12-01") });

    const result = blogHome([older, first, a, newest, b], {
      order: ["b", "a"],
    });

    expect(result.chapters).toEqual([first]);
    expect(result.articles).toEqual([newest, b, a, older]);
  });

  it("shows each visible entry once without mutating collection data", () => {
    const first = { ...chapter("first", 1), filePath: "first.md" };
    const article = { ...post("article"), filePath: "article.md" };
    const entries = [article, first, article, first];
    const before = structuredClone(entries);

    const result = blogHome(entries);

    expect(result.chapters).toEqual([first]);
    expect(result.articles).toEqual([article]);
    expect(result.chapters[0]!.filePath).toBe("first.md");
    expect(result.chapters[0]).toBe(first);
    expect(result.articles[0]).toBe(article);
    expect(entries).toEqual(before);
  });

  it("supports an empty collection and deterministic duplicate part numbers", () => {
    expect(blogHome([])).toEqual({ chapters: [], articles: [] });
    const a = chapter("a", 1);
    const b = chapter("b", 1);
    expect(blogHome([b, a]).chapters).toEqual([a, b]);
  });
});
