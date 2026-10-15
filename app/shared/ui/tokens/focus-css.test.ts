import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";

const interactive = () =>
  readFileSync(resolve(process.cwd(), "tokens/interactive.css"), "utf8");

describe("global keyboard focus CSS", () => {
  it("keeps the unlayered two-pixel Home search ring flush with each control", async () => {
    const compiler = await compile(interactive());
    const css = compiler.build([]);

    expect(css).toMatch(
      /(?:^|\n):focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus-ring\);[^}]*outline-offset:\s*0(?:px)?;/,
    );
    expect(css).not.toContain("@layer");
  });

  it("keeps clipped rows and menus inset without a separate CTA recipe", async () => {
    const compiler = await compile(interactive());
    const css = compiler.build([]);

    expect(css).not.toContain(".crate-focus-cta");
    expect(css).toMatch(
      /\.crate-focus-inset:focus-visible[^}]*\{[^}]*outline-offset:\s*-2px;/,
    );
    expect(css).toMatch(
      /\[data-slot=["']?hairline-row["']?\]\s*>\s*:focus-visible/,
    );
    expect(css).toMatch(/\.genre-pill\s*>\s*button:focus-visible/);
  });

  it("uses canvas text on the selected accent background", async () => {
    const compiler = await compile(interactive());
    const css = compiler.build([]);

    expect(css).toMatch(
      /::selection\s*\{[^}]*background(?:-color)?:\s*var\(--accent-action\);[^}]*color:\s*var\(--surface-canvas\);/,
    );
  });

  it("preserves a system-colored outline in forced colors without disabling browser adjustments", async () => {
    const compiler = await compile(interactive());
    const css = compiler.build([]);

    expect(css).toMatch(
      /@media\s*\(forced-colors:\s*active\)[\s\S]*:focus-visible\s*\{[^}]*outline-color:\s*Highlight;/,
    );
    expect(css).not.toContain("forced-color-adjust: none");
  });
});
