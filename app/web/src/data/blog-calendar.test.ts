// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readingWords } from "../lib/blog";
import { calendar } from "./blog-calendar";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const postsDir = fileURLToPath(new URL("../content/blog/", import.meta.url));
const MAX_WORDS = 1400;

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

  it("publishes on Tuesdays, never going back in time", () => {
    let previous = "";
    for (const entry of calendar) {
      const day = new Date(`${entry.publishOn}T00:00:00Z`).getUTCDay();
      expect(day, entry.slug).toBe(2);
      expect(entry.publishOn >= previous, entry.slug).toBe(true);
      previous = entry.publishOn;
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

  it("points code blocks at files that exist", () => {
    for (const file of posts) {
      const text = readFileSync(`${postsDir}${file}`, "utf8");
      for (const [, source] of text.matchAll(/^```\S*.*\bsource="([^"#]+)/gm)) {
        expect(existsSync(`${repoRoot}${source}`), `${file}: ${source}`).toBe(
          true,
        );
      }
    }
  });

  it("keeps posts short", () => {
    for (const file of posts) {
      expect(readingWords(frontmatter(file).body), file).toBeLessThanOrEqual(
        MAX_WORDS,
      );
    }
  });
});
