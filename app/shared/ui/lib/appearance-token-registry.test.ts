import { describe, expect, it } from "vitest";

import {
  CRATE_IDENTITY_VARIABLES,
  renderDefaultThemeCss,
} from "./appearance-token-registry";
import { contrastRatioComposited } from "./color-contrast";

describe("fixed Crate v3 token contract", () => {
  it("defines one identity with solid surfaces, fixed cyan, type roles and radii", () => {
    expect(CRATE_IDENTITY_VARIABLES).toMatchObject({
      "--crate-token-color-background": "#0a0a0f",
      "--crate-token-color-primary": "#06b6d4",
      "--crate-token-color-primary-hi": "#67e8f9",
      "--color-card": "#0d0e14",
      "--surface-object": "#0d0e14",
      "--surface-panel": "#0d0e14",
      "--surface-popover": "#111218",
      "--surface-raised": "#0f1016",
      "--color-input": "#111218",
      "--text-subtle": "#7e8084",
      "--text-muted": "#999ca0",
      "--font-brand": '"IBM Plex Sans"',
      "--radius-md": "0.25rem",
      "--state-danger-foreground": "#0a0a0f",
    });
    expect(CRATE_IDENTITY_VARIABLES["--font-display-stack"]).toContain(
      "Bricolage Grotesque",
    );
    expect(CRATE_IDENTITY_VARIABLES["--font-mono-stack"]).toContain(
      "JetBrains Mono",
    );
  });

  it.each([
    "--surface-app",
    "--surface-object",
    "--surface-panel",
    "--surface-raised",
    "--surface-popover",
    "--surface-modal",
  ] as const)(
    "keeps readable labels, accent and warnings AA on %s",
    (surface) => {
      const background = CRATE_IDENTITY_VARIABLES[surface];
      for (const name of [
        "--text-primary",
        "--text-secondary",
        "--text-muted",
        "--text-subtle",
        "--accent-action-hi",
        "--state-warning",
      ] as const) {
        expect(
          contrastRatioComposited(CRATE_IDENTITY_VARIABLES[name], background),
          name,
        ).toBeGreaterThanOrEqual(4.5);
      }
      expect(
        contrastRatioComposited(
          CRATE_IDENTITY_VARIABLES["--focus-ring"],
          background,
        ),
      ).toBeGreaterThanOrEqual(3);
    },
  );

  it("keeps accent and destructive control foregrounds AA", () => {
    for (const [foreground, background] of [
      ["--accent-action-foreground", "--accent-action"],
      ["--accent-action-hi-foreground", "--accent-action-hi"],
      ["--state-danger-foreground", "--state-danger"],
    ] as const) {
      expect(
        contrastRatioComposited(
          CRATE_IDENTITY_VARIABLES[foreground],
          CRATE_IDENTITY_VARIABLES[background],
        ),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("renders deterministic CSS without selectable visual variants", () => {
    const css = renderDefaultThemeCss();
    expect(renderDefaultThemeCss()).toBe(css);
    expect(css).not.toMatch(
      /data-crate-(?:mode|skin|surface-tone)|data-surface|crateRed|prefers-color-scheme|glass\]/,
    );
    expect(
      Object.keys(CRATE_IDENTITY_VARIABLES).some((key) =>
        key.endsWith("-glass"),
      ),
    ).toBe(false);
    for (const [name, value] of Object.entries(CRATE_IDENTITY_VARIABLES))
      expect(css).toContain(`${name}: ${value};`);
  });

  it("retains functional effects strengths without changing palette, fonts or radii", () => {
    const css = renderDefaultThemeCss();
    const off = css.match(/\[data-crate-effects="off"\]\s*\{([^}]+)\}/)?.[1];
    const expressive = css.match(
      /\[data-crate-effects="expressive"\]\s*\{([^}]+)\}/,
    )?.[1];
    expect(off).toContain(
      "--accent-action-glow: color-mix(in srgb, var(--accent-action) 0%, transparent)",
    );
    expect(expressive).toContain(
      "--accent-action-glow: color-mix(in srgb, var(--accent-action) 42%, transparent)",
    );
    for (const rules of [off, expressive])
      expect(rules).not.toMatch(/--(?:color-|font-|radius-|surface-)/);
  });
});
