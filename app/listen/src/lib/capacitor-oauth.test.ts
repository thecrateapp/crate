import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../../shared/web/api";

const mocks = vi.hoisted(() => ({
  secureSessionValues: new Map<string, string>(),
  getSecureSessionValue: vi.fn(
    async (key: string) => mocks.secureSessionValues.get(key) ?? null,
  ),
  setSecureSessionValue: vi.fn(async (key: string, value: string) => {
    mocks.secureSessionValues.set(key, value);
  }),
  removeSecureSessionValue: vi.fn(async (key: string) => {
    mocks.secureSessionValues.delete(key);
  }),
  apiMock: vi.fn(),
  apiForServerMock: vi.fn(),
  openExternalUrlMock: vi.fn(),
  setAuthTokensForServer: vi.fn(() => true),
  getCurrentServerId: vi.fn<() => string | null>(() => null),
  getServers: vi.fn<() => Array<{ id: string; token?: string | null }>>(
    () => [],
  ),
  setCurrentServerId: vi.fn(),
  waitForPendingSecureSessionWrites: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: mocks.apiMock,
  apiForServer: mocks.apiForServerMock,
  setAuthTokensForServer: mocks.setAuthTokensForServer,
  setAuthTokens: vi.fn(),
}));

vi.mock("@/lib/native-secure-session", () => ({
  getSecureSessionValue: mocks.getSecureSessionValue,
  setSecureSessionValue: mocks.setSecureSessionValue,
  removeSecureSessionValue: mocks.removeSecureSessionValue,
}));

vi.mock("@/lib/auth-session", () => ({
  AUTH_TOKEN_EVENT: "crate:auth-token-updated",
}));

vi.mock("@/lib/platform", () => ({
  isTauriRuntime: true,
}));

vi.mock("@/lib/external-links", () => ({
  openExternalUrl: mocks.openExternalUrlMock,
}));

vi.mock("@/lib/server-store", () => ({
  SERVER_STORE_EVENT: "crate-server-store-change",
  waitForPendingSecureSessionWrites: mocks.waitForPendingSecureSessionWrites,
  getCurrentServerId: mocks.getCurrentServerId,
  getServers: mocks.getServers,
  setCurrentServerId: mocks.setCurrentServerId,
}));

import {
  beginNativeOAuth,
  beginNativeOAuthLink,
  consumeOAuthCallbackUrl,
  migrateLegacyTauriOAuthRecords,
  retryPendingNativeOAuthLinkCallback,
  retryPendingNativeOAuthCallback,
} from "@/lib/capacitor-oauth";

function tokenFor(userId: number, sessionId: string, expiresAt = 1): string {
  const payload = btoa(
    JSON.stringify({ user_id: userId, sid: sessionId, exp: expiresAt }),
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `header.${payload}.signature`;
}

function currentServer(token = tokenFor(42, "session-a")) {
  return { id: "server-a", token };
}

function seedSecureRecord(key: string, value: string): void {
  mocks.secureSessionValues.set(key, value);
}

function secureRecord(key: string): string | null {
  return mocks.secureSessionValues.get(key) ?? null;
}

describe("desktop (Tauri) native OAuth via secure storage", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.secureSessionValues.clear();
    mocks.getSecureSessionValue.mockClear();
    mocks.setSecureSessionValue.mockClear();
    mocks.removeSecureSessionValue.mockClear();
    mocks.apiMock.mockReset();
    mocks.apiForServerMock.mockReset();
    mocks.openExternalUrlMock.mockReset().mockResolvedValue(undefined);
    mocks.setAuthTokensForServer.mockReset().mockReturnValue(true);
    mocks.getCurrentServerId.mockReset().mockReturnValue("server-a");
    mocks.getServers.mockReset().mockReturnValue([currentServer()]);
    mocks.setCurrentServerId.mockReset();
    mocks.waitForPendingSecureSessionWrites
      .mockReset()
      .mockResolvedValue(undefined);
  });

  it("migrates legacy desktop OAuth records only after secure verification", async () => {
    const key = `crate.oauth.${"m".repeat(32)}`;
    const value = JSON.stringify({
      verifier: "v".repeat(43),
      next: "/library",
      createdAt: Date.now(),
      serverId: "server-a",
    });
    localStorage.setItem(key, value);
    localStorage.setItem("crate.oauth.link.generation", "4");

    await migrateLegacyTauriOAuthRecords();

    expect(secureRecord(key)).toBe(value);
    expect(localStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem("crate.oauth.link.generation")).toBe("4");
  });

  it("keeps legacy OAuth records when secure migration fails", async () => {
    const key = `crate.oauth.${"n".repeat(32)}`;
    const value = JSON.stringify({
      verifier: "v".repeat(43),
      next: "/library",
      createdAt: Date.now(),
      serverId: "server-a",
    });
    localStorage.setItem(key, value);
    mocks.setSecureSessionValue.mockRejectedValueOnce(
      new Error("secure store locked"),
    );

    await expect(migrateLegacyTauriOAuthRecords()).rejects.toThrow(
      "Native OAuth migration failed",
    );

    expect(localStorage.getItem(key)).toBe(value);
  });

  it("keeps a newer secure OAuth record when stale plaintext remains", async () => {
    const key = `crate.oauth.${"o".repeat(32)}`;
    const stale = JSON.stringify({ verifier: "old", createdAt: 1 });
    const current = JSON.stringify({ verifier: "new", createdAt: 2 });
    localStorage.setItem(key, stale);
    seedSecureRecord(key, current);

    await migrateLegacyTauriOAuthRecords();

    expect(secureRecord(key)).toBe(current);
    expect(localStorage.getItem(key)).toBeNull();
    expect(mocks.setSecureSessionValue).not.toHaveBeenCalled();
  });

  it("keeps both verified secure data and plaintext if removing the old copy fails", async () => {
    const key = `crate.oauth.${"p".repeat(32)}`;
    const value = JSON.stringify({
      verifier: "v".repeat(43),
      next: "/library",
      createdAt: Date.now(),
      serverId: "server-a",
    });
    localStorage.setItem(key, value);
    const originalRemoveItem = localStorage.removeItem.bind(localStorage);
    const removeItem = vi
      .spyOn(localStorage, "removeItem")
      .mockImplementation((candidate) => {
        if (candidate === key) throw new Error("storage unavailable");
        originalRemoveItem(candidate);
      });

    await expect(migrateLegacyTauriOAuthRecords()).rejects.toThrow(
      "Native OAuth migration failed",
    );

    expect(secureRecord(key)).toBe(value);
    expect(localStorage.getItem(key)).toBe(value);
    removeItem.mockRestore();

    await migrateLegacyTauriOAuthRecords();

    expect(localStorage.getItem(key)).toBeNull();
    expect(secureRecord(key)).toBe(value);
  });

  it("starts native OAuth and persists the PKCE verifier to secure storage", async () => {
    mocks.apiForServerMock.mockResolvedValue({
      provider: "google",
      login_url: "https://accounts.example/authorize",
    });

    const loginUrl = await beginNativeOAuth("google", "/library");

    expect(loginUrl).toBe("https://accounts.example/authorize");
    expect(mocks.apiForServerMock).toHaveBeenCalledWith(
      "server-a",
      "/api/auth/oauth/google/start",
      "POST",
      expect.objectContaining({
        return_to: "cratemusic://oauth/callback",
        native_code_challenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        native_state: expect.stringMatching(/^[A-Za-z0-9_-]{16,}$/),
      }),
    );

    const stateArg = mocks.apiForServerMock.mock.calls[0]?.[3]
      .native_state as string;
    expect(secureRecord(`crate.oauth.${stateArg}`)).toContain(
      '"next":"/library"',
    );
    expect(localStorage.getItem(`crate.oauth.${stateArg}`)).toBeNull();
  });

  it("rolls back the stored verifier if the start request fails", async () => {
    mocks.apiForServerMock.mockRejectedValue(new Error("network error"));

    await expect(beginNativeOAuth("google", "/library")).rejects.toThrow(
      "network error",
    );

    expect(localStorage.length).toBe(0);
  });

  it("exchanges the one-time code from the cratemusic:// deep link", async () => {
    const state = "s".repeat(32);
    seedSecureRecord(
      `crate.oauth.${state}`,
      JSON.stringify({
        verifier: "v".repeat(43),
        next: "/stats",
        createdAt: Date.now(),
        serverId: "server-a",
      }),
    );
    mocks.apiForServerMock.mockResolvedValue({
      token: "access-token",
      refresh_token: "refresh-token",
      access_expires_at: "2030-01-01T00:00:00Z",
    });

    const result = await consumeOAuthCallbackUrl(
      `cratemusic://oauth/callback?code=one-time-code&state=${state}`,
    );

    expect(result).toEqual({ handled: true, next: "/stats" });
    expect(mocks.apiForServerMock).toHaveBeenCalledWith(
      "server-a",
      "/api/auth/native/exchange",
      "POST",
      {
        code: "one-time-code",
        code_verifier: "v".repeat(43),
        state,
      },
    );
    expect(mocks.setAuthTokensForServer).toHaveBeenCalledWith(
      "server-a",
      "access-token",
      "refresh-token",
      "2030-01-01T00:00:00Z",
    );
    // The one-time verifier record must not survive a successful exchange.
    expect(secureRecord(`crate.oauth.${state}`)).toBeNull();
  });

  it("keeps the PKCE verifier when exchange fails transiently", async () => {
    const state = "s".repeat(32);
    const recordKey = `crate.oauth.${state}`;
    seedSecureRecord(
      recordKey,
      JSON.stringify({
        verifier: "v".repeat(43),
        next: "/library",
        createdAt: Date.now(),
        serverId: "server-a",
      }),
    );
    mocks.apiForServerMock.mockRejectedValue(
      new ApiError(503, "exchange unavailable"),
    );

    const result = await consumeOAuthCallbackUrl(
      `cratemusic://oauth/callback?code=one-time-code&state=${state}`,
    );

    expect(result).toEqual({ handled: false, next: "/", retryable: true });
    expect(secureRecord(recordKey)).not.toBeNull();

    mocks.apiForServerMock.mockResolvedValue({ token: "access-token" });
    await expect(retryPendingNativeOAuthCallback()).resolves.toEqual({
      handled: true,
      next: "/library",
    });
    expect(mocks.apiForServerMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the callback retryable when secure session persistence fails", async () => {
    const state = "s".repeat(32);
    const recordKey = `crate.oauth.${state}`;
    seedSecureRecord(
      recordKey,
      JSON.stringify({
        verifier: "v".repeat(43),
        next: "/library",
        createdAt: Date.now(),
        serverId: "server-a",
      }),
    );
    mocks.apiForServerMock.mockResolvedValue({ token: "access-token" });
    mocks.waitForPendingSecureSessionWrites
      .mockRejectedValueOnce(new Error("keychain unavailable"))
      .mockResolvedValue(undefined);

    await expect(
      consumeOAuthCallbackUrl(
        `cratemusic://oauth/callback?code=one-time-code&state=${state}`,
      ),
    ).resolves.toEqual({ handled: false, next: "/", retryable: true });
    expect(secureRecord(recordKey)).not.toBeNull();

    await expect(retryPendingNativeOAuthCallback()).resolves.toEqual({
      handled: true,
      next: "/library",
    });
    expect(mocks.apiForServerMock).toHaveBeenCalledTimes(2);
  });

  it("keeps a retryable callback when an unrelated stale deep link arrives", async () => {
    const retryableState = "a".repeat(32);
    seedSecureRecord(
      `crate.oauth.${retryableState}`,
      JSON.stringify({
        verifier: "v".repeat(43),
        next: "/library",
        createdAt: Date.now(),
        serverId: "server-a",
      }),
    );
    mocks.apiForServerMock.mockRejectedValueOnce(
      new ApiError(503, "exchange unavailable"),
    );

    await expect(
      consumeOAuthCallbackUrl(
        `cratemusic://oauth/callback?code=retryable-code&state=${retryableState}`,
      ),
    ).resolves.toEqual({ handled: false, next: "/", retryable: true });

    await expect(
      consumeOAuthCallbackUrl(
        `cratemusic://oauth/callback?code=stale-code&state=${"b".repeat(32)}`,
      ),
    ).resolves.toEqual({ handled: false, next: "/" });

    mocks.apiForServerMock.mockResolvedValue({ token: "access-token" });
    await expect(retryPendingNativeOAuthCallback()).resolves.toEqual({
      handled: true,
      next: "/library",
    });
    expect(mocks.apiForServerMock).toHaveBeenLastCalledWith(
      "server-a",
      "/api/auth/native/exchange",
      "POST",
      expect.objectContaining({
        code: "retryable-code",
        state: retryableState,
      }),
    );
  });

  it("continues past a retryable callback to recover another server", async () => {
    const firstState = "a".repeat(32);
    const secondState = "b".repeat(32);
    const now = Date.now();
    seedSecureRecord(
      `crate.oauth.${firstState}`,
      JSON.stringify({
        verifier: "v".repeat(43),
        next: "/first",
        createdAt: now,
        serverId: "server-a",
      }),
    );
    seedSecureRecord(
      `crate.oauth.${secondState}`,
      JSON.stringify({
        verifier: "w".repeat(43),
        next: "/second",
        createdAt: now + 1,
        serverId: "server-b",
      }),
    );
    seedSecureRecord(
      "crate.oauth.pending-callback",
      JSON.stringify({
        version: 1,
        callbacks: [
          { code: "first-code", state: firstState, createdAt: now },
          { code: "second-code", state: secondState, createdAt: now + 1 },
        ],
      }),
    );
    mocks.getServers.mockReturnValue([{ id: "server-a" }, { id: "server-b" }]);
    mocks.apiForServerMock
      .mockRejectedValueOnce(new ApiError(503, "first server unavailable"))
      .mockResolvedValueOnce({ token: "second-token" });

    await expect(retryPendingNativeOAuthCallback()).resolves.toEqual({
      handled: true,
      next: "/second",
    });

    expect(mocks.apiForServerMock).toHaveBeenCalledTimes(2);
    expect(secureRecord(`crate.oauth.${firstState}`)).not.toBeNull();
    expect(secureRecord(`crate.oauth.${secondState}`)).toBeNull();
    expect(secureRecord("crate.oauth.pending-callback")).toContain(firstState);
    expect(secureRecord("crate.oauth.pending-callback")).not.toContain(
      secondState,
    );
  });

  it("removes the PKCE verifier when exchange rejects the handoff", async () => {
    const state = "s".repeat(32);
    const recordKey = `crate.oauth.${state}`;
    seedSecureRecord(
      recordKey,
      JSON.stringify({
        verifier: "v".repeat(43),
        next: "/library",
        createdAt: Date.now(),
        serverId: "server-a",
      }),
    );
    mocks.apiForServerMock.mockRejectedValue(
      new ApiError(401, "handoff rejected"),
    );

    const result = await consumeOAuthCallbackUrl(
      `cratemusic://oauth/callback?code=one-time-code&state=${state}`,
    );

    expect(result).toEqual({ handled: false, next: "/" });
    expect(secureRecord(recordKey)).toBeNull();
  });

  it("discards a corrupt PKCE record instead of retrying it forever", async () => {
    const state = "s".repeat(32);
    const recordKey = `crate.oauth.${state}`;
    seedSecureRecord(recordKey, "{not-json");

    const result = await consumeOAuthCallbackUrl(
      `cratemusic://oauth/callback?code=one-time-code&state=${state}`,
    );

    expect(result).toEqual({ handled: false, next: "/" });
    expect(secureRecord(recordKey)).toBeNull();
    expect(mocks.apiForServerMock).not.toHaveBeenCalled();
    await expect(retryPendingNativeOAuthCallback()).resolves.toEqual({
      handled: false,
      next: "/",
    });
  });

  it("rejects a callback whose state has no matching stored verifier", async () => {
    const result = await consumeOAuthCallbackUrl(
      "cratemusic://oauth/callback?code=one-time-code&state=unknown-state",
    );

    expect(result).toEqual({ handled: false, next: "/" });
    expect(mocks.setAuthTokensForServer).not.toHaveBeenCalled();
  });

  it("restores the server the flow was started against if the user switched servers meanwhile", async () => {
    const state = "s".repeat(32);
    seedSecureRecord(
      `crate.oauth.${state}`,
      JSON.stringify({
        verifier: "v".repeat(43),
        next: "/library",
        createdAt: Date.now(),
        serverId: "server-a",
      }),
    );
    mocks.getCurrentServerId.mockReturnValue("server-b");
    mocks.getServers.mockReturnValue([{ id: "server-a" }, { id: "server-b" }]);
    mocks.apiForServerMock.mockResolvedValue({ token: "access-token" });

    const result = await consumeOAuthCallbackUrl(
      `cratemusic://oauth/callback?code=one-time-code&state=${state}`,
    );

    expect(result).toEqual({ handled: true, next: "/library" });
    expect(mocks.apiForServerMock).toHaveBeenCalledWith(
      "server-a",
      "/api/auth/native/exchange",
      "POST",
      expect.any(Object),
    );
    expect(mocks.setAuthTokensForServer).toHaveBeenCalledWith(
      "server-a",
      "access-token",
      undefined,
      undefined,
    );
    expect(mocks.setCurrentServerId).toHaveBeenCalledWith("server-a");
  });

  it("rejects the callback if the originating server was removed while the flow was in flight", async () => {
    const state = "s".repeat(32);
    seedSecureRecord(
      `crate.oauth.${state}`,
      JSON.stringify({
        verifier: "v".repeat(43),
        next: "/library",
        createdAt: Date.now(),
        serverId: "server-a",
      }),
    );
    // The user removed "server-a" from their server list mid-flow.
    mocks.getServers.mockReturnValue([{ id: "server-b" }]);
    mocks.apiForServerMock.mockResolvedValue({ token: "access-token" });

    const result = await consumeOAuthCallbackUrl(
      `cratemusic://oauth/callback?code=one-time-code&state=${state}`,
    );

    expect(result).toEqual({ handled: false, next: "/" });
    expect(mocks.setAuthTokensForServer).not.toHaveBeenCalled();
  });

  it("does not persist a token if the originating server disappears during exchange", async () => {
    const state = "s".repeat(32);
    seedSecureRecord(
      `crate.oauth.${state}`,
      JSON.stringify({
        verifier: "v".repeat(43),
        next: "/library",
        createdAt: Date.now(),
        serverId: "server-a",
      }),
    );
    mocks.apiForServerMock.mockImplementation(async () => {
      mocks.getServers.mockReturnValue([]);
      return { token: "access-token" };
    });
    mocks.setAuthTokensForServer.mockReturnValue(false);

    const result = await consumeOAuthCallbackUrl(
      `cratemusic://oauth/callback?code=one-time-code&state=${state}`,
    );

    expect(result).toEqual({ handled: false, next: "/" });
    expect(mocks.setAuthTokensForServer).toHaveBeenCalledWith(
      "server-a",
      "access-token",
      undefined,
      undefined,
    );
  });

  it("does not reactivate a server removed while its token is being persisted", async () => {
    const state = "s".repeat(32);
    seedSecureRecord(
      `crate.oauth.${state}`,
      JSON.stringify({
        verifier: "v".repeat(43),
        next: "/library",
        createdAt: Date.now(),
        serverId: "server-a",
      }),
    );
    mocks.apiForServerMock.mockResolvedValue({ token: "access-token" });
    mocks.waitForPendingSecureSessionWrites.mockImplementation(async () => {
      mocks.getServers.mockReturnValue([]);
    });

    const result = await consumeOAuthCallbackUrl(
      `cratemusic://oauth/callback?code=one-time-code&state=${state}`,
    );

    expect(result).toEqual({ handled: false, next: "/" });
    expect(mocks.setCurrentServerId).not.toHaveBeenCalled();
    expect(localStorage.getItem("crate-oauth-next")).toBeNull();
  });

  it("exchanges a duplicated deep link only once", async () => {
    const state = "s".repeat(32);
    seedSecureRecord(
      `crate.oauth.${state}`,
      JSON.stringify({
        verifier: "v".repeat(43),
        next: "/library",
        createdAt: Date.now(),
        serverId: "server-a",
      }),
    );
    let resolveExchange: ((value: { token: string }) => void) | undefined;
    mocks.apiForServerMock.mockReturnValue(
      new Promise((resolve) => {
        resolveExchange = resolve;
      }),
    );

    const callback = `cratemusic://oauth/callback?code=one-time-code&state=${state}`;
    const first = consumeOAuthCallbackUrl(callback);
    const duplicate = consumeOAuthCallbackUrl(callback);
    await expect(duplicate).resolves.toEqual({ handled: false, next: "/" });
    resolveExchange!({ token: "access-token" });
    await expect(first).resolves.toEqual({ handled: true, next: "/library" });

    expect(mocks.apiForServerMock).toHaveBeenCalledTimes(1);
  });

  it("starts account linking with the active session and keeps its verifier local", async () => {
    mocks.apiMock.mockResolvedValue({
      login_url: "https://accounts.example/authorize",
    });

    await beginNativeOAuthLink("google", 42);

    expect(mocks.apiMock).toHaveBeenCalledWith(
      "/api/auth/oauth/google/native-link/start",
      "POST",
      expect.objectContaining({
        native_code_challenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        native_state: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      }),
    );
    const state = mocks.apiMock.mock.calls[0]?.[2].native_state as string;
    const record = JSON.parse(
      secureRecord(`crate.oauth.link.${state}`) ?? "null",
    ) as Record<string, unknown>;
    expect(record).toMatchObject({
      serverId: "server-a",
      userId: 42,
      sessionId: "session-a",
      provider: "google",
    });
    expect(record.verifier).toEqual(
      expect.stringMatching(/^[A-Za-z0-9_-]{86}$/),
    );
    expect(JSON.stringify(record)).not.toContain("signature");
    expect(mocks.openExternalUrlMock).toHaveBeenCalledWith(
      "https://accounts.example/authorize",
    );
    expect(mocks.apiForServerMock).not.toHaveBeenCalled();
  });

  it("does not open the provider if the account changes during the start request", async () => {
    let resolveStart: ((value: { login_url: string }) => void) | undefined;
    mocks.apiMock.mockReturnValue(
      new Promise<{ login_url: string }>((resolve) => {
        resolveStart = resolve;
      }),
    );

    const starting = beginNativeOAuthLink("google", 42);
    await vi.waitFor(() => expect(mocks.apiMock).toHaveBeenCalledTimes(1));
    const state = mocks.apiMock.mock.calls[0]?.[2].native_state as string;
    mocks.getServers.mockReturnValue([
      currentServer(tokenFor(42, "new-session")),
    ]);
    window.dispatchEvent(new CustomEvent("crate:auth-token-updated"));
    resolveStart?.({ login_url: "https://accounts.example/authorize" });

    await expect(starting).rejects.toThrow(/active account or server changed/);
    expect(mocks.openExternalUrlMock).not.toHaveBeenCalled();
    expect(secureRecord(`crate.oauth.link.${state}`)).toBeNull();
  });

  it("completes a link callback with only the opaque handoff proof", async () => {
    mocks.apiMock.mockResolvedValueOnce({
      login_url: "https://accounts.example/authorize",
    });
    await beginNativeOAuthLink("apple", 42);
    const state = mocks.apiMock.mock.calls[0]?.[2].native_state as string;
    mocks.apiMock.mockResolvedValueOnce({ status: "linked" });

    await expect(
      consumeOAuthCallbackUrl(
        `cratemusic://oauth/link-callback?code=${"c".repeat(
          43,
        )}&state=${state}`,
      ),
    ).resolves.toEqual({
      handled: true,
      next: "/settings",
      operation: "link",
      provider: "apple",
      userId: 42,
    });
    expect(mocks.apiMock).toHaveBeenLastCalledWith(
      "/api/auth/oauth/native-link/complete",
      "POST",
      {
        code: "c".repeat(43),
        code_verifier: expect.stringMatching(/^[A-Za-z0-9_-]{86}$/),
        state,
      },
    );
    expect(JSON.stringify(mocks.apiMock.mock.calls[1]?.[2])).not.toContain(
      "session-a",
    );
    expect(secureRecord(`crate.oauth.link.${state}`)).toBeNull();
    expect(mocks.setAuthTokensForServer).not.toHaveBeenCalled();
  });

  it("exchanges a duplicate native link callback only once", async () => {
    mocks.apiMock.mockResolvedValueOnce({
      login_url: "https://accounts.example/authorize",
    });
    await beginNativeOAuthLink("google", 42);
    const state = mocks.apiMock.mock.calls[0]?.[2].native_state as string;
    let resolveCompletion: ((value: { ok: boolean }) => void) | undefined;
    mocks.apiMock.mockReturnValueOnce(
      new Promise<{ ok: boolean }>((resolve) => {
        resolveCompletion = resolve;
      }),
    );
    const callback = `cratemusic://oauth/link-callback?code=${"j".repeat(
      43,
    )}&state=${state}`;
    const first = consumeOAuthCallbackUrl(callback);
    await vi.waitFor(() => expect(mocks.apiMock).toHaveBeenCalledTimes(2));

    await expect(consumeOAuthCallbackUrl(callback)).resolves.toEqual({
      handled: false,
      next: "/",
    });
    resolveCompletion?.({ ok: true });

    await expect(first).resolves.toMatchObject({
      handled: true,
      operation: "link",
      userId: 42,
    });
    expect(mocks.apiMock).toHaveBeenCalledTimes(2);
  });

  it("does not complete a pending link after switching the active server", async () => {
    mocks.apiMock.mockResolvedValue({
      login_url: "https://accounts.example/authorize",
    });
    await beginNativeOAuthLink("google", 42);
    const state = mocks.apiMock.mock.calls[0]?.[2].native_state as string;
    mocks.getCurrentServerId.mockReturnValue("server-b");
    mocks.getServers.mockReturnValue([
      currentServer(),
      { id: "server-b", token: tokenFor(84, "session-b") },
    ]);
    window.dispatchEvent(new CustomEvent("crate-server-store-change"));

    await expect(
      consumeOAuthCallbackUrl(
        `cratemusic://oauth/link-callback?code=${"d".repeat(
          43,
        )}&state=${state}`,
      ),
    ).resolves.toMatchObject({
      handled: true,
      operation: "link",
      provider: "google",
      userId: 42,
      error: true,
    });
    expect(mocks.apiMock).toHaveBeenCalledTimes(1);
    expect(secureRecord(`crate.oauth.link.${state}`)).toBeNull();
  });

  it("allows completion after an access token refresh with the same session ID", async () => {
    mocks.apiMock.mockResolvedValueOnce({
      login_url: "https://accounts.example/authorize",
    });
    await beginNativeOAuthLink("google", 42);
    const state = mocks.apiMock.mock.calls[0]?.[2].native_state as string;
    mocks.getServers.mockReturnValue([
      currentServer(tokenFor(42, "session-a", 2)),
    ]);
    window.dispatchEvent(new CustomEvent("crate:auth-token-updated"));
    mocks.apiMock.mockResolvedValueOnce({ status: "linked" });

    await expect(
      consumeOAuthCallbackUrl(
        `cratemusic://oauth/link-callback?code=${"e".repeat(
          43,
        )}&state=${state}`,
      ),
    ).resolves.toMatchObject({ handled: true, operation: "link" });
    expect(mocks.apiMock).toHaveBeenCalledTimes(2);
  });

  it("retries a transient native link completion without merging it into login callbacks", async () => {
    mocks.apiMock
      .mockResolvedValueOnce({
        login_url: "https://accounts.example/authorize",
      })
      .mockRejectedValueOnce(new ApiError(503, "link service unavailable"));
    await beginNativeOAuthLink("google", 42);
    const state = mocks.apiMock.mock.calls[0]?.[2].native_state as string;

    await expect(
      consumeOAuthCallbackUrl(
        `cratemusic://oauth/link-callback?code=${"f".repeat(
          43,
        )}&state=${state}`,
      ),
    ).resolves.toEqual({ handled: false, next: "/", retryable: true });
    expect(secureRecord("crate.oauth.link.pending-callback")).toContain(state);
    expect(secureRecord("crate.oauth.pending-callback")).toBeNull();

    mocks.apiMock.mockResolvedValueOnce({ status: "linked" });
    await expect(retryPendingNativeOAuthLinkCallback()).resolves.toMatchObject({
      handled: true,
      operation: "link",
      userId: 42,
    });
    expect(mocks.apiMock).toHaveBeenCalledTimes(3);
  });

  it("rejects a pending link after logout and a new session for the same user", async () => {
    mocks.apiMock.mockResolvedValue({
      login_url: "https://accounts.example/authorize",
    });
    await beginNativeOAuthLink("google", 42);
    const state = mocks.apiMock.mock.calls[0]?.[2].native_state as string;
    mocks.getServers.mockReturnValue([
      currentServer(tokenFor(42, "session-after-login")),
    ]);
    window.dispatchEvent(new CustomEvent("crate:auth-token-updated"));

    await expect(
      consumeOAuthCallbackUrl(
        `cratemusic://oauth/link-callback?code=${"g".repeat(
          43,
        )}&state=${state}`,
      ),
    ).resolves.toMatchObject({
      handled: true,
      operation: "link",
      userId: 42,
      error: true,
    });
    expect(mocks.apiMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces a permanent account conflict instead of retrying it", async () => {
    mocks.apiMock
      .mockResolvedValueOnce({
        login_url: "https://accounts.example/authorize",
      })
      .mockRejectedValueOnce(new ApiError(409, "identity already linked"));
    await beginNativeOAuthLink("google", 42);
    const state = mocks.apiMock.mock.calls[0]?.[2].native_state as string;

    await expect(
      consumeOAuthCallbackUrl(
        `cratemusic://oauth/link-callback?code=${"h".repeat(
          43,
        )}&state=${state}`,
      ),
    ).resolves.toMatchObject({
      handled: true,
      operation: "link",
      provider: "google",
      userId: 42,
      error: true,
    });
    expect(secureRecord("crate.oauth.link.pending-callback")).toBeNull();
  });

  it("clears the pending flow when the provider returns an authorization denial", async () => {
    mocks.apiMock.mockResolvedValue({
      login_url: "https://accounts.example/authorize",
    });
    await beginNativeOAuthLink("google", 42);
    const state = mocks.apiMock.mock.calls[0]?.[2].native_state as string;

    await expect(
      consumeOAuthCallbackUrl(
        `cratemusic://oauth/link-callback?state=${state}&error=cancelled`,
      ),
    ).resolves.toMatchObject({
      handled: true,
      operation: "link",
      provider: "google",
      userId: 42,
      error: true,
    });
    expect(mocks.apiMock).toHaveBeenCalledTimes(1);
    expect(secureRecord(`crate.oauth.link.${state}`)).toBeNull();
  });
});
