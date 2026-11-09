// @vitest-environment node
import { describe, expect, it } from "vitest";
import { insertBlogVisuals } from "./blog-visuals";

describe("inline blog visuals", () => {
  it("places multiple registered figures in the order chosen by the article", () => {
    const html = '<div data-blog-visual="crossfade"></div><p>Between</p><div data-blog-visual="enrichment"></div>';
    expect(insertBlogVisuals(html, {
      enrichment: '<figure id="enrichment"></figure>',
      crossfade: '<figure id="crossfade"></figure>',
    })).toBe('<figure id="crossfade"></figure><p>Between</p><figure id="enrichment"></figure>');
  });

  it("keeps figures between the paragraphs that introduce and explain them", () => {
    expect(insertBlogVisuals(
      '<p>Before</p><div data-blog-visual="enrichment">\n</div><p>After</p>',
      { enrichment: '<figure data-example><p>A $& value</p></figure>' },
    )).toBe('<p>Before</p><figure data-example><p>A $& value</p></figure><p>After</p>');
  });

  it("leaves ordinary articles and escaped code examples untouched", () => {
    const html = '<p>Article</p><code>&lt;div data-blog-visual="enrichment"&gt;</code>';
    expect(insertBlogVisuals(html, {})).toBe(html);
  });

  it("fails a missing component rather than silently publishing an empty figure", () => {
    expect(() => insertBlogVisuals('<div data-blog-visual="unknown"></div>', {}))
      .toThrow('"unknown" has no rendered component');
    expect(() => insertBlogVisuals('<div data-blog-visual="enrichment"></div>', { enrichment: "" }))
      .toThrow('"enrichment" has no rendered component');
  });

  it("rejects duplicate figures and components with no place in the article", () => {
    const marker = '<div data-blog-visual="enrichment"></div>';
    expect(() => insertBlogVisuals(marker + marker, { enrichment: '<figure></figure>' }))
      .toThrow("appears more than once");
    expect(() => insertBlogVisuals('<p>No marker</p>', { enrichment: '<figure></figure>' }))
      .toThrow("has no Markdown marker");
  });
});
