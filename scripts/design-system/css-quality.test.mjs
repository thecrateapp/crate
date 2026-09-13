import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import test from "node:test";

const ROOT = new URL("../../", import.meta.url);
const SOURCE_ROOTS = ["app/shared/ui", "app/listen/src", "app/ui/src"];
const SOURCE_EXTENSIONS = new Set([".css", ".ts", ".tsx"]);

function sourceFiles(path) {
  const absolutePath = new URL(path, ROOT).pathname;
  return readdirSync(absolutePath)
    .flatMap((entry) => {
      const child = join(absolutePath, entry);
      return statSync(child).isDirectory()
        ? sourceFiles(child.slice(new URL(ROOT).pathname.length))
        : [child];
    })
    .filter((file) => SOURCE_EXTENSIONS.has(extname(file)));
}

test("uses explicit transition properties instead of transition-all", () => {
  const offenders = SOURCE_ROOTS.flatMap(sourceFiles)
    .filter((file) => readFileSync(file, "utf8").includes("transition-all"))
    .map((file) => file.slice(new URL(ROOT).pathname.length));

  assert.deepEqual(offenders, []);
});

test("keeps shared Jam and Radio inputs visibly focused", () => {
  const recipes = readFileSync(
    new URL("app/shared/ui/tokens/recipes.css", ROOT),
    "utf8",
  );

  const jamFocus = recipes.match(
    /\.jam-input:focus,[\s\S]*?\.jam-select-trigger:focus\s*\{([^}]*)\}/,
  )?.[1];
  const radioFocus = recipes.match(
    /\.radio-seed-input:focus\s*\{([^}]*)\}/,
  )?.[1];

  assert.match(jamFocus ?? "", /box-shadow:\s*var\(--focus-shadow\)/);
  assert.match(radioFocus ?? "", /box-shadow:\s*var\(--focus-shadow\)/);
});
