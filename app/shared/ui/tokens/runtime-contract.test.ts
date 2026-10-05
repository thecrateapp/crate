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

  it("paints the fullscreen player on an opaque canvas underlay", () => {
    const recipes = readTokenFile("recipes.css");
    const surface = recipes.match(
      /\.fullscreen-player-surface\s*\{(?<rules>[^}]*)\}/s,
    )?.groups?.rules;

    expect(surface).toMatch(/background-color:\s*var\(--surface-canvas\)/);
    expect(surface).not.toMatch(/(?:^|\s)background:/);
  });

  it("keeps an inset focus indicator for links inside truncating containers", () => {
    const recipes = readTokenFile("recipes.css");
    const inset = recipes.match(
      /\.link-meta\.link-inset:focus-visible,\s*\.link-accent\.link-inset:focus-visible\s*\{(?<rules>[^}]*)\}/s,
    )?.groups?.rules;

    expect(inset).toMatch(/outline-offset:\s*-2px/);
    expect(inset).toMatch(/text-decoration:\s*underline/);
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

  it("defines distinct compact typography for badges and counters", () => {
    const typography = readTokenFile("typography.css");

    expect(typography).toContain("--text-badge: 0.625rem");
    expect(typography).toContain("--text-counter: 0.5rem");
    expect(typography).toContain("--text-counter--line-height: 1");
  });

  it("renders the focus token as a visible 2px ring on the focus colour", () => {
    const semantic = readTokenFile("semantic.css");

    expect(semantic).toMatch(
      /--focus-shadow:\s*0 0 0 2px var\(--focus-ring\);/,
    );
    expect(semantic).toContain("--shadow-focus: var(--focus-shadow);");
    expect(semantic).toContain("--focus-ring: var(--color-ring);");
  });
});

describe("z-index layers", () => {
  const zIndex = (name: string) => {
    const match = readTokenFile("z-index.css").match(
      new RegExp(`--z-${name}:\\s*(\\d+);`),
    );
    return Number(match?.[1]);
  };

  it("keeps player-anchored popovers above the raised player bar and below menus", () => {
    expect(zIndex("player-popover")).toBeGreaterThan(zIndex("player-overlay"));
    expect(zIndex("player-popover")).toBeLessThan(zIndex("dropdown"));
    expect(zIndex("player-popover")).toBeLessThan(zIndex("context-menu"));
    expect(zIndex("player-popover")).toBeLessThan(zIndex("modal"));
  });
});
