// @vitest-environment node
import { describe, expect, it } from "vitest";
import { postNavigation } from "./blog-navigation";
import type { BlogEntry } from "./blog";

const entry = (
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
  entry(id, {
    series: { id: "building-crate", title: "Building Crate", part },
    ...data,
  });

describe("postNavigation", () => {
  it("orders series by chapter, even when publication dates disagree", () => {
    const first = chapter("first", 1, { date: new Date("2026-12-01") });
    const middle = chapter("middle", 2);
    const last = chapter("last", 3, { date: new Date("2026-01-01") });
    const unrelated = entry("unrelated");
    const result = postNavigation(middle, [last, unrelated, first, middle]);
    expect(result.previous).toBe(first);
    expect(result.next).toBe(last);
  });

  it("does not invent links at series boundaries or cross into another series", () => {
    const only = chapter("only", 1);
    const other = entry("other", {
      series: { id: "other", title: "Other", part: 2 },
    });
    expect(postNavigation(only, [only, other, entry("standalone")])).toEqual({
      previous: undefined,
      next: undefined,
      related: [],
    });
  });

  it("hides draft neighbours and curated suggestions in production", () => {
    const current = chapter("current", 1, { related: ["draft-related"] });
    const draft = chapter("draft", 2, { draft: true });
    const draftRelated = entry("draft-related", { draft: true, tags: ["db"] });
    const published = chapter("published", 3);
    const all = [current, draft, draftRelated, published];
    expect(postNavigation(current, all).next).toBe(published);
    expect(postNavigation(current, all).related).toEqual([]);
    expect(postNavigation(current, all, { includeDrafts: true }).next).toBe(
      draft,
    );
    expect(
      postNavigation(current, all, { includeDrafts: true }).related,
    ).toEqual([draftRelated]);
    expect(postNavigation(draft, all)).toEqual({ related: [] });
  });

  it("steps through standalone articles only, oldest first and in calendar order on the same day", () => {
    const oldest = entry("oldest", { date: new Date("2026-01-01") });
    const first = entry("first");
    const between = chapter("between", 1);
    const second = entry("second");
    const newest = entry("newest", { date: new Date("2026-12-01") });
    const entries = [newest, second, between, oldest, first];
    const order = ["first", "between", "second"];
    const fromFirst = postNavigation(first, entries, { order });
    expect(fromFirst.previous).toBe(oldest);
    expect(fromFirst.next).toBe(second);
    const fromSecond = postNavigation(second, entries, { order });
    expect(fromSecond.previous).toBe(first);
    expect(fromSecond.next).toBe(newest);
  });

  it("preserves curated order then ranks actual shared topics, excluding current and neighbours", () => {
    const current = chapter("current", 2, {
      tags: ["PostgreSQL", "catalogue"],
      related: ["next", "missing", "curated", "curated", "current"],
    });
    const previous = chapter("previous", 1, { tags: ["catalogue"] });
    const next = chapter("next", 3, { tags: ["catalogue"] });
    const curated = entry("curated");
    const strongest = entry("strongest", { tags: ["postgresql", "catalogue"] });
    const oneTopic = entry("one-topic", { tags: ["PostgreSQL", "PostgreSQL"] });
    const other = entry("other", { tags: ["audio"] });
    const result = postNavigation(current, [
      previous,
      current,
      next,
      curated,
      oneTopic,
      strongest,
      other,
    ]);
    expect(result.related.map((post) => post.id)).toEqual([
      "curated",
      "strongest",
      "one-topic",
    ]);
  });

  it("does not fill an empty related column with unrelated posts", () => {
    const current = chapter("current", 1, { tags: ["database"] });
    expect(
      postNavigation(current, [
        current,
        entry("unrelated", { tags: ["audio"] }),
      ]).related,
    ).toEqual([]);
  });
});
