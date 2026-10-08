import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const SOURCE_ROOT = resolve(process.cwd(), "src");
const SHARED_DOMAIN_ROOT = resolve(process.cwd(), "../shared/ui/domain");
const RECIPES_PATH = resolve(process.cwd(), "../shared/ui/tokens/recipes.css");
const IGNORED_DIRECTORIES = new Set(["dist", "node_modules"]);
const BADGE_COMPONENT_TAG = /<(CrateBadge|CratePill|CrateChip)(?=[\s>])/g;
const PLAIN_TAG = /<(span|div)(?=[\s>])/g;
const BADGE_COMPONENT_FORBIDDEN_CLASS =
  /\b(?:uppercase|tracking-[\w[\].-]+|text-accent-action|rounded-full)\b/;
const BADGE_RECIPE_SELECTOR = /\.([\w-]+-(?:badge|pill|chip))(?![\w-])/g;

const HAND_MADE_BADGE_ALLOWLIST: Record<string, string> = {};

const BADGE_RECIPE_ALLOWLIST: Record<string, string> = {
  "jam-chip": "Jam control buttons and queue reorder handles reuse it.",
  "jam-accent-chip": "Active state of Jam hero action buttons.",
  "jam-success-chip": "Synced state of the Jam resync button.",
  "jam-info-chip": "Jam queue mode option rows and their info panel.",
};

interface Offender {
  key: string;
  location: string;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      return IGNORED_DIRECTORIES.has(entry.name) ? [] : sourceFiles(path);
    }
    if (
      !entry.isFile() ||
      entry.name.includes(".test.") ||
      !entry.name.endsWith(".tsx")
    ) {
      return [];
    }
    return [path];
  });
}

function tagAttributes(source: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]!;
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (depth > 0 && (char === '"' || char === "'" || char === "`")) {
      quote = char;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
    } else if (char === ">" && depth === 0) {
      return source.slice(start, index);
    }
  }
  return source.slice(start);
}

function classLiterals(attributes: string): string {
  return [...attributes.matchAll(/["'`]([^"'`]*)["'`]/g)]
    .map(([, value]) => value)
    .join(" ");
}

function isHandMadeBadge(classes: string): boolean {
  return (
    /\brounded-full\b/.test(classes) &&
    /\bpx-/.test(classes) &&
    /\b(?:border|bg-[\w[\]/.-]+|[\w-]+-(?:badge|pill|chip))\b/.test(classes) &&
    /\b(?:uppercase|text-accent-action)\b/.test(classes) &&
    !/\b(?:size-|h-\d)/.test(classes)
  );
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function findBadgeOffenders(file: string, source: string): Offender[] {
  const offenders: Offender[] = [];

  for (const match of source.matchAll(BADGE_COMPONENT_TAG)) {
    const classes = classLiterals(tagAttributes(source, match.index));
    if (!BADGE_COMPONENT_FORBIDDEN_CLASS.test(classes)) continue;
    offenders.push({
      key: `${file}:${match[1]}`,
      location: `${file}:${lineOf(source, match.index)}`,
    });
  }

  for (const match of source.matchAll(PLAIN_TAG)) {
    const classes = classLiterals(tagAttributes(source, match.index));
    if (!isHandMadeBadge(classes)) continue;
    offenders.push({
      key: `${file}:hand-made`,
      location: `${file}:${lineOf(source, match.index)}`,
    });
  }

  return offenders;
}

function scan(root: string, prefix: string): Offender[] {
  return sourceFiles(root).flatMap((path) =>
    findBadgeOffenders(
      `${prefix}${relative(root, path)}`,
      readFileSync(path, "utf8"),
    ),
  );
}

function scanAll(): Offender[] {
  return [
    ...scan(SOURCE_ROOT, ""),
    ...scan(SHARED_DOMAIN_ROOT, "shared/domain/"),
  ];
}

function badgeRecipeSelectors(css: string): string[] {
  return [
    ...new Set(
      [...css.matchAll(BADGE_RECIPE_SELECTOR)].map(([, name]) => name!),
    ),
  ];
}

describe("badge policy", () => {
  it("detects hand-made and restyled badges", () => {
    const legacy = `
      <span className="rounded-full border border-accent-action/25 px-2 py-1 text-xs uppercase tracking-caps text-accent-action">
        {t("radar.release.preRelease")}
      </span>
      <div className="home-replay-badge inline-flex rounded-full px-3 py-1 text-xs uppercase">DNA</div>
      <CratePill tone="accent" className="px-3 uppercase tracking-eyebrow">Show</CratePill>
      <CrateBadge className="text-accent-action">Smart</CrateBadge>
    `;

    expect(
      findBadgeOffenders("fixture.tsx", legacy).map(({ key }) => key),
    ).toEqual([
      "fixture.tsx:CratePill",
      "fixture.tsx:CrateBadge",
      "fixture.tsx:hand-made",
      "fixture.tsx:hand-made",
    ]);
  });

  it("ignores CrateBadge, circular counters and plain pills", () => {
    const allowed = `
      <CrateBadge icon={Sparkles} className="mt-3">Crate DNA</CrateBadge>
      <span className="flex size-3.5 items-center justify-center rounded-full bg-accent-action px-1 text-counter uppercase" />
      <span className="rounded-full border px-3 py-1 text-xs text-text-muted">12</span>
      <CratePill active onClick={toggle}>Rock</CratePill>
    `;

    expect(findBadgeOffenders("fixture.tsx", allowed)).toEqual([]);
  });

  it("renders badges through CrateBadge instead of hand-made pills", () => {
    const offenders = scanAll().filter(
      ({ key }) => !HAND_MADE_BADGE_ALLOWLIST[key],
    );

    expect(offenders.map(({ location }) => location)).toEqual([]);
  }, 15_000);

  it("keeps badge styling in the shared crate-badge recipe", () => {
    const selectors = badgeRecipeSelectors(readFileSync(RECIPES_PATH, "utf8"));

    expect(
      selectors.filter(
        (name) =>
          name !== "crate-badge" &&
          name !== "genre-pill" &&
          !name.startsWith("quality-badge") &&
          !BADGE_RECIPE_ALLOWLIST[name],
      ),
    ).toEqual([]);
  });

  it("keeps the allowlists free of stale entries", () => {
    const keys = new Set(scanAll().map(({ key }) => key));
    const selectors = new Set(
      badgeRecipeSelectors(readFileSync(RECIPES_PATH, "utf8")),
    );

    expect([
      ...Object.keys(HAND_MADE_BADGE_ALLOWLIST).filter((key) => !keys.has(key)),
      ...Object.keys(BADGE_RECIPE_ALLOWLIST).filter(
        (name) => !selectors.has(name),
      ),
    ]).toEqual([]);
  }, 15_000);
});
