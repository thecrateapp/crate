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
const FOUNDATION_TOKEN_PREFIXES = [
  "accent-",
  "action-",
  "border-",
  "chrome-",
  "control-",
  "focus-",
  "font-",
  "icon-",
  "menu-",
  "motion-",
  "scrim-",
  "state-",
  "surface-",
  "text-",
];
const DOMAIN_TOKEN_PREFIXES = [
  "disc-",
  "eq-",
  "explore-",
  "fullscreen-player-",
  "home-",
  "info-",
  "jam-",
  "lyrics-",
  "play-button-",
  "player-",
  "profile-",
  "quality-",
  "radio-",
  "stats-",
  "track-row-",
  "user-profile-",
];

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

function extractRootBlock(content) {
  const rootStart = content.indexOf(":root");
  if (rootStart === -1) return "";

  const openingBrace = content.indexOf("{", rootStart);
  if (openingBrace === -1) return "";

  let depth = 0;
  for (let index = openingBrace; index < content.length; index += 1) {
    if (content[index] === "{") depth += 1;
    if (content[index] !== "}") continue;

    depth -= 1;
    if (depth === 0) return content.slice(openingBrace + 1, index);
  }

  return "";
}

function extractRootTokenDefinitions(content) {
  const rootBlock = extractRootBlock(content);
  return [...rootBlock.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gim)].map(
    ([, name, value]) => ({
      name,
      value: value
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\s*([(),])\s*/g, "$1"),
    }),
  );
}

function isFoundationToken(name) {
  return FOUNDATION_TOKEN_PREFIXES.some((prefix) =>
    name.startsWith(`--${prefix}`),
  );
}

function isDomainToken(name) {
  return DOMAIN_TOKEN_PREFIXES.some((prefix) => name.startsWith(`--${prefix}`));
}

function countTokenReferences(content, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    content.match(new RegExp(`var\\(\\s*${escapedName}(?=\\s*[,\\)])`, "g"))
      ?.length ?? 0
  );
}

export function analyzeSemanticTokens(content, consumerContents = [content]) {
  const definitions = extractRootTokenDefinitions(content);
  const values = new Map();

  definitions.forEach(({ value }) => {
    values.set(value, (values.get(value) ?? 0) + 1);
  });

  const aliases = definitions.filter(({ value }) =>
    /^var\(--[a-z0-9-]+\)$/.test(value),
  );
  const duplicateTokenGroups = [...values.entries()]
    .filter(([, count]) => count > 1)
    .map(([value]) =>
      definitions
        .filter((definition) => definition.value === value)
        .map(({ name }) => name),
    );
  const allConsumerContent = consumerContents.join("\n");
  const tokenConsumers = Object.fromEntries(
    definitions.map(({ name }) => [
      name,
      countTokenReferences(allConsumerContent, name),
    ]),
  );
  const oneShotTokens = definitions
    .filter(({ name }) => tokenConsumers[name] === 1)
    .map(({ name }) => ({ name, consumers: tokenConsumers[name] }));

  return {
    definitions: definitions.length,
    foundationDefinitions: definitions.filter(({ name }) =>
      isFoundationToken(name),
    ).length,
    domainDefinitions: definitions.filter(({ name }) => isDomainToken(name))
      .length,
    aliases: aliases.length,
    uniqueValues: values.size,
    duplicateDefinitions: definitions.length - values.size,
    duplicateGroups: duplicateTokenGroups.length,
    duplicateTokenGroups,
    nonFoundationAliases: aliases
      .filter(({ name }) => !isFoundationToken(name))
      .map(({ name }) => name),
    tokenConsumers,
    oneShotTokens,
    unreferencedTokens: definitions
      .filter(({ name }) => tokenConsumers[name] === 0)
      .map(({ name }) => name),
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
  const semanticTokenPath = join(
    resolvedRoot,
    "app/shared/ui/tokens/semantic.css",
  );

  SOURCE_DIRECTORIES.forEach((directory) => {
    const absoluteDirectory = join(resolvedRoot, directory);
    if (statSync(absoluteDirectory, { throwIfNoEntry: false })) {
      collectFiles(absoluteDirectory, resolvedRoot, files);
    }
  });

  files.sort((left, right) => left.path.localeCompare(right.path));
  const sourceContents = files.map((file) =>
    readFileSync(join(resolvedRoot, file.path), "utf8"),
  );

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
    semanticTokens: statSync(semanticTokenPath, { throwIfNoEntry: false })
      ? analyzeSemanticTokens(
          readFileSync(semanticTokenPath, "utf8"),
          sourceContents,
        )
      : null,
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
