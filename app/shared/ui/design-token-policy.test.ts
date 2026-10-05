import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SOURCE_ROOT = dirname(fileURLToPath(import.meta.url));
const ARBITRARY_VALUE =
  /(?<![\w[-])(?:rounded(?:-[a-z]+)?-\[[^\]\s]+\]|z-\[[^\]\s]+\]|shadow-\[[^\]\s]+\]|text-\[\d*\.?\d+(?:px|rem)\]|tracking-\[[^\]\s]+\])/g;
const IGNORED_DIRECTORIES = new Set(["dist", "node_modules"]);
const LOCAL_STACKING = /^z-\[[1-9]\]$/;
const INHERITED_RADIUS = "rounded-[inherit]";
const ORGANIC_BLOB_RADIUS = "rounded-[45%_55%_49%_51%/53%_47%_56%_44%]";
const ICON_IMPORT =
  /import\s*\{([^}]*)\}\s*from\s*["'](?:@crate\/ui\/icons|(?:\.\.?\/)+icons)(?:\/[^"']+)?["']/g;
const DYNAMIC_ICON = /^(?:[A-Z]\w*)?Icon$/;

const ARBITRARY_VALUE_BUDGET: Record<string, Record<string, number>> = {
  "domain/ArtistHeroPresentation.tsx": {
    "text-[52px]": 1,
    "text-[56px]": 1,
    "tracking-[0.3em]": 1,
  },
  "domain/brand/CrateLoader.tsx": {
    [ORGANIC_BLOB_RADIUS]: 1,
    "tracking-[0.055em]": 1,
  },
  "domain/shows/ShowCard.tsx": { "text-[20px]": 1 },
};

const ICON_SIZE_BUDGET: Record<string, Record<string, number>> = {
  "composites/AdminSelect.tsx": { "13": 1 },
  "domain/shows/ShowCard.tsx": { "10": 1, "11": 1, "13": 2 },
  "domain/stats/OpsPageHero.tsx": { "22": 1 },
  "primitives/CrateBadge.tsx": { "10": 1, "11": 2 },
  "primitives/ErrorState.tsx": { "32": 1 },
};

function productionSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      return IGNORED_DIRECTORIES.has(entry.name)
        ? []
        : productionSourceFiles(path);
    }
    if (
      !entry.isFile() ||
      entry.name.includes(".test.") ||
      !/\.(?:ts|tsx)$/.test(entry.name)
    ) {
      return [];
    }
    return [path];
  });
}

function tally(
  findings: Array<[file: string, key: string]>,
): Record<string, Record<string, number>> {
  const result: Record<string, Record<string, number>> = {};
  for (const [file, key] of findings) {
    const counts = (result[file] ??= {});
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return result;
}

function iconNames(source: string): string[] {
  return Array.from(source.matchAll(ICON_IMPORT)).flatMap((match) =>
    (match[1] ?? "")
      .split(",")
      .map(
        (name) =>
          name
            .trim()
            .split(/\s+as\s+/)
            .pop()
            ?.trim() ?? "",
      )
      .filter((name) => /^[A-Z]/.test(name) && name !== "CRATE_ICON_SIZE"),
  );
}

function literalSizeAttribute(source: string, start: number): string | null {
  let depth = 0;
  let quote: string | null = null;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]!;
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'" || (depth > 0 && char === "`")) {
      quote = char;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
    } else if (depth === 0 && char === ">") {
      return null;
    } else if (depth === 0 && /\s/.test(char)) {
      const size = /^size=\{(\d+)\}/.exec(source.slice(index + 1, index + 16));
      if (size) return size[1]!;
    }
  }
  return null;
}

function literalIconSizes(source: string): string[] {
  const names = new Set(iconNames(source));
  return Array.from(source.matchAll(/<([A-Z]\w*)\b/g)).flatMap((match) => {
    const name = match[1]!;
    if (!names.has(name) && !DYNAMIC_ICON.test(name)) return [];
    const size = literalSizeAttribute(source, match.index + match[0].length);
    return size ? [size] : [];
  });
}

describe("@crate/ui design token policy", () => {
  it("reads literal icon sizes past arrow functions and nested JSX props", () => {
    const source = [
      'import { Heart, Star } from "@crate/ui/icons";',
      '<Heart onClick={() => x()} className="[&>svg]:block" size={13} />',
      "<Star icon={<Heart size={9} />} size={CRATE_ICON_SIZE.sm} />",
    ].join("\n");

    expect(literalIconSizes(source)).toEqual(["13", "9"]);
  });

  it("keeps arbitrary radius, z-index, shadow, type size and tracking values within the budget", () => {
    const findings = productionSourceFiles(SOURCE_ROOT).flatMap((path) => {
      const file = relative(SOURCE_ROOT, path);
      return Array.from(
        readFileSync(path, "utf8").matchAll(ARBITRARY_VALUE),
        ([utility]) => utility,
      )
        .filter(
          (utility) =>
            !LOCAL_STACKING.test(utility) && utility !== INHERITED_RADIUS,
        )
        .map((utility): [string, string] => [file, utility]);
    });

    expect(tally(findings)).toEqual(ARBITRARY_VALUE_BUDGET);
  }, 15_000);

  it("sizes icons from CRATE_ICON_SIZE outside the artwork and display budget", () => {
    const findings = productionSourceFiles(SOURCE_ROOT).flatMap((path) => {
      const file = relative(SOURCE_ROOT, path);
      return literalIconSizes(readFileSync(path, "utf8")).map(
        (size): [string, string] => [file, size],
      );
    });

    expect(tally(findings)).toEqual(ICON_SIZE_BUDGET);
  }, 15_000);
});
