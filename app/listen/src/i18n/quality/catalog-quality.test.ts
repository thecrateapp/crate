import { describe, expect, it } from "vitest";

import {
  assertNoI18nQualityErrors,
  validateCatalogs,
} from "@/i18n/quality/catalog-quality";

function issueCodesFor(report: ReturnType<typeof validateCatalogs>) {
  return report.issues.map((issue) => issue.code);
}

describe("validateCatalogs", () => {
  it("reports missing and extra locale keys", () => {
    const report = validateCatalogs({
      sourceVersion: "test",
      source: { hello: "Hello" },
      catalogs: { es: { extra: "Extra" } },
      protectedExactTerms: [],
      protectedContainedTerms: [],
      englishFallbackAllowlist: new Set(),
      staleMetadata: {},
    });

    expect(issueCodesFor(report)).toContain("missing_key");
    expect(issueCodesFor(report)).toContain("extra_key");
  });

  it("reports empty translated values", () => {
    const report = validateCatalogs({
      sourceVersion: "test",
      source: { hello: "Hello" },
      catalogs: { es: { hello: "  " } },
      protectedExactTerms: [],
      protectedContainedTerms: [],
      englishFallbackAllowlist: new Set(),
      staleMetadata: {},
    });

    expect(issueCodesFor(report)).toContain("empty_value");
  });

  it("reports placeholder mismatches", () => {
    const report = validateCatalogs({
      sourceVersion: "test",
      source: { count: "{count, plural, one {# song} other {# songs}}" },
      catalogs: {
        es: { count: "{total, plural, one {# cancion} other {# canciones}}" },
      },
      protectedExactTerms: [],
      protectedContainedTerms: [],
      englishFallbackAllowlist: new Set(),
      staleMetadata: {},
    });

    expect(issueCodesFor(report)).toContain("placeholder_mismatch");
  });

  it("reports malformed ICU-style brace syntax", () => {
    const report = validateCatalogs({
      sourceVersion: "test",
      source: { count: "{count} songs" },
      catalogs: { es: { count: "{count canciones" } },
      protectedExactTerms: [],
      protectedContainedTerms: [],
      englishFallbackAllowlist: new Set(),
      staleMetadata: {},
    });

    expect(issueCodesFor(report)).toContain("icu_parse_error");
  });

  it("reports protected product term drift", () => {
    const report = validateCatalogs({
      sourceVersion: "test",
      source: {
        "app.name": "Crate",
        "stats.scope": "Your Crate Pulse",
      },
      catalogs: {
        es: {
          "app.name": "Caja",
          "stats.scope": "Tu pulso",
        },
      },
      protectedExactTerms: [["app.name", "Crate"]],
      protectedContainedTerms: [["stats.scope", "Crate Pulse"]],
      englishFallbackAllowlist: new Set(),
      staleMetadata: {},
    });

    expect(
      report.issues.filter((issue) => issue.code === "protected_term_changed"),
    ).toHaveLength(2);
  });

  it("reports disallowed English fallback but respects allowlists and protected terms", () => {
    const report = validateCatalogs({
      sourceVersion: "test",
      source: {
        allowed: "OK",
        fallback: "Play",
        "settings.playback.crossfade": "Crossfade",
      },
      catalogs: {
        es: {
          allowed: "OK",
          fallback: "Play",
          "settings.playback.crossfade": "Crossfade",
        },
      },
      protectedExactTerms: [["settings.playback.crossfade", "Crossfade"]],
      protectedContainedTerms: [],
      englishFallbackAllowlist: new Set(["allowed"]),
      staleMetadata: {},
    });

    expect(
      report.issues.filter((issue) => issue.code === "english_fallback"),
    ).toHaveLength(1);
    expect(report.issues[0]?.key).toBe("fallback");
  });

  it("reports stale translations from source hash metadata", () => {
    const report = validateCatalogs({
      sourceVersion: "test",
      source: { play: "Play" },
      catalogs: { es: { play: "Reproducir" } },
      protectedExactTerms: [],
      protectedContainedTerms: [],
      englishFallbackAllowlist: new Set(),
      staleMetadata: {
        es: {
          play: { sourceHash: "old" },
        },
      },
      sourceHashes: { play: "new" },
    });

    expect(issueCodesFor(report)).toContain("stale_translation");
  });

  it("throws when a report contains quality errors", () => {
    const report = validateCatalogs({
      sourceVersion: "test",
      source: { hello: "Hello" },
      catalogs: { es: {} },
      protectedExactTerms: [],
      protectedContainedTerms: [],
      englishFallbackAllowlist: new Set(),
      staleMetadata: {},
    });

    expect(() => assertNoI18nQualityErrors(report)).toThrow(
      "1 i18n quality errors",
    );
  });
});
