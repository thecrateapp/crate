// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const posts = new URL("../content/blog/", import.meta.url);
const publicDirectory = new URL("../../public/", import.meta.url);
const styles = new URL("../styles/", import.meta.url);
const tokens = readFileSync(new URL("tokens.css", styles), "utf8");
const pageBackground = tokens.match(/--bg:\s*(#[0-9a-f]+);/i)![1];
const assets = new Set<string>();

for (const name of readdirSync(posts).filter((name) => name.endsWith(".md"))) {
  const markdown = readFileSync(new URL(name, posts), "utf8");
  for (const [, asset] of markdown.matchAll(
    /!\[[^\]]*\]\((\/blog\/[^)]+\.svg)\)/g,
  ))
    assets.add(asset!);
}

describe("blog diagram canvas", () => {
  it.each([...assets])(
    "%s uses the page surface without a second rounded frame",
    (asset) => {
      const source = readFileSync(
        new URL(asset.slice(1), publicDirectory),
        "utf8",
      );
      const [, width, height] = source.match(/viewBox="0 0 (\d+) (\d+)"/)!;
      const canvas = source.match(/<rect\b[^>]*>/)![0];
      const attributes = Object.fromEntries(
        [...canvas.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, name, value]) => [
          name,
          value,
        ]),
      );
      expect(attributes.width).toBe(width);
      expect(attributes.height).toBe(height);

      // SVGs are external images: they cannot inherit the page's CSS variables.
      const fill =
        attributes.fill ??
        source.match(/\.bg\s*\{[^}]*\bfill:\s*(#[0-9a-f]+)/i)?.[1];
      expect(fill).toBe(pageBackground);

      // The article's image style owns its border and radius. Rounding the
      // embedded canvas again exposes a second silhouette inside that frame.
      expect(attributes).not.toHaveProperty("rx");
      expect(attributes).not.toHaveProperty("ry");
      expect(attributes).not.toHaveProperty("stroke");
    },
  );
});
