#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDir, "..");
const srcRoot = join(appRoot, "src");
const catalogsDir = join(srcRoot, "i18n", "catalogs");
const metadataDir = join(catalogsDir, ".metadata");
const sourceVersion = process.env.VITE_LISTEN_I18N_SOURCE_VERSION ?? "local-v1";

const options = parseArgs(process.argv.slice(2));
const jiti = createJiti(import.meta.url, {
  alias: {
    "@": srcRoot,
  },
});

const { assertNoI18nQualityErrors, validateCatalogs } = await jiti.import(
  join(srcRoot, "i18n", "quality", "catalog-quality.ts"),
);
const { CONTAINED_PRODUCT_TERM_KEYS, EXACT_PRODUCT_TERM_KEYS } =
  await jiti.import(join(srcRoot, "i18n", "product-terms.ts"));
const { buildEnglishFallbackAllowlist } = await jiti.import(
  join(srcRoot, "i18n", "quality", "english-fallback-policy.ts"),
);

const { source, catalogs } = loadCatalogs();
const report = validateCatalogs({
  sourceVersion,
  source,
  catalogs,
  protectedExactTerms: EXACT_PRODUCT_TERM_KEYS,
  protectedContainedTerms: CONTAINED_PRODUCT_TERM_KEYS,
  englishFallbackAllowlist: buildEnglishFallbackAllowlist(Object.keys(source)),
  staleMetadata: loadMetadata(Object.keys(catalogs)),
});

if (options.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printHumanReport(report);
}

try {
  assertNoI18nQualityErrors(report);
} catch (error) {
  if (options.json) {
    // Keep JSON output machine-readable; the non-zero exit code is enough.
  } else {
    console.error(error.message);
  }
  process.exit(1);
}

function parseArgs(args) {
  return {
    json: args.includes("--json"),
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function loadCatalogs() {
  const catalogFiles = readdirSync(catalogsDir)
    .filter((file) => file.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b));

  const allCatalogs = Object.fromEntries(
    catalogFiles.map((file) => [
      file.replace(/\.json$/, ""),
      readJson(join(catalogsDir, file)),
    ]),
  );
  const source = allCatalogs.en;
  if (!source) {
    throw new Error(
      "Missing English source catalog: src/i18n/catalogs/en.json",
    );
  }

  const { en: _en, ...catalogs } = allCatalogs;
  return { source, catalogs };
}

function loadMetadata(locales) {
  if (!existsSync(metadataDir)) return {};
  return Object.fromEntries(
    locales.map((locale) => {
      const metadataPath = join(metadataDir, `${locale}.json`);
      return [locale, existsSync(metadataPath) ? readJson(metadataPath) : {}];
    }),
  );
}

function printHumanReport(report) {
  const summary = `${report.errorCount} errors, ${report.warningCount} warnings`;
  if (report.issueCount === 0) {
    console.log(
      `Listen i18n catalogs OK: ${report.locales.length} locales, ${summary}`,
    );
    return;
  }

  console.log(`Listen i18n catalogs failed: ${summary}`);
  for (const issue of report.issues) {
    const key = issue.key ? ` ${issue.key}` : "";
    console.log(
      `- [${issue.severity}] ${issue.locale}${key}: ${issue.message}`,
    );
  }
}
