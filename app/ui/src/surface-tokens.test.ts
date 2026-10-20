import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";

const SRC = resolve(process.cwd(), "src");
const TOKENS = resolve(process.cwd(), "../shared/ui/tokens");
const indexCss = readFileSync(resolve(SRC, "index.css"), "utf8");
const surfacesCss = readFileSync(resolve(TOKENS, "surfaces.css"), "utf8");
const sharedThemeCss = readdirSync(TOKENS)
  .filter((name) => name.endsWith(".css"))
  .flatMap((name) => [
    ...readFileSync(resolve(TOKENS, name), "utf8").matchAll(
      /@theme[^{]*\{([^}]*)\}/g,
    ),
  ])
  .map((match) => match[1])
  .join("\n");

// Colors surfaces.css sets per [data-surface] that the shared tokens do not
// register with Tailwind (card, border, ...). The admin registers the ones it
// uses in src/index.css so that classes such as bg-card generate CSS. They
// are read from the CSS, not listed here, so Tailwind does not pick up
// utility-like names from this file.
const SURFACE_TOKENS = [
  ...new Set(
    [...surfacesCss.matchAll(/--color-([\w-]+):/g)].map((match) => match[1]!),
  ),
]
  .filter((name) => !sharedThemeCss.includes(`--color-${name}:`))
  .sort((a, b) => b.length - a.length);
// Color utilities that take a surface token. `shadow-` is left out on
// purpose: shadow-card and shadow-popover are box-shadow theme tokens.
const PREFIXES =
  "bg|text|border(?:-[trblxyse])?|ring-offset|ring|outline|fill|stroke|divide|from|via|to|placeholder|decoration|caret|accent";
const UTILITY = new RegExp(
  `(?<![\\w-])(?:${PREFIXES})-(${SURFACE_TOKENS.join("|")})(?:\\/[\\w.%]+)?(?![\\w-])`,
  "g",
);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    const scanned = /\.(tsx?|css)$/.test(entry.name);
    return scanned && !path.endsWith("surface-tokens.test.ts") ? [path] : [];
  });
}

/** Surface-token utilities in the admin source, e.g. "bg-card/70" → "card". */
const used = new Map<string, string>(
  sourceFiles(SRC).flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(UTILITY)].map(
      (match) => [match[0], match[1]!] as const,
    ),
  ),
);

const themeBlock = indexCss.match(/@theme\s+reference\s*\{([^}]*)\}/)?.[1];
const registered = new Map(
  [...(themeBlock ?? "").matchAll(/--color-([\w-]+):\s*([^;]+);/g)].map(
    (match) => [match[1]!, match[2]!.trim()] as const,
  ),
);

describe("admin surface color tokens", () => {
  it("reads the unregistered surface colors from surfaces.css", () => {
    expect(SURFACE_TOKENS).toContain("card");
    expect(SURFACE_TOKENS).toContain("border");
    expect(SURFACE_TOKENS.length).toBeGreaterThanOrEqual(6);
  });

  it("finds the surface utilities the admin uses", () => {
    expect(used.get("bg-card")).toBe("card");
    expect(used.get("border-border")).toBe("border");
  });

  it("registers exactly the surface tokens the admin source uses", () => {
    expect(themeBlock).toBeDefined();
    expect([...registered.keys()].sort()).toEqual(
      [...new Set(used.values())].sort(),
    );
  });

  it("falls back to the glass value of each token", () => {
    for (const [name, value] of registered) {
      expect(value).toBe(`var(--crate-token-surface-${name}-glass)`);
    }
  });

  it("keeps a runtime value for each registered token on both surfaces", () => {
    for (const name of registered.keys()) {
      expect(surfacesCss).toContain(
        `--color-${name}: var(--crate-token-surface-${name}-solid)`,
      );
      expect(surfacesCss).toContain(
        `--color-${name}: var(--crate-token-surface-${name}-glass)`,
      );
    }
  });

  it("generates utilities that read the runtime variable", async () => {
    const compiler = await compile(
      `@theme reference {${themeBlock}}\n@tailwind utilities;`,
    );
    const css = compiler.build([...used.keys()]);

    for (const [utility, token] of used) {
      const selector = `.${utility.replace("/", "\\/")} {`;
      const start = css.indexOf(selector);
      expect(start, utility).toBeGreaterThanOrEqual(0);
      const rule = css.slice(start, css.indexOf("\n}", start));
      expect(rule, utility).toContain(`var(--color-${token},`);
    }
    // `reference` neither inlines the value nor emits a :root declaration
    // that could compete with surfaces.css: [data-surface] alone decides.
    expect(css).not.toMatch(/--color-[\w-]+\s*:/);
    expect(css).not.toMatch(/:\s*var\(--crate-token-surface/);
  });
});
