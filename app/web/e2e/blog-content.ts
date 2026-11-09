import { readdirSync, readFileSync } from "node:fs";

// Read the authored inventory so new chapters join the same browser checks.
const directory = new URL("../src/content/blog/", import.meta.url);
export const blogPosts = readdirSync(directory)
  .filter((name) => name.endsWith(".md"))
  .map((name) => {
    const markdown = readFileSync(new URL(name, directory), "utf8");
    const head = markdown.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
    const slug = name.replace(/\.md$/, "");
    return {
      slug,
      href: `/blog/${slug}`,
      title: head.match(/^title:\s*"(.+)"/m)?.[1] ?? "",
      date: head.match(/^date:\s*(\S+)/m)?.[1] ?? "",
      draft: /^draft:\s*true/m.test(head),
      part: Number(head.match(/^  part:\s*(\d+)/m)?.[1]) || null,
    };
  });
export const historicalChapters = blogPosts
  .filter((post) => post.part !== null)
  .sort((a, b) => a.part! - b.part!);
export const draftHrefs = blogPosts
  .filter((post) => post.draft)
  .map((post) => post.href);
