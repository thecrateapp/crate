import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = dirname(fileURLToPath(import.meta.url));
const CONSUMER_ROOTS = ["../../listen/src", "../../ui/src"].map((path) =>
  resolve(PACKAGE_ROOT, path),
);
const MODULE_EXTENSIONS = [".ts", ".tsx"];
const SPECIFIER_PATTERN = /["'](@crate\/ui\/[^"']+)["']/g;
const RE_EXPORT_PATTERN =
  /export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+["'](\.[^"']+)["']/g;

const BASE_SYSTEM_EXPORTS: Array<[RegExp, string]> = [
  [/^shadcn\//, "Curated shadcn base components stay available to both apps."],
  [/^tokens\//, "Token stylesheets are composed through tokens/index.css."],
  [/^icons(?:\/|$)/, "The icon catalogue is a base-system module."],
  [/^composites\//, "Admin-oriented composites are kept for app/ui by plan."],
  [/^domain\/stats\/Ops/, "Ops stats surfaces are kept for admin by plan."],
];

const UNUSED_EXPORT_ALLOWLIST: Record<string, string> = {
  "domain/entity/EntityPrimaryAction":
    "Building block rendered inside EntityCard and EntityRow.",
  "domain/media":
    "Barrel over MediaCover and MediaEntity for entity components.",
  "domain/media/MediaCover":
    "Cover primitive rendered by EntityCard and EntityRow.",
  "domain/media/MediaEntity":
    "Entity model types consumed by MediaCover and the entity components.",
  "domain/shows/ShowCard":
    "Shared show card; admin still renders its local components/shows/ShowCard copy.",
  "domain/user": "Barrel for the shared UserMenu.",
  "domain/user/UserMenu":
    "Shared account menu; listen renders its own TopBarUserMenu.",
  "lib/color-contrast":
    "Contrast helper consumed by the appearance registry and resolver.",
  "lib/use-sheet-drag": "Drag engine shared by AppModal and MobileActionSheet.",
  "primitives/RadioGroup":
    "Phase 1 form primitive, also consumed by the shadcn dropdown menu.",
  "primitives/Spinner": "Phase 1 base loading primitive.",
  "primitives/StarRating":
    "Rating primitive; admin and listen still render local rating copies.",
};

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "node_modules" || entry.name === "dist"
        ? []
        : walk(path);
    }
    return entry.isFile() ? [path] : [];
  });
}

function exportTarget(value: unknown): string {
  if (typeof value === "string") return value;
  return (value as { default: string }).default;
}

function packageExportIds(): string[] {
  const manifest = JSON.parse(
    readFileSync(resolve(PACKAGE_ROOT, "package.json"), "utf8"),
  ) as { exports: Record<string, unknown> };

  return Object.entries(manifest.exports)
    .flatMap(([key, value]) => {
      const keyPath = key.slice(2);
      if (!keyPath.includes("*")) return [keyPath];

      const [targetPrefix, targetSuffix] = exportTarget(value)
        .slice(2)
        .split("*") as [string, string];
      const [keyPrefix] = keyPath.split("*") as [string];
      const directory = resolve(PACKAGE_ROOT, targetPrefix);
      if (!existsSync(directory)) return [];

      return walk(directory)
        .map((path) => relative(directory, path))
        .filter(
          (path) =>
            !path.includes(".test.") &&
            (targetSuffix ? path.endsWith(targetSuffix) : true),
        )
        .map(
          (path) =>
            keyPrefix +
            (targetSuffix ? path.slice(0, -targetSuffix.length) : path),
        );
    })
    .filter((id, index, ids) => ids.indexOf(id) === index)
    .sort();
}

function resolveModule(basePath: string): string | null {
  if (existsSync(basePath) && statSync(basePath).isFile()) return basePath;
  for (const extension of MODULE_EXTENSIONS) {
    if (existsSync(basePath + extension)) return basePath + extension;
  }
  for (const extension of MODULE_EXTENSIONS) {
    const index = resolve(basePath, `index${extension}`);
    if (existsSync(index)) return index;
  }
  return null;
}

function moduleId(path: string): string {
  return relative(PACKAGE_ROOT, path)
    .replace(/\/index\.tsx?$/, "")
    .replace(/\.tsx?$/, "");
}

function consumedModuleIds(): Set<string> {
  const pending = CONSUMER_ROOTS.flatMap(walk)
    .filter(
      (path) => /\.(?:ts|tsx|css)$/.test(path) && !path.includes(".test."),
    )
    .flatMap((path) =>
      Array.from(
        readFileSync(path, "utf8").matchAll(SPECIFIER_PATTERN),
        (match) =>
          resolveModule(
            resolve(PACKAGE_ROOT, match[1]!.slice("@crate/ui/".length)),
          ),
      ),
    )
    .filter((path): path is string => path !== null);
  const visited = new Set<string>();

  while (pending.length > 0) {
    const path = pending.pop()!;
    if (visited.has(path)) continue;
    visited.add(path);
    if (!/\.tsx?$/.test(path)) continue;

    for (const match of readFileSync(path, "utf8").matchAll(
      RE_EXPORT_PATTERN,
    )) {
      const target = resolveModule(resolve(dirname(path), match[1]!));
      if (target) pending.push(target);
    }
  }

  return new Set(
    Array.from(visited, (path) =>
      path.endsWith(".css") ? relative(PACKAGE_ROOT, path) : moduleId(path),
    ),
  );
}

describe("@crate/ui export usage policy", () => {
  it("only exposes modules that listen or admin import, or that are documented exceptions", () => {
    const consumed = consumedModuleIds();
    const unused = packageExportIds().filter(
      (id) =>
        !consumed.has(id) &&
        !BASE_SYSTEM_EXPORTS.some(([pattern]) => pattern.test(id)),
    );

    expect(unused).toEqual(Object.keys(UNUSED_EXPORT_ALLOWLIST).sort());
  }, 15_000);
});
