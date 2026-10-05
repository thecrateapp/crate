import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const SOURCE_ROOT = resolve(process.cwd(), "src");
const SHARED_DOMAIN_ROOT = resolve(process.cwd(), "../shared/ui/domain");
const IGNORED_DIRECTORIES = new Set(["dist", "node_modules"]);
const GENRE_MAP_CALL =
  /([A-Za-z_$][\w$]*(?:\??\.[\w$]+(?:\([^()]*\))?)*)\??\.map\(\s*\(?\s*([\w$]+)/g;
const CHIP_TAG = /<(span|button|a|Link)(?=[\s>])/g;
const GENRE = /genre/i;

const HAND_MADE_GENRE_CHIP_ALLOWLIST: Record<string, string> = {
  "shared/domain/shows/ShowCard.tsx:map":
    "Low-emphasis show listing tags inside the shared upcoming show card; not a genre profile badge.",
  "shared/domain/shows/ShowCard.tsx:child":
    "Same show listing tag as above, matched by its rendered child.",
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

function balancedCall(source: string, openIndex: number): string {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex, index);
    }
  }
  return source.slice(openIndex);
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

function hasChipClasses(attributes: string): boolean {
  const classes = [...attributes.matchAll(/["'`]([^"'`]*)["'`]/g)]
    .map(([, value]) => value)
    .join(" ");
  return (
    /\brounded-(?:full|md|sm|lg|xl)\b/.test(classes) &&
    /\bborder\b/.test(classes) &&
    /\bpx-/.test(classes)
  );
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function findHandMadeGenreChips(file: string, source: string): Offender[] {
  const offenders: Offender[] = [];

  for (const match of source.matchAll(GENRE_MAP_CALL)) {
    const [, receiver, param] = match;
    if (!GENRE.test(receiver!) && !GENRE.test(param!)) continue;
    const openIndex = match.index + match[0].indexOf(".map(") + 4;
    const callback = balancedCall(source, openIndex);
    if (callback.includes("GenrePill")) continue;
    const tag = /<(span|button|a|Link)(?=[\s>])/.exec(callback);
    if (!tag || !hasChipClasses(tagAttributes(callback, tag.index))) continue;
    offenders.push({
      key: `${file}:map`,
      location: `${file}:${lineOf(source, match.index)}`,
    });
  }

  for (const match of source.matchAll(CHIP_TAG)) {
    const attributes = tagAttributes(source, match.index);
    const afterTag = source.slice(match.index + attributes.length + 1);
    const child = /^\s*\{([^}]*)\}/.exec(afterTag);
    if (!child || !GENRE.test(child[1]!) || !hasChipClasses(attributes)) {
      continue;
    }
    offenders.push({
      key: `${file}:child`,
      location: `${file}:${lineOf(source, match.index)}`,
    });
  }

  return offenders;
}

function scan(root: string, prefix: string): Offender[] {
  return sourceFiles(root).flatMap((path) =>
    findHandMadeGenreChips(
      `${prefix}${relative(root, path)}`,
      readFileSync(path, "utf8"),
    ),
  );
}

describe("genre pill policy", () => {
  it("detects hand-made genre chips", () => {
    const legacy = `
      {genreLabels.map((genre) => (
        <span key={genre} className="rounded-full border border-accent-action/20 px-3 py-1">
          {genre}
        </span>
      ))}
      <button type="button" className="rounded-md border px-2">{item.genre}</button>
    `;

    expect(
      findHandMadeGenreChips("fixture.tsx", legacy).map(({ key }) => key),
    ).toEqual(["fixture.tsx:map", "fixture.tsx:child", "fixture.tsx:child"]);
  });

  it("ignores genre lists rendered through GenrePill or non-chip markup", () => {
    const allowed = `
      {genres.map((genre) => <GenrePill key={genre.name} item={genre} />)}
      {genres.map((genre) => <GenreTile key={genre.slug} genre={genre} />)}
      <span className="hidden sm:inline">{genre}</span>
    `;

    expect(findHandMadeGenreChips("fixture.tsx", allowed)).toEqual([]);
  });

  it("renders genre badges through GenrePill instead of hand-made chips", () => {
    const offenders = [
      ...scan(SOURCE_ROOT, ""),
      ...scan(SHARED_DOMAIN_ROOT, "shared/domain/"),
    ].filter(({ key }) => !HAND_MADE_GENRE_CHIP_ALLOWLIST[key]);

    expect(offenders.map(({ location }) => location)).toEqual([]);
  }, 15_000);

  it("keeps the allowlist free of stale entries", () => {
    const keys = new Set(
      [
        ...scan(SOURCE_ROOT, ""),
        ...scan(SHARED_DOMAIN_ROOT, "shared/domain/"),
      ].map(({ key }) => key),
    );

    expect(
      Object.keys(HAND_MADE_GENRE_CHIP_ALLOWLIST).filter(
        (key) => !keys.has(key),
      ),
    ).toEqual([]);
  }, 15_000);
});
