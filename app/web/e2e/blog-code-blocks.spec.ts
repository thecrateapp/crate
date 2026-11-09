import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

import { blogPosts } from "./blog-content";

const slugs = blogPosts.map((post) => post.slug);
const draftSlugs = new Set(
  blogPosts.filter((post) => post.draft).map((post) => post.slug),
);

// Expressive Code expands tabs to two spaces by default, including copied Go code.
const renderedExcerpt = (code: string) =>
  code.replace(/\n$/, "").replaceAll("\t", "  ");

for (const width of [1440, 390]) {
  for (const slug of slugs) {
    test(`${slug} keeps the source code presentation at ${width}px`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize({ width, height: 1100 });
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      const response = await page.goto(`/blog/${slug}`);
      test.skip(
        response?.status() === 404 && draftSlugs.has(slug),
        "Drafts only render in development.",
      );
      expect(response?.status()).toBe(200);

      const markdown = readFileSync(
        new URL(`../src/content/blog/${slug}.md`, import.meta.url),
        "utf8",
      );
      const excerpts = [
        ...markdown.matchAll(/^```\w+([^\n]*)\n([\s\S]*?)^```/gm),
      ];
      const blocks = page.locator(".expressive-code");
      await expect(blocks).toHaveCount(excerpts.length);

      for (const [index, [, metadata, code]] of excerpts.entries()) {
        const source = metadata!.match(/source="([^"]+)"/)?.[1];
        const block = blocks.nth(index);
        if (!source) {
          await expect(block.locator(".source-link")).toHaveCount(0);
          await expect(block.locator(".gutter .ln")).toHaveCount(0);
          await expect(block.locator(".copy button")).toHaveAttribute(
            "data-code",
            renderedExcerpt(code!).replaceAll("\n", "\x7f"),
          );
          continue;
        }
        const commit = metadata!.match(/commit="([^"]+)"/)![1]!;
        const [path, range] = source.split("#");
        const [, first, last] = range!.match(/^L(\d+)-L(\d+)$/)!;
        await expect(block.locator("figcaption .title")).toHaveText(path!);
        await expect(block.locator("figcaption .source-link")).toHaveAttribute(
          "href",
          `https://github.com/thecrateapp/crate/blob/${commit}/${source}`,
        );
        await expect(
          block.locator(
            'figcaption .source-link > svg[data-blog-icon="github"]',
          ),
        ).toHaveCount(1);
        const numbers = block.locator(".gutter .ln");
        await expect(numbers.first()).toHaveText(first!);
        await expect(numbers.last()).toHaveText(last!);
        await expect(numbers).toHaveCount(Number(last) - Number(first) + 1);
        await expect(block.locator(".copy button")).toHaveCount(1);
        // Highlighting and source gutters must not leak into the copied excerpt.
        await expect(block.locator(".copy button")).toHaveAttribute(
          "data-code",
          renderedExcerpt(code!).replaceAll("\n", "\x7f"),
        );
      }

      expect(await blocks.locator("mark").count()).toBeGreaterThan(0);
      const firstBlock = blocks.first();
      await firstBlock.scrollIntoViewIfNeeded();
      await firstBlock.locator(".copy button").click();
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toBe(renderedExcerpt(excerpts[0]![2]!));
      const bounds = await firstBlock.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
    });
  }
}
