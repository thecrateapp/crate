import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { transform } from "lightningcss";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";

const tokenFile = (name: string) =>
  readFileSync(resolve(process.cwd(), "tokens", name), "utf8");

describe("primitive typography CSS", () => {
  it.each([
    ["sm", "1.1rem", "clamp(1.1rem, 2.1cqi, 1.9rem)"],
    ["md", "1.6rem", "clamp(1.6rem, 2.6cqi, 2.4rem)"],
    ["lg", "2.8rem", "clamp(2.8rem, 5.6cqi, 5.4rem)"],
    ["xl", "3.2rem", "clamp(3.2rem, 8.4cqi, 8.4rem)"],
  ])(
    "preserves a rem fallback for the %s numeral tier",
    async (size, fallback, fluid) => {
      const compiler = await compile(
        `${tokenFile("typography.css")}\n@tailwind utilities;`,
      );
      const css = compiler.build([`text-numeral-${size}`]);
      const minified = transform({
        filename: "typography.css",
        code: Buffer.from(css),
        minify: true,
      }).code.toString();
      expect(minified).toContain(`font-size:${fallback}`);
      expect(minified).toMatch(/@supports\s+not\s*\(font-size:\s*1cqi\)/);
      const declarations = [
        ...css.matchAll(
          new RegExp(`\\.text-numeral-${size}\\s*\\{([^}]+)\\}`, "g"),
        ),
      ].flatMap(([, body]) =>
        [...body.matchAll(/(?:^|[;{])\s*font-size:\s*([^;{}]+);/g)].map(
          ([, value]) => value,
        ),
      );

      expect(declarations[0]).toBe(fallback);
      expect(declarations).toContain(fluid);
      expect(declarations.some((value) => value.includes("var("))).toBe(false);
      const legacyDeclarations = declarations.filter(
        (value) => !value.includes("cqi"),
      );
      expect(legacyDeclarations[legacyDeclarations.length - 1]).toBe(fallback);
    },
  );

  it("emits the eyebrow size and line height as a Tailwind utility", async () => {
    const compiler = await compile(
      `${tokenFile("typography.css")}\n@tailwind utilities;`,
    );
    const css = compiler.build(["text-eyebrow"]);

    expect(css).toContain("font-size: 0.71875rem;");
    expect(css).toMatch(/line-height:\s*(?:var\(--tw-leading,\s*)?1\.4/);
  });
});

describe("status dot forced colors", () => {
  it("preserves the dot outline and distinct system-color fills", async () => {
    const compiler = await compile(tokenFile("interactive.css"));
    const css = compiler.build([]);

    expect(css).toMatch(/@media\s*\(forced-colors:\s*active\)/);
    expect(css).toMatch(
      /\.crate-status-dot\s*\{[^}]*border:\s*1px solid CanvasText;/,
    );
    for (const [tone, fill] of [
      ["on", "Highlight"],
      ["warn", "CanvasText"],
      ["off", "transparent"],
    ]) {
      expect(css).toMatch(
        new RegExp(
          `\\[data-tone=["']?${tone}["']?\\]\\s*>\\s*\\.crate-status-dot\\s*\\{[^}]*background-color:\\s*${fill};`,
        ),
      );
    }
  });
});

describe("row and chip motion CSS", () => {
  it("transitions the chip scale longhand with a spring and a compatible fallback", async () => {
    const compiler = await compile(tokenFile("interactive.css"));
    const css = compiler.build([]);

    expect(css).toMatch(/\.crate-pill\s*\{[^}]*transition-property:[^;]*scale/);
    expect(css).toMatch(
      /\.crate-pill(?::where\()?:active:not\(:disabled\)\)?\s*\{[^}]*scale:\s*0?\.95;/,
    );
    expect(css).toMatch(
      /\.crate-pill\s*\{[^}]*transition-timing-function:\s*var\(--ease-snap\)/,
    );
    expect(css).toMatch(
      /@supports\s*\(transition-timing-function:\s*linear\(0,\s*1\)\)/,
    );
    expect(css).toContain(
      "transition-timing-function: var(--ease-spring-snappy)",
    );
  });

  it("disables chip and row motion for both system and Crate reduced motion", async () => {
    const compiler = await compile(tokenFile("interactive.css"));
    const css = compiler.build([]);

    expect(css).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.crate-pill\s*\{[^}]*scale:\s*1;[^}]*transition:\s*none;/,
    );
    expect(css).toMatch(
      /\[data-crate-motion=["']?reduced["']?\]\s+\.crate-pill\s*\{[^}]*scale:\s*1;[^}]*transition:\s*none;/,
    );
    expect(css).toMatch(
      /\[data-crate-motion=["']?reduced["']?\]\s+\.crate-hairline-active-bar\s*\{[^}]*transition:\s*none;/,
    );
  });
});
