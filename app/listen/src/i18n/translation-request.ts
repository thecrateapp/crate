import { normalizeLocale, toSupportedListenLocale } from "@/i18n/locales";
import {
  getI18nServerCacheId,
  LISTEN_I18N_SOURCE_VERSION,
} from "@/i18n/remote-bundles";
import { apiUrl } from "@/lib/api";
import { getListenAppId } from "@/lib/platform";

const REQUEST_PREFIX = "crate-listen-i18n-request:v1";
const pendingRequests = new Set<string>();

interface UnsupportedLocaleRequestCandidate {
  detectedLocale: string;
  normalizedLocale: string;
}

function normalizeUnsupportedLocale(
  locale: string | null | undefined,
): string | null {
  const normalized = normalizeLocale(locale);
  if (!normalized || toSupportedListenLocale(normalized)) return null;

  const baseLanguage = normalized.split("-")[0]?.trim();
  if (!baseLanguage || baseLanguage.length < 2) return null;
  return baseLanguage;
}

function buildRequestKey(
  serverId: string,
  normalizedLocale: string,
  sourceVersion: string,
): string {
  return `${REQUEST_PREFIX}:${serverId}:${normalizedLocale}:${sourceVersion}`;
}

export function findUnsupportedLocaleRequestCandidate(
  browserLanguages: readonly string[],
): UnsupportedLocaleRequestCandidate | null {
  if (browserLanguages.some((language) => toSupportedListenLocale(language))) {
    return null;
  }

  for (const detectedLocale of browserLanguages) {
    const normalizedLocale = normalizeUnsupportedLocale(detectedLocale);
    if (!normalizedLocale) continue;
    return { detectedLocale, normalizedLocale };
  }

  return null;
}

export function shouldRequestUnsupportedLocale(
  locale: string,
  sourceVersion: string,
  serverId = getI18nServerCacheId(),
): boolean {
  const normalizedLocale = normalizeUnsupportedLocale(locale);
  if (!normalizedLocale) return false;
  const key = buildRequestKey(serverId, normalizedLocale, sourceVersion);
  if (pendingRequests.has(key)) return false;

  try {
    return localStorage.getItem(key) !== "1";
  } catch {
    return true;
  }
}

export function markUnsupportedLocaleRequested(
  locale: string,
  sourceVersion: string,
  serverId = getI18nServerCacheId(),
): void {
  const normalizedLocale = normalizeUnsupportedLocale(locale);
  if (!normalizedLocale) return;

  try {
    localStorage.setItem(
      buildRequestKey(serverId, normalizedLocale, sourceVersion),
      "1",
    );
  } catch {
    // Storage can fail in private or restricted webviews.
  }
}

export async function requestUnsupportedLocaleTranslation(
  detectedLocale: string,
  sourceVersion = LISTEN_I18N_SOURCE_VERSION,
  serverId = getI18nServerCacheId(),
): Promise<boolean> {
  const normalizedLocale = normalizeUnsupportedLocale(detectedLocale);
  if (!normalizedLocale) return false;

  const key = buildRequestKey(serverId, normalizedLocale, sourceVersion);
  if (
    !shouldRequestUnsupportedLocale(detectedLocale, sourceVersion, serverId)
  ) {
    return false;
  }

  pendingRequests.add(key);
  try {
    const response = await fetch(
      apiUrl("/api/i18n/listen/translation-requests"),
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          detectedLocale,
          normalizedLocale,
          sourceVersion,
          client: getListenAppId(),
          reason: "unsupported-locale",
        }),
      },
    );
    if (!response.ok) return false;

    markUnsupportedLocaleRequested(detectedLocale, sourceVersion, serverId);
    return true;
  } catch {
    return false;
  } finally {
    pendingRequests.delete(key);
  }
}
