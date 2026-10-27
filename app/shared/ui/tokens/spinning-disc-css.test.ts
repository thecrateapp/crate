import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "tokens/recipes.css"), "utf8");

describe("spinning disc mix ring recipe", () => {
  it("follows the shared crossfade progress in and out", () => {
    expect(css).toMatch(
      /\.spinning-disc-mix-ring\[data-active\]\s*\{[^}]*opacity:\s*min\([^;]*var\(--listen-crossfade-progress, 0\) \* 4[^;]*\(1 - var\(--listen-crossfade-progress, 0\)\) \* 4/,
    );
    expect(css).toMatch(
      /\.spinning-disc-mix-ring\s*\{[^}]*opacity:\s*0;[^}]*transition:\s*opacity/,
    );
  });

  it("pulses the glow at the track beat", () => {
    expect(css).toMatch(
      /\.spinning-disc-mix-ring\[data-beat\]::after\s*\{[^}]*animation:\s*spinning-disc-mix-pulse var\(--mix-ring-beat\)/,
    );
  });

  it("only fades, without pulsing, when motion is reduced", () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.spinning-disc-mix-ring\[data-active\]\s*\{\s*opacity:\s*1;\s*\}\s*\.spinning-disc-mix-ring\[data-beat\]::after\s*\{\s*animation:\s*none;/,
    );
    expect(css).toMatch(
      /\[data-crate-motion="reduced"\] \.spinning-disc-mix-ring\[data-beat\]::after\s*\{\s*animation:\s*none;/,
    );
  });
});
