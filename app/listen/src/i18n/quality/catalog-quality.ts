import type {
  I18nQualityIssue,
  I18nQualityReport,
  LocaleStaleMetadata,
  ValidateCatalogsInput,
} from "@/i18n/quality/types";

const REPORT_SCHEMA = "crate.listen.i18n.quality.v1" as const;

function sortedKeys(record: Record<string, unknown>): string[] {
  return Object.keys(record).sort((a, b) => a.localeCompare(b));
}

function bracesAreBalanced(value: string): boolean {
  let depth = 0;
  for (const char of value) {
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

function extractPlaceholders(value: string): Set<string> {
  const placeholders = new Set<string>();
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "{") {
      if (depth === 0) {
        const match = value
          .slice(index + 1)
          .match(/^\s*([A-Za-z_][A-Za-z0-9_]*)/);
        if (match?.[1]) placeholders.add(match[1]);
      }
      depth += 1;
    } else if (char === "}") {
      depth = Math.max(0, depth - 1);
    }
  }
  return placeholders;
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

function staleSourceHash(
  metadata: LocaleStaleMetadata | undefined,
  key: string,
): string | null {
  const entry = metadata?.[key];
  if (!entry) return null;
  return typeof entry === "string" ? entry : entry.sourceHash;
}

export function validateCatalogs(
  input: ValidateCatalogsInput,
): I18nQualityReport {
  const issues: I18nQualityIssue[] = [];
  const sourceKeys = sortedKeys(input.source);
  const sourceKeySet = new Set(sourceKeys);
  const protectedKeySet = new Set([
    ...input.protectedExactTerms.map(([key]) => key),
    ...input.protectedContainedTerms.map(([key]) => key),
  ]);

  const addIssue = (issue: Omit<I18nQualityIssue, "severity">) => {
    issues.push({ severity: "error", ...issue });
  };

  for (const [locale, catalog] of Object.entries(input.catalogs)) {
    const catalogKeys = sortedKeys(catalog);
    const catalogKeySet = new Set(catalogKeys);

    for (const key of sourceKeys) {
      const source = input.source[key] ?? "";
      const value = catalog[key] ?? "";

      if (!catalogKeySet.has(key)) {
        addIssue({
          code: "missing_key",
          locale,
          key,
          message: `${locale}.${key} is missing`,
          source,
        });
        continue;
      }

      if (typeof value !== "string" || value.trim().length === 0) {
        addIssue({
          code: "empty_value",
          locale,
          key,
          message: `${locale}.${key} is empty`,
          source,
          value,
        });
      }

      if (!bracesAreBalanced(value)) {
        addIssue({
          code: "icu_parse_error",
          locale,
          key,
          message: `${locale}.${key} has unbalanced ICU braces`,
          source,
          value,
        });
      }

      if (
        bracesAreBalanced(source) &&
        bracesAreBalanced(value) &&
        !setsEqual(extractPlaceholders(source), extractPlaceholders(value))
      ) {
        addIssue({
          code: "placeholder_mismatch",
          locale,
          key,
          message: `${locale}.${key} placeholders do not match English`,
          source,
          value,
        });
      }

      if (
        locale !== "en" &&
        value === source &&
        !input.englishFallbackAllowlist.has(key) &&
        !protectedKeySet.has(key)
      ) {
        addIssue({
          code: "english_fallback",
          locale,
          key,
          message: `${locale}.${key} falls back to English`,
          source,
          value,
        });
      }

      const expectedSourceHash = input.sourceHashes?.[key];
      const reviewedSourceHash = staleSourceHash(
        input.staleMetadata[locale],
        key,
      );
      if (
        expectedSourceHash &&
        reviewedSourceHash &&
        reviewedSourceHash !== expectedSourceHash
      ) {
        addIssue({
          code: "stale_translation",
          locale,
          key,
          message: `${locale}.${key} was reviewed against a stale source`,
          source,
          value,
        });
      }
    }

    for (const key of catalogKeys) {
      if (sourceKeySet.has(key)) continue;
      addIssue({
        code: "extra_key",
        locale,
        key,
        message: `${locale}.${key} does not exist in English`,
        value: catalog[key],
      });
    }

    for (const [key, expected] of input.protectedExactTerms) {
      if (catalog[key] === expected) continue;
      addIssue({
        code: "protected_term_changed",
        locale,
        key,
        message: `${locale}.${key} must stay exactly "${expected}"`,
        source: input.source[key],
        value: catalog[key],
      });
    }

    for (const [key, expected] of input.protectedContainedTerms) {
      if (catalog[key]?.includes(expected)) continue;
      addIssue({
        code: "protected_term_changed",
        locale,
        key,
        message: `${locale}.${key} must contain "${expected}"`,
        source: input.source[key],
        value: catalog[key],
      });
    }
  }

  const errorCount = issues.filter(
    (issue) => issue.severity === "error",
  ).length;
  const warningCount = issues.length - errorCount;

  return {
    schema: REPORT_SCHEMA,
    sourceVersion: input.sourceVersion,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    locales: sortedKeys(input.catalogs),
    issueCount: issues.length,
    errorCount,
    warningCount,
    issues,
  };
}

export function assertNoI18nQualityErrors(report: I18nQualityReport): void {
  if (report.errorCount > 0) {
    throw new Error(`${report.errorCount} i18n quality errors`);
  }
}
