import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = resolve(process.cwd(), "src");
const omittedFiles = new Set([
  "pages/Upcoming.tsx",
  "pages/NewReleases.tsx",
]);

function sourceFiles(directory: string, prefix = ""): string[] {
  return readdirSync(directory).flatMap((name) => {
    const absolute = resolve(directory, name);
    const relative = prefix ? `${prefix}/${name}` : name;
    if (statSync(absolute).isDirectory()) return sourceFiles(absolute, relative);
    return name.endsWith(".tsx") && !name.endsWith(".test.tsx") ? [relative] : [];
  });
}

describe("Admin typography roles", () => {
  it("maps the explicit sans utility to Roboto and loads all three approved faces", () => {
    const css = readFileSync(resolve(sourceRoot, "index.css"), "utf8");
    expect(css).toContain('@import "../../shared/fonts/bricolage-grotesque.css";');
    expect(css).toContain('@import "../../shared/fonts/roboto.css";');
    expect(css).toContain('@import "../../shared/fonts/jetbrains-mono.css";');
    expect(css).toMatch(/--font-sans:\s*var\(--font-brand\)/);
  });

  it("uses display for semantic headings and mono for uppercase labels and numeric readouts", () => {
    const violations: string[] = [];
    const headingPattern = /<(h[1-6]|CardTitle|DialogTitle)\b([^>]*)>/gs;
    const classPattern =
      /\bclassName\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\}|\{([^{}]*)\})/gs;

    for (const file of sourceFiles(sourceRoot)) {
      if (omittedFiles.has(file)) continue;
      const source = readFileSync(resolve(sourceRoot, file), "utf8");

      for (const match of source.matchAll(headingPattern)) {
        const attributes = match[2] ?? "";
        if (!/\bfont-(?:display|mono)\b/.test(attributes)) {
          const line = source.slice(0, match.index).split("\n").length;
          violations.push(`${file}:${line} heading has no assigned font role`);
        }
      }

      for (const match of source.matchAll(classPattern)) {
        const classes = match.slice(1).filter(Boolean).join(" ");
        const line = source.slice(0, match.index).split("\n").length;
        if (/\buppercase\b/.test(classes) && !/\bfont-mono\b/.test(classes)) {
          violations.push(`${file}:${line} uppercase label is not mono`);
        }
        if (/\bfont-display\b/.test(classes) && /\btabular-nums\b/.test(classes)) {
          violations.push(`${file}:${line} numeric readout uses display`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
