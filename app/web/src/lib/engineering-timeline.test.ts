// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  milestones,
  type EngineeringMilestone,
} from "../data/engineering-timeline";
import type { BlogEntry } from "./blog";
import {
  initialTimelineIndex,
  prepareTimeline,
  timelineArticleHref,
} from "./engineering-timeline";

const post = (id: string, draft = false): BlogEntry => ({
  id,
  data: {
    title: id,
    description: "",
    date: new Date("2026-11-10"),
    draft,
    tags: [],
    sources: [],
  },
});
const milestone = (
  id: string,
  href?: string,
  status: EngineeringMilestone["status"] = "available",
): EngineeringMilestone => ({ ...milestones[0]!, id, href, status });

describe("prepareTimeline", () => {
  it("removes links to drafts and missing articles in production without removing milestones", () => {
    const items = [
      milestone("published", "/blog/published"),
      milestone("draft", "/blog/draft"),
      milestone("missing", "/blog/missing"),
      milestone("planned", undefined, "planned"),
    ];
    const prepared = prepareTimeline(items, [
      post("published"),
      post("draft", true),
    ]);
    expect(prepared.map((item) => item.id)).toEqual(
      items.map((item) => item.id),
    );
    expect(prepared[0]).toMatchObject(items[0]!);
    expect(prepared[0]!.article).toEqual({
      title: "published",
      part: undefined,
    });
    for (const item of prepared.slice(1)) {
      expect(item).not.toHaveProperty("href");
      expect(item).not.toHaveProperty("article");
      expect(item.status).toBe("planned");
    }
  });

  it("uses the destination article's actual title and chapter for the reading link", () => {
    const entry = post("catalogue", true);
    entry.data.title = "When the filesystem stopped being the catalogue";
    entry.data.series = { id: "history", title: "History", part: 2 };
    const [prepared] = prepareTimeline(
      [milestone("postgresql", "/blog/catalogue")],
      [entry],
      { includeDrafts: true },
    );
    expect(prepared!.article).toEqual({ title: entry.data.title, part: 2 });
  });

  it("uses actual collection status for visible drafts and newly published articles", () => {
    const items = [
      milestone("now-published", "/blog/published", "draft"),
      milestone("now-draft", "/blog/draft", "available"),
    ];
    const prepared = prepareTimeline(
      items,
      [post("published"), post("draft", true)],
      {
        includeDrafts: true,
      },
    );
    expect(prepared.map(({ href, status }) => ({ href, status }))).toEqual([
      { href: "/blog/published", status: "available" },
      { href: "/blog/draft", status: "draft" },
    ]);
    expect(prepareTimeline(items, [post("published")])[0]!.status).toBe(
      "available",
    );
  });

  it("preserves every historical detail and leaves the source dataset and collection unchanged", () => {
    const before = structuredClone(milestones);
    const posts = [
      post("crate-started-as-a-librarian", true),
      post("reads-from-snapshots"),
    ];
    const beforePosts = structuredClone(posts);
    const prepared = prepareTimeline(milestones, posts);
    expect(prepared).toHaveLength(milestones.length);
    expect(prepared.length).toBeGreaterThanOrEqual(37);
    prepared.forEach(
      (
        { href: _href, status: _status, article: _article, ...history },
        index,
      ) => {
        const {
          href: _sourceHref,
          status: _sourceStatus,
          ...original
        } = before[index]!;
        expect(history).toEqual(original);
      },
    );
    expect(milestones).toEqual(before);
    expect(posts).toEqual(beforePosts);
  });
});

describe("initialTimelineIndex", () => {
  it("preserves a selected later event only for its matching visible article", () => {
    const href = "/blog/filesystem-to-indexed-catalogue";
    const requested = initialTimelineIndex(milestones, href, "postgresql");
    expect(milestones[requested]!.id).toBe("postgresql");
    expect(
      milestones[initialTimelineIndex(milestones, href, "crate-v3")]!.id,
    ).toBe("catalog");
    expect(
      milestones[initialTimelineIndex(milestones, href, "missing")]!.id,
    ).toBe("catalog");
    const hidden = prepareTimeline(milestones, []);
    expect(initialTimelineIndex(hidden, href, "postgresql")).toBe(0);
  });
  it("starts at the first of several milestones covered by the current article", () => {
    const index = initialTimelineIndex(
      milestones,
      "/blog/filesystem-to-indexed-catalogue",
    );
    expect(milestones[index]!.id).toBe("catalog");
    expect(
      milestones.filter((item) => item.href === milestones[index]!.href).length,
    ).toBeGreaterThan(1);
    expect(initialTimelineIndex(milestones, "/blog/reads-from-snapshots")).toBe(
      milestones.findIndex((item) => item.id === "snapshots"),
    );
  });

  it("falls back to the beginning without an available matching article", () => {
    expect(initialTimelineIndex(milestones)).toBe(0);
    expect(initialTimelineIndex(milestones, "/blog/unknown")).toBe(0);
    const publicTimeline = prepareTimeline(milestones, []);
    expect(
      initialTimelineIndex(
        publicTimeline,
        "/blog/filesystem-to-indexed-catalogue",
      ),
    ).toBe(0);
  });
});

describe("timelineArticleHref", () => {
  it("carries the selected event to the article and to its current-page reading anchor", () => {
    const item = milestone("postgresql", "/blog/catalogue");
    expect(timelineArticleHref(item)).toBe(
      "/blog/catalogue?milestone=postgresql",
    );
    expect(timelineArticleHref(item, "/blog/catalogue")).toBe(
      "/blog/catalogue?milestone=postgresql#post-content",
    );
    expect(timelineArticleHref(milestone("unavailable"))).toBeUndefined();
  });
});
