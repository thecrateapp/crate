import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const SOURCE_ROOT = resolve(process.cwd(), "src");
const FORBIDDEN_RADIUS = /\brounded-(?:2xl|3xl)\b/;

function productionSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return productionSourceFiles(path);
    if (
      !entry.isFile() ||
      entry.name.includes(".test.") ||
      !/\.(?:ts|tsx|css)$/.test(entry.name)
    ) {
      return [];
    }
    return [path];
  });
}

describe("Listen radius policy", () => {
  it("normalizes legacy text CTAs without changing icon-only controls", () => {
    const listenStyles = readFileSync(
      resolve(SOURCE_ROOT, "index.css"),
      "utf8",
    );

    expect(listenStyles).toMatch(
      /:is\(button,\s*a\)\.rounded-full\[class\*=["']px-["']\]\s*\{[^}]*border-radius:\s*var\(--radius-lg\)/s,
    );
  });

  it("sets the shared button primitive to Listen's compact control radius", () => {
    const listenStyles = readFileSync(
      resolve(SOURCE_ROOT, "index.css"),
      "utf8",
    );

    expect(listenStyles).toMatch(
      /\[data-slot=["']button["']\]\s*\{[^}]*border-radius:\s*var\(--radius-lg\)/s,
    );
  });

  it("keeps the mobile Equalizer glass translucent enough to read the player beneath", () => {
    const listenStyles = readFileSync(
      resolve(SOURCE_ROOT, "index.css"),
      "utf8",
    );
    const eqGlass = listenStyles.match(
      /\.listen-mobile-eq-glass\s*\{(?<rules>[^}]*)\}/s,
    )?.groups?.rules;

    expect(eqGlass).toBeDefined();

    const darkGradient = eqGlass!.match(/linear-gradient\([^;]+/s)?.[0] ?? "";
    const darkAlphas = Array.from(
      darkGradient.matchAll(/rgba\([^)]*,\s*([\d.]+)\)/g),
      ([, alpha]) => Number(alpha),
    );
    const brightness = Number(
      eqGlass!.match(/backdrop-filter:\s*[^;]*brightness\(([\d.]+)\)/)?.[1],
    );

    expect(Math.max(...darkAlphas)).toBeLessThan(0.84);
    expect(brightness).toBeGreaterThan(0.58);
  });

  it("keeps large legacy radius tokens out of production sources", () => {
    const violations = productionSourceFiles(SOURCE_ROOT).flatMap((path) => {
      const matches = readFileSync(path, "utf8").match(FORBIDDEN_RADIUS);
      return matches ? [relative(SOURCE_ROOT, path)] : [];
    });

    expect(violations).toEqual([]);
  });
});
