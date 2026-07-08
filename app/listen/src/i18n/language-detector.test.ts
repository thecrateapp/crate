import { describe, expect, it } from "vitest";

import {
  detectPreferredLocale,
  normalizeLocaleCandidates,
} from "@/i18n/language-detector";

describe("listen language detection", () => {
  it("prefers explicit user locale over browser languages", () => {
    expect(
      detectPreferredLocale({
        userPreference: "fr",
        devicePreference: "es",
        browserLanguages: ["de-DE"],
      }),
    ).toBe("fr");
  });

  it("normalizes regional locales to supported base language", () => {
    expect(normalizeLocaleCandidates(["ca-ES", "en-US"])).toEqual(["ca", "en"]);
  });

  it("falls back to English for unsupported languages", () => {
    expect(
      detectPreferredLocale({
        browserLanguages: ["pl-PL"],
      }),
    ).toBe("en");
  });
});
