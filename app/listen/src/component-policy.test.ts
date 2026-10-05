import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const SOURCE_ROOT = resolve(process.cwd(), "src");
const SHARED_UI_ROOT = resolve(process.cwd(), "../shared/ui");
const IGNORED_DIRECTORIES = new Set(["dist", "node_modules"]);
const RAW_CONTROL_TAG = /<(button|input|textarea)(?=[\s/>])/g;
const COMPONENT_DECLARATION =
  /export\s+(?:default\s+)?(?:async\s+)?(?:function\s*\*?|const|let|class)\s+([A-Z]\w*|use[A-Z]\w*)\b/g;
const NAMED_EXPORT_LIST = /export\s*\{([^}]*)\}/g;

const RAW_CONTROL_BUDGET = { button: 111, input: 10, textarea: 1 };

const LOCAL_COPY_ALLOWLIST: Record<string, string> = {
  "components/actions/ItemActionMenu.tsx:ItemActionMenu":
    "Listen wrapper over the shared ContextMenu with a translated sheet label.",
  "components/player/extended/InfoTabPrimitives.tsx:StarRating":
    "Read-only rating display; the shared StarRating is an interactive button group.",
  "components/upcoming/ShowCard.tsx:ShowCard":
    "Listen upcoming card with attendance and expansion, unrelated to the shared admin show card.",
};

function sourceFiles(directory: string, extensions: RegExp): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      return IGNORED_DIRECTORIES.has(entry.name)
        ? []
        : sourceFiles(path, extensions);
    }
    if (
      !entry.isFile() ||
      entry.name.includes(".test.") ||
      !extensions.test(entry.name)
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

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function sharedComponentNames(): Set<string> {
  const names = new Set<string>();
  for (const path of sourceFiles(SHARED_UI_ROOT, /\.(?:ts|tsx)$/)) {
    if (relative(SHARED_UI_ROOT, path).startsWith("icons/")) continue;
    const source = readFileSync(path, "utf8");
    for (const [, name] of source.matchAll(COMPONENT_DECLARATION)) {
      names.add(name!);
    }
    for (const [, list] of source.matchAll(NAMED_EXPORT_LIST)) {
      for (const specifier of list!.split(",")) {
        const name =
          specifier
            .trim()
            .split(/\s+as\s+/)
            .pop()
            ?.trim() ?? "";
        if (
          !specifier.trim().startsWith("type ") &&
          /^(?:[A-Z]|use[A-Z])/.test(name)
        ) {
          names.add(name);
        }
      }
    }
  }
  return names;
}

function wrapsSharedExport(source: string, name: string): boolean {
  return new RegExp(
    `import\\s*\\{[^}]*\\b${name}\\s+as\\s+\\w+[^}]*\\}\\s*from\\s*["']@crate/ui/`,
  ).test(source);
}

describe("Listen component policy", () => {
  it("keeps raw button, input and textarea elements within the budget", () => {
    const counts = { button: 0, input: 0, textarea: 0 };
    for (const path of sourceFiles(SOURCE_ROOT, /\.tsx$/)) {
      for (const [, tag] of readFileSync(path, "utf8").matchAll(
        RAW_CONTROL_TAG,
      )) {
        counts[tag as keyof typeof counts] += 1;
      }
    }

    expect(counts).toEqual(RAW_CONTROL_BUDGET);
  }, 15_000);

  it("declares an explicit type on every raw button", () => {
    const missing = sourceFiles(SOURCE_ROOT, /\.tsx$/).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return Array.from(source.matchAll(/<button(?=[\s/>])/g))
        .filter((match) => !/\btype=/.test(tagAttributes(source, match.index)))
        .map(
          (match) =>
            `${relative(SOURCE_ROOT, path)}:${lineOf(source, match.index)}`,
        );
    });

    expect(missing).toEqual([]);
  }, 15_000);

  it("does not redefine @crate/ui components or hooks under the same name", () => {
    const shared = sharedComponentNames();
    const copies = sourceFiles(SOURCE_ROOT, /\.(?:ts|tsx)$/).flatMap((path) => {
      const file = relative(SOURCE_ROOT, path);
      const source = readFileSync(path, "utf8");
      return Array.from(
        source.matchAll(COMPONENT_DECLARATION),
        ([, name]) => name!,
      )
        .filter((name) => shared.has(name) && !wrapsSharedExport(source, name))
        .map((name) => `${file}:${name}`);
    });

    expect(copies.sort()).toEqual(Object.keys(LOCAL_COPY_ALLOWLIST).sort());
  }, 15_000);
});
