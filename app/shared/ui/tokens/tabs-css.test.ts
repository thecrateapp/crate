import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "tokens/recipes.css"), "utf8");

describe("text panel tabs recipe", () => {
  it("scrolls overflowing tabs without drawing a scrollbar", () => {
    expect(css).toMatch(/\.crate-tabs-list\s*\{[^}]*scrollbar-width:\s*none;/);
    expect(css).toMatch(
      /\.crate-tabs-list::-webkit-scrollbar\s*\{[^}]*display:\s*none;/,
    );
  });

  it("tightens the tab gap on phone widths so four tabs fit", () => {
    expect(css).toMatch(
      /@media\s*\(max-width:\s*480px\)\s*\{\s*\.crate-tabs-list\s*\{[^}]*gap:\s*16px;/,
    );
  });
});
