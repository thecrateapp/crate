import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const readTokenFile = (name: string) =>
  readFileSync(resolve(process.cwd(), "tokens", name), "utf8");

describe("runtime token bridge", () => {
  it("keeps Tailwind foundation values behind runtime variables", () => {
    const colors = readTokenFile("colors.css");
    const radius = readTokenFile("radius.css");

    expect(colors).toContain(
      "--color-primary: var(--crate-token-color-primary)",
    );
    expect(colors).not.toMatch(/--color-primary:\s*#[0-9a-f]{6}/i);
    expect(radius).toContain("--radius-md: var(--crate-token-radius-md)");
    expect(radius).not.toContain("--radius-md: 0.25rem");
  });

  it("defines runtime values for solid and glass surface recipes", () => {
    const surfaces = readTokenFile("surfaces.css");

    expect(surfaces).toContain(
      "--color-card: var(--crate-token-surface-card-solid)",
    );
    expect(surfaces).toContain(
      "--color-card: var(--crate-token-surface-card-glass)",
    );
    expect(surfaces).toContain("--surface-app: var(--crate-token-surface-app)");
    expect(surfaces).toContain(
      "--scrollbar-thumb: var(--crate-token-scrollbar-thumb)",
    );
    expect(surfaces).toContain(
      "--scrollbar-hover: var(--crate-token-scrollbar-hover)",
    );
  });

  it("derives runtime defaults in the theme layer", () => {
    const themes = readTokenFile("themes.css");

    expect(themes).toContain("--crate-token-color-primary: #06b6d4");
    expect(themes).toContain("--crate-token-surface-card-solid: #16161e");
    expect(themes).toContain("--crate-token-surface-card-glass:");
    expect(themes).toContain("--crate-token-radius-md: 0.25rem");
    expect(themes).toContain("--crate-token-scrollbar-thumb: #252535");
    expect(themes).toContain("--crate-token-scrollbar-hover: #353545");
  });

  it("disables root view transitions when motion is reduced", () => {
    const animations = readTokenFile("animations.css");

    expect(animations).toContain(
      ':root[data-crate-motion="reduced"]::view-transition-old(root)',
    );
    expect(animations).toContain(
      ':root[data-crate-motion="reduced"]::view-transition-new(root)',
    );
  });
});
