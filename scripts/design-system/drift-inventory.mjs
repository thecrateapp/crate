import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const SOURCE_DIRECTORIES = ["app/listen/src", "app/shared/ui"];
const SOURCE_EXTENSIONS = new Set([".css", ".js", ".jsx", ".ts", ".tsx"]);
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".vite",
  "coverage",
  "dist",
  "node_modules",
]);

const RAW_COLOR_PATTERN = /#[0-9a-f]{3,8}\b|(?:rgba?|hsla?)\(/gi;
const HARDCODED_UTILITY_PATTERN =
  /\b(?:bg|text|border|ring|outline|from|via|to|fill|stroke)-(?:\[[^\]]+\]|(?:black|white|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?(?:\/\d{1,3})?)(?=[\s"'`]|$)/g;
const INLINE_STYLE_PATTERN = /\bstyle\s*=\s*\{\{/g;
const DIRECT_SHADCN_IMPORT_PATTERN =
  /(?:from\s+|import\s*\(\s*)["']@crate\/ui\/shadcn\/[^"']+["']/g;

function countMatches(content, pattern) {
  return content.match(pattern)?.length ?? 0;
}

export function analyzeContent(content) {
  return {
    rawColors: countMatches(content, RAW_COLOR_PATTERN),
    hardcodedUtilities: countMatches(content, HARDCODED_UTILITY_PATTERN),
    inlineStyles: countMatches(content, INLINE_STYLE_PATTERN),
    directShadcnImports: countMatches(content, DIRECT_SHADCN_IMPORT_PATTERN),
  };
}

function collectFiles(directory, repoRoot, output) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;

    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      collectFiles(filePath, repoRoot, output);
      continue;
    }

    if (!SOURCE_EXTENSIONS.has(extname(entry.name))) continue;
    if (/\.test\.[^.]+$/.test(entry.name)) continue;

    const content = readFileSync(filePath, "utf8");
    output.push({
      path: relative(repoRoot, filePath),
      ...analyzeContent(content),
    });
  }
}

export function buildDriftInventory(repoRoot = process.cwd()) {
  const resolvedRoot = resolve(repoRoot);
  const files = [];

  SOURCE_DIRECTORIES.forEach((directory) => {
    const absoluteDirectory = join(resolvedRoot, directory);
    if (statSync(absoluteDirectory, { throwIfNoEntry: false })) {
      collectFiles(absoluteDirectory, resolvedRoot, files);
    }
  });

  files.sort((left, right) => left.path.localeCompare(right.path));

  const totals = files.reduce(
    (result, file) => {
      result.rawColors += file.rawColors;
      result.hardcodedUtilities += file.hardcodedUtilities;
      result.inlineStyles += file.inlineStyles;
      result.directShadcnImports += file.directShadcnImports;
      return result;
    },
    {
      files: files.length,
      rawColors: 0,
      hardcodedUtilities: 0,
      inlineStyles: 0,
      directShadcnImports: 0,
    },
  );

  return {
    version: 1,
    roots: SOURCE_DIRECTORIES,
    totals,
    files,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  console.log(JSON.stringify(buildDriftInventory(), null, 2));
}
