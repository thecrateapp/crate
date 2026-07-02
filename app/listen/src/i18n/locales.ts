export const LISTEN_FALLBACK_LOCALE = "en";

export const LISTEN_SUPPORTED_LOCALES = [
  "en",
  "es",
  "fr",
  "de",
  "it",
  "ca",
  "eu",
] as const;

export type ListenLocale = (typeof LISTEN_SUPPORTED_LOCALES)[number];

export function normalizeLocale(
  input: string | null | undefined,
): string | null {
  if (!input) return null;
  const normalized = input.trim().replace("_", "-").toLowerCase();
  if (!normalized) return null;
  return normalized;
}

export function toSupportedListenLocale(
  input: string | null | undefined,
): ListenLocale | null {
  const normalized = normalizeLocale(input);
  if (!normalized) return null;
  const language = normalized.split("-")[0];
  return LISTEN_SUPPORTED_LOCALES.find((locale) => locale === language) ?? null;
}
