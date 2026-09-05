import { ApiError, createApiClient } from "../../../shared/web/api";

export { ApiError };
import {
  redirectToLoginOnUnauthorized,
  shouldRedirectToLoginOnUnauthorized,
} from "@/lib/auth-route-policy";
import { isTauriRuntime, usesConfigurableServer } from "@/lib/platform";
import {
  getCurrentServer,
  migrateLegacyToken,
  seedDefaultServer,
} from "@/lib/server-store";
import {
  AUTH_TOKEN_EVENT,
  getApiAuthHeaders,
  getAuthToken,
  getAuthTokenExpiresAt,
  getRefreshToken,
  setAuthTokens as setSessionAuthTokens,
  setRefreshToken,
} from "@/lib/auth-session";
import {
  clearMediaAccessTickets,
  getMediaAccessTicket,
  type MediaAccessAudience,
} from "@/lib/media-access";
import {
  ensureMediaAccessUrl as ensureMediaAccessUrlInternal,
  MediaAccessTicketError,
  queueMediaAccessTarget,
  refreshMediaAccessTickets,
  startMediaAccessTicketRefresh,
} from "@/lib/api-media-access";

export {
  AUTH_TOKEN_EVENT,
  getApiAuthHeaders,
  getAuthToken,
  getAuthTokenExpiresAt,
  getRefreshToken,
  setRefreshToken,
  MediaAccessTicketError,
  refreshMediaAccessTickets,
  startMediaAccessTicketRefresh,
};

/**
 * Development-only desktop convenience. Release builds must not ship with a
 * preconfigured server; users should choose their own Crate instance.
 */
const DEV_TAURI_DEFAULT_SERVER = "https://api.lespedants.org";
const BUILD_TIME_DEFAULT =
  import.meta.env.DEV && isTauriRuntime ? DEV_TAURI_DEFAULT_SERVER : "";

// Run the legacy-token migration once on module load. It's a no-op
// after the first time and on fresh installs.
migrateLegacyToken(BUILD_TIME_DEFAULT);
seedDefaultServer(BUILD_TIME_DEFAULT);

/**
 * Resolve the active API base URL.
 *
 *   - Web: empty string. Listen Web is same-origin with its backend
 *     (proxied by Caddy/Traefik). Relative fetches are correct.
 *   - Configurable runtimes: the URL of the current server from the
 *     server-store. Tauri dev also gets a local development default so
 *     desktop iteration starts directly against prod-like API.
 *
 * This is re-evaluated on every call so switching servers in-flight
 * takes effect for the next request without a reload.
 */
export function getApiBase(): string {
  if (!usesConfigurableServer) return "";
  const server = getCurrentServer();
  return server?.url || BUILD_TIME_DEFAULT;
}

/**
 * @deprecated use getApiBase() — kept as a compatibility shim for a
 * couple of call sites that still expect a constant. Returns the value
 * at import time; prefer the getter for anything long-lived.
 */
export const API_BASE = getApiBase();

/** Resolve an API path to a full URL. Use for raw fetch() calls and stream URLs. */
export function apiUrl(path: string): string {
  return `${getApiBase()}${path}`;
}

function isAbsoluteHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function isApiUrl(url: string): boolean {
  try {
    const parsed = new URL(
      url,
      typeof window !== "undefined"
        ? window.location.origin
        : "https://crate.local",
    );
    return parsed.pathname.startsWith("/api/");
  } catch {
    return url.startsWith("/api/") || url.startsWith("api/");
  }
}

function isPublicCacheableApiAsset(url: string): boolean {
  try {
    const parsed = new URL(
      url,
      typeof window !== "undefined"
        ? window.location.origin
        : "https://crate.local",
    );
    return parsed.pathname === "/api/network/external-artist/photo";
  } catch {
    return false;
  }
}

function withoutMediaCredentials(url: string): string {
  const absolute = isAbsoluteHttpUrl(url);
  const base =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://crate.local";
  try {
    const parsed = new URL(url, base);
    parsed.searchParams.delete("token");
    parsed.searchParams.delete("media_ticket");
    if (absolute) return parsed.toString();
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
}

function apiCredentials(): RequestCredentials {
  return usesConfigurableServer ? "omit" : "include";
}

function withMediaAccessTicket(
  url: string,
  audience: MediaAccessAudience,
): string {
  const absolute = /^(?:https?|wss?):\/\//i.test(url);
  const base =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://crate.local";
  try {
    const parsed = new URL(url, base);
    parsed.searchParams.delete("token");
    parsed.searchParams.delete("media_ticket");
    const server = usesConfigurableServer ? getCurrentServer() : null;
    const serverOrigin = server?.url ? new URL(server.url) : null;
    const targetsCurrentServer =
      !absolute ||
      !serverOrigin ||
      (parsed.host === serverOrigin.host &&
        (parsed.protocol === "https:" || parsed.protocol === "wss:") ===
          (serverOrigin.protocol === "https:"));
    const ticket =
      targetsCurrentServer && server?.token && server.id
        ? getMediaAccessTicket(audience, parsed.pathname, server.id)
        : null;
    if (!ticket && targetsCurrentServer && server?.token && server.id) {
      queueMediaAccessTarget(audience, parsed.pathname, server.id);
    }
    if (ticket) parsed.searchParams.set("media_ticket", ticket);
    if (absolute) return parsed.toString();
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url.replace(/([?&])token=[^&]*&?/g, "$1").replace(/[?&]$/, "");
  }
}

/**
 * Resolve a protected media URL only after its exact-path ticket is available.
 *
 * Synchronous URL helpers remain suitable for lazy page artwork, where a
 * ticket refresh can trigger a rerender. Audio engines and other connection
 * boundaries must use this function so they never receive a cold unticketed
 * URL in configurable-server runtimes.
 */
export async function ensureMediaAccessUrl(
  url: string,
  audience: MediaAccessAudience,
  options: { forceRefresh?: boolean } = {},
): Promise<string> {
  return ensureMediaAccessUrlInternal(url, audience, options, {
    resolveApiUrl: apiUrl,
    isApiUrl,
    withMediaAccessTicket,
  });
}

/** Resolve an SSE path to a full URL using a short-lived scoped ticket. */
export function apiSseUrl(path: string): string {
  return withMediaAccessTicket(apiUrl(path), "sse");
}

/** Resolve an API media path using a short-lived artwork ticket. */
export function apiAssetUrl(path: string): string {
  const baseUrl = isAbsoluteHttpUrl(path) ? path : apiUrl(path);
  if (!isApiUrl(baseUrl)) return baseUrl;
  if (isPublicCacheableApiAsset(baseUrl)) {
    return withoutMediaCredentials(baseUrl);
  }
  return withMediaAccessTicket(baseUrl, "artwork");
}

export function apiStreamUrl(path: string): string {
  const baseUrl = isAbsoluteHttpUrl(path) ? path : apiUrl(path);
  if (!isApiUrl(baseUrl)) return baseUrl;
  return withMediaAccessTicket(baseUrl, "stream");
}

export function resolveMaybeApiAssetUrl(
  url: string | null | undefined,
): string | null {
  if (!url) return null;
  if (
    url.startsWith("data:") ||
    url.startsWith("blob:") ||
    url.startsWith("file:") ||
    url.startsWith("capacitor:")
  ) {
    return url;
  }
  if (url.startsWith("/api/")) return apiAssetUrl(url);
  if (url.startsWith("api/")) return apiAssetUrl(`/${url}`);

  const base = getApiBase();
  if (base && url.startsWith(`${base}/api/`)) {
    const relative = url.slice(base.length);
    return apiAssetUrl(relative);
  }

  if (
    typeof window !== "undefined" &&
    url.startsWith(`${window.location.origin}/api/`)
  ) {
    const relative = url.slice(window.location.origin.length);
    return apiAssetUrl(relative);
  }

  if (isAbsoluteHttpUrl(url)) {
    try {
      const parsed = new URL(url);
      if (parsed.pathname.startsWith("/api/")) return apiAssetUrl(url);
    } catch {
      // Leave malformed external URLs untouched.
    }
  }

  return url;
}

export function requiresMediaAccessTicket(
  url: string | null | undefined,
): boolean {
  if (!url || !usesConfigurableServer || !isApiUrl(url)) return false;
  if (isPublicCacheableApiAsset(url)) return false;
  try {
    const server = getCurrentServer();
    const parsed = new URL(url, server?.url || "https://crate.local");
    if (server?.url && parsed.origin !== new URL(server.url).origin) {
      return false;
    }
    return parsed.pathname.startsWith("/api/");
  } catch {
    return url.startsWith("/api/") || url.startsWith("api/");
  }
}

export function isUsableMediaAssetUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  if (
    url.startsWith("data:") ||
    url.startsWith("blob:") ||
    url.startsWith("file:") ||
    url.startsWith("capacitor:")
  ) {
    return true;
  }
  if (!requiresMediaAccessTicket(url)) return true;

  try {
    const parsed = new URL(
      url,
      getCurrentServer()?.url || "https://crate.local",
    );
    return (
      parsed.searchParams.has("media_ticket") ||
      parsed.searchParams.has("token")
    );
  } catch {
    return false;
  }
}

export function resolveMaybeApiStreamUrl(
  url: string | null | undefined,
): string | null {
  if (!url) return null;
  if (
    url.startsWith("blob:") ||
    url.startsWith("file:") ||
    url.startsWith("capacitor:") ||
    url.startsWith("content:")
  ) {
    return url;
  }
  if (url.startsWith("/api/")) return apiStreamUrl(url);
  if (url.startsWith("api/")) return apiStreamUrl(`/${url}`);
  if (isAbsoluteHttpUrl(url) && isApiUrl(url)) return apiStreamUrl(url);
  return url;
}

/** Resolve an API path to a full WebSocket URL. */
export function apiWsUrl(path: string): string {
  const base = getApiBase();
  const baseOrigin = base
    ? base.replace(/^http/i, "ws")
    : window.location.origin.replace(/^http/i, "ws");
  return withMediaAccessTicket(`${baseOrigin}${path}`, "ws");
}

export function setAuthToken(
  token: string | null,
  accessExpiresAt?: string | null,
): void {
  setAuthTokens(token, token ? undefined : null, accessExpiresAt);
}

export function setAuthTokens(
  token: string | null,
  refreshToken?: string | null,
  accessExpiresAt?: string | null,
): void {
  setSessionAuthTokens(token, refreshToken, accessExpiresAt);
  if (usesConfigurableServer) {
    if (!token) clearMediaAccessTickets();
    else void refreshMediaAccessTickets();
  }
}
export { shouldRedirectToLoginOnUnauthorized };

if (typeof window !== "undefined") {
  (
    window as Window &
      typeof globalThis & {
        __crateResolveApiAssetUrl?: (path: string) => string;
      }
  ).__crateResolveApiAssetUrl = apiAssetUrl;
}

// The shared api client is created ONCE, but we want the base URL to be
// re-read on every request so server switches are live. We pass a
// base-URL getter and wrap calls through our own thin proxy.
const innerApi = createApiClient({
  credentials: apiCredentials(),
  defaultHeaders: getApiAuthHeaders,
});

let refreshPromise: Promise<boolean> | null = null;
const AUTH_TOKEN_FRESHNESS_MARGIN_MS = 10 * 60 * 1000;

function shouldAttemptRefresh(path: string): boolean {
  return (
    !path.includes("/api/auth/login") &&
    !path.includes("/api/auth/register") &&
    !path.includes("/api/auth/refresh") &&
    !path.includes("/api/auth/logout")
  );
}

function redirectAfterUnauthorized(): void {
  redirectToLoginOnUnauthorized(window.location.pathname, (path) => {
    window.location.href = path;
  });
}

async function clearRejectedWebSession(): Promise<void> {
  if (usesConfigurableServer) return;
  await fetch(`${getApiBase()}/api/auth/logout`, {
    method: "POST",
    credentials: apiCredentials(),
    headers: getApiAuthHeaders(),
  }).catch(() => {
    // The session is already unusable; a network failure should not block auth recovery.
  });
}

export async function refreshAuthToken(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const refreshToken = getRefreshToken();
    const headers = getApiAuthHeaders();
    headers["Content-Type"] = "application/json";
    const response = await fetch(`${getApiBase()}/api/auth/refresh`, {
      method: "POST",
      credentials: apiCredentials(),
      headers,
      body: JSON.stringify(refreshToken ? { refresh_token: refreshToken } : {}),
    }).catch(() => null);
    if (!response) {
      return false;
    }
    if (!response.ok) {
      if (
        response.status === 400 ||
        response.status === 401 ||
        response.status === 403
      ) {
        setAuthToken(null);
        await clearRejectedWebSession();
      }
      return false;
    }
    const data = (await response.json().catch(() => null)) as {
      token?: string;
      access_expires_at?: string | null;
      refresh_token?: string | null;
    } | null;
    if (!data?.token) {
      setAuthToken(null);
      await clearRejectedWebSession();
      return false;
    }
    setAuthTokens(
      data.token,
      data.refresh_token ?? undefined,
      data.access_expires_at ?? undefined,
    );
    return true;
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

export async function ensureFreshAuthToken(
  minValidityMs = AUTH_TOKEN_FRESHNESS_MARGIN_MS,
): Promise<boolean> {
  const token = getAuthToken();
  if (!token) return true;

  const expiresAt = getAuthTokenExpiresAt();
  if (!expiresAt) return true;

  const expiresMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresMs)) return true;

  if (expiresMs - Date.now() > minValidityMs) return true;
  return refreshAuthToken();
}

export function api<T = unknown>(
  path: string,
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
  options?: { signal?: AbortSignal },
): Promise<T> {
  return innerApi<T>(`${getApiBase()}${path}`, method, body, options).catch(
    async (error) => {
      if (
        error instanceof ApiError &&
        error.status === 401 &&
        shouldAttemptRefresh(path) &&
        (await refreshAuthToken())
      ) {
        return innerApi<T>(`${getApiBase()}${path}`, method, body, options);
      }
      if (error instanceof ApiError && error.status === 401) {
        redirectAfterUnauthorized();
      }
      throw error;
    },
  );
}

/** fetch() wrapper that adds API base URL and auth headers. Fire-and-forget friendly. */
export async function apiFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const headers: Record<string, string> = {
    ...((init?.headers as Record<string, string>) || {}),
    ...getApiAuthHeaders(),
  };
  const request = () =>
    fetch(`${getApiBase()}${path}`, {
      ...init,
      credentials: apiCredentials(),
      headers,
    });
  let response = await request();
  if (
    response.status === 401 &&
    shouldAttemptRefresh(path) &&
    (await refreshAuthToken())
  ) {
    response = await fetch(`${getApiBase()}${path}`, {
      ...init,
      credentials: apiCredentials(),
      headers: {
        ...((init?.headers as Record<string, string>) || {}),
        ...getApiAuthHeaders(),
      },
    });
  }
  if (response.status === 401) {
    redirectAfterUnauthorized();
  }
  return response;
}
