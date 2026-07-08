export interface I18nQualityIssue {
  severity: "error" | "warning";
  code:
    | "missing_key"
    | "extra_key"
    | "empty_value"
    | "stale_translation"
    | "placeholder_mismatch"
    | "icu_parse_error"
    | "protected_term_changed"
    | "english_fallback"
    | "hardcoded_copy";
  locale: string;
  key?: string;
  message: string;
  source?: string;
  value?: string;
  file?: string;
}

export interface I18nQualityReport {
  schema: "crate.listen.i18n.quality.v1";
  sourceVersion: string;
  generatedAt: string;
  locales: string[];
  issueCount: number;
  errorCount: number;
  warningCount: number;
  issues: I18nQualityIssue[];
}

export type CatalogMessages = Record<string, string>;

export type ProtectedTermEntry = readonly [key: string, value: string];

export interface StaleMetadataEntry {
  sourceHash: string;
}

export type LocaleStaleMetadata = Record<string, StaleMetadataEntry | string>;

export interface ValidateCatalogsInput {
  sourceVersion: string;
  source: CatalogMessages;
  catalogs: Record<string, CatalogMessages>;
  protectedExactTerms: readonly ProtectedTermEntry[];
  protectedContainedTerms: readonly ProtectedTermEntry[];
  englishFallbackAllowlist: ReadonlySet<string>;
  staleMetadata: Record<string, LocaleStaleMetadata>;
  sourceHashes?: Record<string, string>;
  generatedAt?: string;
}
