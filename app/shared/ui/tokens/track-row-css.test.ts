import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "tokens/recipes.css"), "utf8");

describe("track row metadata recipe", () => {
  const narrow = css.match(
    /@container crate-track \(max-width: 479px\)\s*\{([\s\S]*?)\n\}/,
  )?.[1];

  it("gives narrow rows the duration column back for the title", () => {
    expect(narrow).toBeDefined();
    expect(narrow).toMatch(
      /\.crate-track-metadata \.crate-track-duration\s*\{\s*display:\s*none;/,
    );
  });

  it("keeps both 44px controls touching without a gap", () => {
    expect(narrow).toMatch(
      /\.crate-track-metadata\s*\{\s*grid-template-columns:\s*44px 44px;\s*column-gap:\s*0;/,
    );
  });

  it("still shows duration from the default layout upwards", () => {
    expect(css).toMatch(
      /\.crate-track-metadata\s*\{[^}]*grid-template-columns:\s*3\.5rem 44px 44px;/,
    );
  });
});
