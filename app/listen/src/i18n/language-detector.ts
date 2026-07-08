import {
  LISTEN_FALLBACK_LOCALE,
  type ListenLocale,
  toSupportedListenLocale,
} from "@/i18n/locales";

interface LocaleDetectionInput {
  userPreference?: string | null;
  devicePreference?: string | null;
  browserLanguages?: readonly string[];
  acceptLanguageHint?: string | null;
  geoLanguageHint?: string | null;
}

export function normalizeLocaleCandidates(
  values: readonly (string | null | undefined)[],
): ListenLocale[] {
  const seen = new Set<ListenLocale>();
  const result: ListenLocale[] = [];

  for (const value of values) {
    const locale = toSupportedListenLocale(value);
    if (!locale || seen.has(locale)) continue;
    seen.add(locale);
    result.push(locale);
  }

  return result;
}

export function detectPreferredLocale(
  input: LocaleDetectionInput,
): ListenLocale {
  const browserLanguages = input.browserLanguages ?? [];
  const candidates = normalizeLocaleCandidates([
    input.userPreference,
    input.devicePreference,
    ...browserLanguages,
    input.acceptLanguageHint,
    input.geoLanguageHint,
  ]);

  return candidates[0] ?? LISTEN_FALLBACK_LOCALE;
}
