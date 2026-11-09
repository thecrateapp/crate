// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { codeSource } from "../lib/code-source";
import { calendar, LAUNCH_DATE } from "./blog-calendar";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const postsDir = fileURLToPath(new URL("../content/blog/", import.meta.url));

function frontmatter(file: string) {
  const text = readFileSync(`${postsDir}${file}`, "utf8");
  const [, head = "", body = ""] =
    text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/) ?? [];
  return {
    date: head.match(/^date:\s*(\S+)/m)?.[1],
    draft: /^draft:\s*true/m.test(head),
    body,
  };
}

const posts = existsSync(postsDir)
  ? readdirSync(postsDir).filter((file) => file.endsWith(".md"))
  : [];

describe("blog calendar", () => {
  it("has unique kebab-case slugs", () => {
    const slugs = calendar.map((entry) => entry.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("states the problem each post solves", () => {
    for (const entry of calendar) {
      expect(entry.problem.trim().length, entry.slug).toBeGreaterThan(20);
    }
  });

  it("launches every published post together on a Tuesday", () => {
    expect(new Date(`${LAUNCH_DATE}T00:00:00Z`).getUTCDay()).toBe(2);
    for (const entry of calendar.filter((item) => item.status === "published"))
      expect(entry.publishOn, entry.slug).toBe(LAUNCH_DATE);
  });

  it("schedules proposed articles on later Tuesdays, never going back in time", () => {
    let previous = LAUNCH_DATE;
    for (const entry of calendar.filter((item) => item.status !== "published")) {
      const day = new Date(`${entry.publishOn}T00:00:00Z`).getUTCDay();
      expect(day, entry.slug).toBe(2);
      expect(entry.publishOn > LAUNCH_DATE, entry.slug).toBe(true);
      expect(entry.publishOn >= previous, entry.slug).toBe(true);
      previous = entry.publishOn;
    }
  });

  it("publishes every written post", () => {
    const published = new Set(
      calendar.filter((item) => item.status === "published").map((item) => item.slug),
    );
    for (const file of posts) {
      expect(published, file).toContain(file.replace(/\.md$/, ""));
      expect(frontmatter(file).draft, file).toBe(false);
    }
  });

  it("cites sources that exist in the repository", () => {
    for (const entry of calendar) {
      expect(entry.sources.length, entry.slug).toBeGreaterThan(0);
      for (const source of entry.sources) {
        expect(
          existsSync(`${repoRoot}${source}`),
          `${entry.slug}: ${source}`,
        ).toBe(true);
      }
    }
  });

  it("matches published entries with posts on their date", () => {
    for (const entry of calendar.filter(
      (item) => item.status === "published",
    )) {
      const file = `${entry.slug}.md`;
      expect(posts, entry.slug).toContain(file);
      const post = frontmatter(file);
      expect(post.date, entry.slug).toBe(entry.publishOn);
      expect(post.draft, entry.slug).toBe(false);
    }
  });

  it("lists every post in the calendar", () => {
    const slugs = calendar.map((entry) => entry.slug);
    for (const file of posts)
      expect(slugs).toContain(file.replace(/\.md$/, ""));
  });

  it("does not send readers from published prose to missing or draft articles", () => {
    for (const file of posts) {
      const post = frontmatter(file);
      if (post.draft) continue;
      for (const [, slug] of post.body.matchAll(
        /\]\(\/blog\/([a-z0-9-]+)(?:[?#][^)]*)?\)/g,
      )) {
        const target = `${slug}.md`;
        expect(posts, `${file} links to ${slug}`).toContain(target);
        expect(
          frontmatter(target).draft,
          `${file} links to draft ${slug}`,
        ).toBe(false);
      }
    }
  });

  it("gives every code excerpt a pinned source and original line numbers", () => {
    let excerpts = 0;
    for (const file of posts) {
      const text = readFileSync(`${postsDir}${file}`, "utf8");
      for (const [, language, metadata] of text.matchAll(
        /^```(\S+)([^\n]*)\n[\s\S]*?^```[ \t]*$/gm,
      )) {
        const source = metadata.match(/\bsource="([^"]+)"/)?.[1];
        const commit = metadata.match(/\bcommit="([^"]+)"/)?.[1];
        const context = `${file}: ${metadata.trim()}`;
        // Authored shell commands use the documented terminal format.
        if (language === "sh" && !source) {
          expect(metadata, context).toMatch(/\btitle="[^"]+"/);
          continue;
        }
        excerpts++;
        expect(source ?? "", context).toMatch(
          /^[^#]+#L[1-9]\d*(?:-L[1-9]\d*)?$/,
        );
        const resolved = codeSource(source!, commit);
        expect(resolved.path, context).not.toMatch(
          /^(?:\/|[a-z]+:)|(?:^|\/)\.\.(?:\/|$)|[?#\\]/i,
        );
        expect(resolved.startLine, context).toBeGreaterThan(0);
        // Historical paths may have moved or disappeared from HEAD. Validate
        // their metadata here; authors verify content at the pinned revision.
      }
    }
    expect(excerpts).toBeGreaterThan(0);
  });
});
