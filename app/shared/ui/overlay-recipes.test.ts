import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const recipes = readFileSync(
  resolve(process.cwd(), "tokens/recipes.css"),
  "utf8",
);
const overlayBlocks =
  recipes.match(/[^{}]*\.crate-overlay-[^{}]*\{[^{}]*\}/g) ?? [];

describe("shared overlay recipes", () => {
  it("exposes the same overlay recipe contract to both applications", () => {
    for (const recipe of [
      "scrim",
      "panel",
      "title",
      "footer",
      "surface",
      "menu-item",
      "menu-label",
      "tooltip",
      "grabber",
    ]) {
      expect(recipes).toMatch(
        new RegExp(`\\.crate-overlay-${recipe}(?![\\w-])`),
      );
    }
  });

  it("uses the shared scrim token and keeps every overlay surface free of blur", () => {
    const scrim = overlayBlocks.find((block) =>
      block.includes(".crate-overlay-scrim"),
    );

    expect(scrim).toMatch(/background(?:-color)?:\s*var\(--surface-scrim\)/);
    expect(overlayBlocks.length).toBeGreaterThan(0);
    expect(overlayBlocks.join("\n")).not.toMatch(
      /(?:backdrop-)?filter:\s*[^;}]*blur\(/,
    );
  });
});
