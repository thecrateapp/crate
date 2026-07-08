import { apiUrl } from "@/lib/api";
import { getCurrentServer } from "@/lib/server-store";

export type I18nMessages = Record<string, string>;

export const LISTEN_I18N_SOURCE_VERSION =
  import.meta.env.VITE_LISTEN_I18N_SOURCE_VERSION ?? "local-v1";

const CACHE_PREFIX = "crate-listen-i18n-bundle:v1";

interface I18nManifestResponse {
  app: string;
  fallbackLocale: string;
  sourceVersion: string;
  bundles: Array<{
    locale: string;
    sourceVersion: string;
    bundleVersion?: string;
  }>;
}

interface I18nBundleResponse {
  schema: "crate.i18n.bundle.v1";
  app: string;
  locale: string;
  sourceLocale: string;
  sourceVersion: string;
  bundleVersion: string;
  messages: unknown;
}

function isMessages(value: unknown): value is I18nMessages {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((item) => typeof item === "string");
}

export function getI18nServerCacheId(): string {
  return getCurrentServer()?.id ?? "web";
}

export function buildI18nCacheKey(
  serverId: string,
  locale: string,
  sourceVersion: string,
): string {
  return `${CACHE_PREFIX}:${serverId}:${locale}:${sourceVersion}`;
}

export function readCachedBundle(
  serverId: string,
  locale: string,
  sourceVersion: string,
): I18nMessages | null {
  try {
    const raw = localStorage.getItem(
      buildI18nCacheKey(serverId, locale, sourceVersion),
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.sourceVersion !== sourceVersion) return null;
    return isMessages(parsed.messages) ? parsed.messages : null;
  } catch {
    return null;
  }
}

export function writeCachedBundle(
  serverId: string,
  locale: string,
  sourceVersion: string,
  messages: I18nMessages,
): void {
  try {
    localStorage.setItem(
      buildI18nCacheKey(serverId, locale, sourceVersion),
      JSON.stringify({
        schema: "crate.listen.i18n.cache.v1",
        locale,
        sourceVersion,
        cachedAt: new Date().toISOString(),
        messages,
      }),
    );
  } catch {
    // Ignore storage failures in private or restricted webviews.
  }
}

async function readJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return null;
  return (await response.json()) as T;
}

export async function fetchPublishedRemoteBundle(
  locale: string,
  sourceVersion = LISTEN_I18N_SOURCE_VERSION,
): Promise<I18nMessages | null> {
  const manifest = await readJson<I18nManifestResponse>(
    apiUrl(
      `/api/i18n/listen/manifest?source_version=${encodeURIComponent(
        sourceVersion,
      )}`,
    ),
  );
  if (!manifest || manifest.sourceVersion !== sourceVersion) return null;

  const published = manifest.bundles.find(
    (bundle) =>
      bundle.locale === locale && bundle.sourceVersion === sourceVersion,
  );
  if (!published) return null;

  const bundle = await readJson<I18nBundleResponse>(
    apiUrl(
      `/api/i18n/listen/bundles/${encodeURIComponent(
        locale,
      )}?source_version=${encodeURIComponent(sourceVersion)}`,
    ),
  );
  if (!bundle || bundle.sourceVersion !== sourceVersion) return null;
  if (bundle.locale !== locale || !isMessages(bundle.messages)) return null;

  return bundle.messages;
}

export async function refreshCachedRemoteBundle(
  locale: string,
  sourceVersion = LISTEN_I18N_SOURCE_VERSION,
  serverId = getI18nServerCacheId(),
): Promise<I18nMessages | null> {
  try {
    const messages = await fetchPublishedRemoteBundle(locale, sourceVersion);
    if (!messages) return null;
    writeCachedBundle(serverId, locale, sourceVersion, messages);
    return messages;
  } catch {
    return null;
  }
}
