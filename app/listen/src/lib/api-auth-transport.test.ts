import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../../shared/web/api";
import { createApiAuthTransport } from "@/lib/api-auth-transport";

afterEach(() => {
  vi.restoreAllMocks();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function refreshResponse(token: string, refreshToken: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      token,
      refresh_token: refreshToken,
      access_expires_at: "2030-01-01T00:00:00Z",
    }),
  } as Response;
}

describe("createApiAuthTransport configurable-server refresh", () => {
  it("does not let a stale refresh overwrite a newer session on the same server", async () => {
    const session = {
      token: "access-a",
      refreshToken: "refresh-a",
    };
    const response = deferred<Response>();
    vi.spyOn(globalThis, "fetch").mockReturnValue(response.promise);
    const setAuthTokensForServer = vi.fn(
      (
        _serverId: string,
        token: string | null,
        refreshToken?: string | null,
      ) => {
        session.token = token ?? "";
        session.refreshToken = refreshToken ?? "";
        return true;
      },
    );
    const transport = createApiAuthTransport({
      apiBase: () => "https://a.example.com",
      apiClient: vi.fn(),
      apiCredentials: () => "omit",
      getApiAuthHeaders: () => ({ Authorization: `Bearer ${session.token}` }),
      getAuthToken: () => session.token,
      getAuthTokenExpiresAt: () => null,
      getCurrentServerId: () => "server-a",
      getRefreshToken: () => session.refreshToken,
      getServerAuthTokens: () => ({ ...session }),
      setAuthToken: vi.fn(),
      setAuthTokens: vi.fn(),
      setAuthTokensForServer,
      usesConfigurableServer: true,
    });

    const refresh = transport.refreshAuthToken();
    session.token = "access-b";
    session.refreshToken = "refresh-b";
    response.resolve(refreshResponse("stale-access-a", "stale-refresh-a"));

    await expect(refresh).resolves.toBe(false);
    expect(session).toEqual({ token: "access-b", refreshToken: "refresh-b" });
    expect(setAuthTokensForServer).not.toHaveBeenCalled();
  });

  it("does not let a stale rejected refresh clear a newer session", async () => {
    const session = {
      token: "access-a",
      refreshToken: "refresh-a",
    };
    const response = deferred<Response>();
    vi.spyOn(globalThis, "fetch").mockReturnValue(response.promise);
    const setAuthTokensForServer = vi.fn(() => true);
    const transport = createApiAuthTransport({
      apiBase: () => "https://a.example.com",
      apiClient: vi.fn(),
      apiCredentials: () => "omit",
      getApiAuthHeaders: () => ({ Authorization: `Bearer ${session.token}` }),
      getAuthToken: () => session.token,
      getAuthTokenExpiresAt: () => null,
      getCurrentServerId: () => "server-a",
      getRefreshToken: () => session.refreshToken,
      getServerAuthTokens: () => ({ ...session }),
      setAuthToken: vi.fn(),
      setAuthTokens: vi.fn(),
      setAuthTokensForServer,
      usesConfigurableServer: true,
    });

    const refresh = transport.refreshAuthToken();
    session.token = "access-b";
    session.refreshToken = "refresh-b";
    response.resolve({ ok: false, status: 401 } as Response);

    await expect(refresh).resolves.toBe(false);
    expect(setAuthTokensForServer).not.toHaveBeenCalled();
  });

  it("isolates concurrent refreshes when the active server changes", async () => {
    let currentServerId = "server-a";
    const servers: Record<
      string,
      { url: string; token: string; refreshToken: string }
    > = {
      "server-a": {
        url: "https://a.example.com",
        token: "access-a",
        refreshToken: "refresh-a",
      },
      "server-b": {
        url: "https://b.example.com",
        token: "access-b",
        refreshToken: "refresh-b",
      },
    };
    const firstResponse = deferred<Response>();
    const secondResponse = deferred<Response>();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockReturnValueOnce(firstResponse.promise)
      .mockReturnValueOnce(secondResponse.promise);
    const storedTokens = new Map<string, string>();
    const currentServer = () => servers[currentServerId]!;

    const transport = createApiAuthTransport({
      apiBase: () => currentServer().url,
      apiClient: vi.fn(),
      apiCredentials: () => "omit",
      getApiAuthHeaders: () => ({
        Authorization: `Bearer ${currentServer().token}`,
      }),
      getAuthToken: () => currentServer().token,
      getAuthTokenExpiresAt: () => null,
      getCurrentServerId: () => currentServerId,
      getRefreshToken: () => currentServer().refreshToken,
      getServerAuthTokens: (serverId) => {
        const server = servers[serverId];
        return server
          ? { token: server.token, refreshToken: server.refreshToken }
          : null;
      },
      setAuthToken: vi.fn(),
      setAuthTokens: vi.fn(),
      setAuthTokensForServer: (serverId, token) => {
        if (token) storedTokens.set(serverId, token);
        return true;
      },
      usesConfigurableServer: true,
    });

    const refreshA = transport.refreshAuthToken();
    currentServerId = "server-b";
    const refreshB = transport.refreshAuthToken();

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    firstResponse.resolve(refreshResponse("new-access-a", "new-refresh-a"));
    secondResponse.resolve(refreshResponse("new-access-b", "new-refresh-b"));

    await expect(Promise.all([refreshA, refreshB])).resolves.toEqual([
      true,
      true,
    ]);
    expect(storedTokens).toEqual(
      new Map([
        ["server-a", "new-access-a"],
        ["server-b", "new-access-b"],
      ]),
    );
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      "https://a.example.com/api/auth/refresh",
      "https://b.example.com/api/auth/refresh",
    ]);
  });

  it("does not leak or retry credentials when the server changes after a 401", async () => {
    let currentServerId = "server-a";
    const servers: Record<
      string,
      { url: string; token: string; refreshToken: string }
    > = {
      "server-a": {
        url: "https://a.example.com",
        token: "access-a",
        refreshToken: "refresh-a",
      },
      "server-b": {
        url: "https://b.example.com",
        token: "access-b",
        refreshToken: "refresh-b",
      },
    };
    let rejectRequest!: (error: Error) => void;
    const apiClient = vi.fn(
      () =>
        new Promise<never>((_, reject) => {
          rejectRequest = reject;
        }),
    );
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(refreshResponse("new-access-a", "new-refresh-a"));
    const currentServer = () => servers[currentServerId]!;

    const transport = createApiAuthTransport({
      apiBase: () => currentServer().url,
      apiClient,
      apiCredentials: () => "omit",
      getApiAuthHeaders: () => ({
        Authorization: `Bearer ${currentServer().token}`,
      }),
      getAuthToken: () => currentServer().token,
      getAuthTokenExpiresAt: () => null,
      getCurrentServerId: () => currentServerId,
      getRefreshToken: () => currentServer().refreshToken,
      getServerAuthTokens: (serverId) => {
        const server = servers[serverId];
        return server
          ? { token: server.token, refreshToken: server.refreshToken }
          : null;
      },
      setAuthToken: vi.fn(),
      setAuthTokens: vi.fn(),
      setAuthTokensForServer: vi.fn(() => true),
      usesConfigurableServer: true,
    });

    const request = transport.api("/api/library");
    currentServerId = "server-b";
    rejectRequest(new ApiError(401, "expired"));

    await expect(request).rejects.toThrow("expired");
    expect(apiClient).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://a.example.com/api/auth/refresh",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer access-a",
        }),
        body: JSON.stringify({ refresh_token: "refresh-a" }),
      }),
    );
  });
});
