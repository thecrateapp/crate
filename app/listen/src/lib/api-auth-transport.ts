import { ApiError } from "../../../shared/web/api";
import { redirectToLoginOnUnauthorized } from "@/lib/auth-route-policy";

type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type ApiClient = <T = unknown>(
  path: string,
  method?: ApiMethod,
  body?: unknown,
  options?: { signal?: AbortSignal },
) => Promise<T>;

export interface ApiAuthTransportDependencies {
  apiBase: () => string;
  apiClient: ApiClient;
  apiCredentials: () => RequestCredentials;
  getApiAuthHeaders: () => Record<string, string>;
  getAuthToken: () => string | null;
  getAuthTokenExpiresAt: () => string | null;
  getCurrentServerId: () => string | null;
  getRefreshToken: () => string | null;
  getServerAuthTokens: (serverId: string) => {
    token: string | null;
    refreshToken: string | null;
  } | null;
  setAuthToken: (token: string | null, accessExpiresAt?: string | null) => void;
  setAuthTokens: (
    token: string | null,
    refreshToken?: string | null,
    accessExpiresAt?: string | null,
  ) => void;
  setAuthTokensForServer: (
    serverId: string,
    token: string | null,
    refreshToken?: string | null,
    accessExpiresAt?: string | null,
  ) => boolean;
  usesConfigurableServer: boolean;
}

export interface ApiAuthTransport {
  api: ApiClient;
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  ensureFreshAuthToken: (minValidityMs?: number) => Promise<boolean>;
  refreshAuthToken: () => Promise<boolean>;
}

const AUTH_TOKEN_FRESHNESS_MARGIN_MS = 10 * 60 * 1000;

export function createApiAuthTransport(
  dependencies: ApiAuthTransportDependencies,
): ApiAuthTransport {
  interface AuthScope {
    apiBase: string;
    authHeaders: Record<string, string>;
    authToken: string | null;
    authTokenExpiresAt: string | null;
    key: string;
    refreshToken: string | null;
    serverId: string | null;
  }

  const refreshPromises = new Map<
    string,
    {
      authToken: string | null;
      refreshToken: string | null;
      promise: Promise<boolean>;
    }
  >();

  const captureAuthScope = (): AuthScope => {
    const serverId = dependencies.usesConfigurableServer
      ? dependencies.getCurrentServerId()
      : null;
    return {
      apiBase: dependencies.apiBase(),
      authHeaders: dependencies.getApiAuthHeaders(),
      authToken: dependencies.getAuthToken(),
      authTokenExpiresAt: dependencies.getAuthTokenExpiresAt(),
      key: dependencies.usesConfigurableServer
        ? `server:${serverId ?? "missing"}`
        : "web",
      refreshToken: dependencies.getRefreshToken(),
      serverId,
    };
  };

  const isCurrentScope = (scope: AuthScope): boolean =>
    !dependencies.usesConfigurableServer ||
    dependencies.getCurrentServerId() === scope.serverId;

  const hasCurrentCredentials = (scope: AuthScope): boolean => {
    if (!dependencies.usesConfigurableServer) {
      return (
        dependencies.getAuthToken() === scope.authToken &&
        dependencies.getRefreshToken() === scope.refreshToken
      );
    }
    if (!scope.serverId) return false;
    const current = dependencies.getServerAuthTokens(scope.serverId);
    return (
      current?.token === scope.authToken &&
      current.refreshToken === scope.refreshToken
    );
  };

  const shouldAttemptRefresh = (path: string): boolean =>
    !path.includes("/api/auth/login") &&
    !path.includes("/api/auth/register") &&
    !path.includes("/api/auth/refresh") &&
    !path.includes("/api/auth/logout");

  const redirectAfterUnauthorized = (): void => {
    redirectToLoginOnUnauthorized(window.location.pathname, (path) => {
      window.location.href = path;
    });
  };

  const clearRejectedWebSession = async (): Promise<void> => {
    if (dependencies.usesConfigurableServer) return;
    await fetch(`${dependencies.apiBase()}/api/auth/logout`, {
      method: "POST",
      credentials: dependencies.apiCredentials(),
      headers: dependencies.getApiAuthHeaders(),
    }).catch(() => {
      // The session is already unusable; a network failure should not block auth recovery.
    });
  };

  const clearRejectedSession = async (scope: AuthScope): Promise<void> => {
    if (!hasCurrentCredentials(scope)) return;
    if (scope.serverId) {
      dependencies.setAuthTokensForServer(scope.serverId, null, null, null);
      return;
    }
    dependencies.setAuthToken(null);
    await clearRejectedWebSession();
  };

  const refreshAuthScope = (scope: AuthScope): Promise<boolean> => {
    const pending = refreshPromises.get(scope.key);
    if (
      pending &&
      pending.authToken === scope.authToken &&
      pending.refreshToken === scope.refreshToken
    ) {
      return pending.promise;
    }
    if (dependencies.usesConfigurableServer && !scope.serverId) {
      return Promise.resolve(false);
    }
    const operation = (async () => {
      const headers = { ...scope.authHeaders };
      headers["Content-Type"] = "application/json";
      const response = await fetch(`${scope.apiBase}/api/auth/refresh`, {
        method: "POST",
        credentials: dependencies.apiCredentials(),
        headers,
        body: JSON.stringify(
          scope.refreshToken ? { refresh_token: scope.refreshToken } : {},
        ),
      }).catch(() => null);
      if (!response) return false;
      if (!response.ok) {
        if ([400, 401, 403].includes(response.status)) {
          await clearRejectedSession(scope);
        }
        return false;
      }
      const data = (await response.json().catch(() => null)) as {
        token?: string;
        access_expires_at?: string | null;
        refresh_token?: string | null;
      } | null;
      if (!data?.token) {
        await clearRejectedSession(scope);
        return false;
      }
      if (!hasCurrentCredentials(scope)) return false;
      if (scope.serverId) {
        return dependencies.setAuthTokensForServer(
          scope.serverId,
          data.token,
          data.refresh_token ?? undefined,
          data.access_expires_at ?? undefined,
        );
      }
      dependencies.setAuthTokens(
        data.token,
        data.refresh_token ?? undefined,
        data.access_expires_at ?? undefined,
      );
      return true;
    })();
    const tracked = operation.finally(() => {
      if (refreshPromises.get(scope.key)?.promise === tracked) {
        refreshPromises.delete(scope.key);
      }
    });
    refreshPromises.set(scope.key, {
      authToken: scope.authToken,
      refreshToken: scope.refreshToken,
      promise: tracked,
    });
    return tracked;
  };

  const refreshAuthToken = (): Promise<boolean> =>
    refreshAuthScope(captureAuthScope());

  const ensureFreshAuthToken = async (
    minValidityMs = AUTH_TOKEN_FRESHNESS_MARGIN_MS,
  ): Promise<boolean> => {
    const scope = captureAuthScope();
    if (!scope.authToken) return true;

    const expiresAt = scope.authTokenExpiresAt;
    if (!expiresAt) return true;

    const expiresMs = Date.parse(expiresAt);
    if (!Number.isFinite(expiresMs)) return true;

    if (expiresMs - Date.now() > minValidityMs) return true;
    return refreshAuthScope(scope);
  };

  const api = <T = unknown>(
    path: string,
    method?: ApiMethod,
    body?: unknown,
    options?: { signal?: AbortSignal },
  ): Promise<T> => {
    const scope = captureAuthScope();
    return dependencies
      .apiClient<T>(`${scope.apiBase}${path}`, method, body, options)
      .catch(async (error) => {
        if (
          error instanceof ApiError &&
          error.status === 401 &&
          shouldAttemptRefresh(path) &&
          (await refreshAuthScope(scope)) &&
          isCurrentScope(scope)
        ) {
          return dependencies.apiClient<T>(
            `${scope.apiBase}${path}`,
            method,
            body,
            options,
          );
        }
        if (
          error instanceof ApiError &&
          error.status === 401 &&
          isCurrentScope(scope)
        ) {
          redirectAfterUnauthorized();
        }
        throw error;
      });
  };

  const apiFetch = async (
    path: string,
    init?: RequestInit,
  ): Promise<Response> => {
    const scope = captureAuthScope();
    const requestHeaders = (): Record<string, string> => ({
      ...((init?.headers as Record<string, string>) || {}),
      ...dependencies.getApiAuthHeaders(),
    });
    const request = () =>
      fetch(`${scope.apiBase}${path}`, {
        ...init,
        credentials: dependencies.apiCredentials(),
        headers: requestHeaders(),
      });
    let response = await request();
    if (
      response.status === 401 &&
      shouldAttemptRefresh(path) &&
      (await refreshAuthScope(scope)) &&
      isCurrentScope(scope)
    ) {
      response = await request();
    }
    if (response.status === 401 && isCurrentScope(scope)) {
      redirectAfterUnauthorized();
    }
    return response;
  };

  return {
    api,
    apiFetch,
    ensureFreshAuthToken,
    refreshAuthToken,
  };
}
