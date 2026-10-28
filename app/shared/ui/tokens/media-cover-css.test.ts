import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "tokens/recipes.css"), "utf8");

describe("media cover recipe", () => {
  it("waits for artwork on the neutral placeholder surface, not the accent", () => {
    const rules = [...css.matchAll(/\.crate-media-cover\s*\{([^}]*)\}/g)].map(
      (match) => match[1],
    );
    const background = rules.find((rule) => /background:/.test(rule ?? ""));

    expect(background).toMatch(/background:\s*var\(--surface-placeholder\);/);
    expect(background).not.toMatch(/accent/);
  });
});
