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

  it("uses the accent foreground for menu options on hover and focus", () => {
    const hoverRule = recipes.match(
      /\.crate-overlay-menu-item:not\(:disabled\):not\(\[data-disabled\]\):hover,[\s\S]*?\{[^{}]*\}/,
    )?.[0];

    expect(recipes).toMatch(
      /\.crate-overlay-menu-item:not\(:disabled\):not\(\[data-disabled\]\):hover,[\s\S]*?background:\s*var\(--hover-bg\);\s*color:\s*var\(--accent-action-hi\);/,
    );
    expect(hoverRule).not.toMatch(/border(?:-color)?\s*:/);
    expect(recipes).toMatch(
      /\.crate-overlay-menu-item:has\(\.crate-mono-label\)[\s\S]*?\.crate-mono-label\s*\{\s*color:\s*var\(--accent-action-hi\);/,
    );
    const monoMenuRules =
      recipes.match(
        /\.crate-overlay-menu-item:has\(\.crate-mono-label\)[\s\S]*?\{[^{}]*\}/g,
      ) ?? [];
    expect(monoMenuRules).toHaveLength(2);
    expect(monoMenuRules.join("\n")).not.toMatch(/background:\s*transparent/);
  });

  it("offers wide overlay sizes for dense dialogs", () => {
    expect(recipes).toMatch(
      /\.crate-overlay-panel\[data-overlay-size="2xl"\]\s*\{\s*max-width:\s*1024px;/,
    );
    expect(recipes).toMatch(
      /\.crate-overlay-panel\[data-overlay-size="3xl"\]\s*\{\s*max-width:\s*1280px;/,
    );
  });
});
