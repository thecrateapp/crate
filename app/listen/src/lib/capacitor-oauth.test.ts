import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../../shared/web/api";

const mocks = vi.hoisted(() => ({
  apiForServerMock: vi.fn(),
  setAuthTokensForServer: vi.fn(() => true),
  getCurrentServerId: vi.fn<() => string | null>(() => null),
  getServers: vi.fn<() => Array<{ id: string }>>(() => []),
  setCurrentServerId: vi.fn(),
  waitForPendingSecureSessionWrites: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  apiForServer: mocks.apiForServerMock,
  setAuthTokensForServer: mocks.setAuthTokensForServer,
  setAuthTokens: vi.fn(),
}));

vi.mock("@/lib/native-secure-session", () => ({
  getSecureSessionValue: vi.fn(),
  setSecureSessionValue: vi.fn(),
  removeSecureSessionValue: vi.fn(),
}));

vi.mock("@/lib/platform", () => ({
  isTauriRuntime: true,
}));

vi.mock("@/lib/server-store", () => ({
  waitForPendingSecureSessionWrites: mocks.waitForPendingSecureSessionWrites,
  getCurrentServerId: mocks.getCurrentServerId,
  getServers: mocks.getServers,
  setCurrentServerId: mocks.setCurrentServerId,
}));

import {
  beginNativeOAuth,
  consumeOAuthCallbackUrl,
  retryPendingNativeOAuthCallback,
} from "@/lib/capacitor-oauth";

// Tauri desktop has no OS-backed secure session plugin, so its PKCE
// verifier record is kept in localStorage instead — otherwise it's the
// exact same beginNativeOAuth/exchangeNativeOAuthCallback flow mobile
// uses (capacitor.test.ts covers the Capacitor/secure-session side).
describe("desktop (Tauri) native OAuth via localStorage", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.apiForServerMock.mockReset();
    mocks.setAuthTokensForServer.mockReset().mockReturnValue(true);
    mocks.getCurrentServerId.mockReset().mockReturnValue("server-a");
    mocks.getServers.mockReset().mockReturnValue([{ id: "server-a" }]);
    mocks.setCurrentServerId.mockReset();
    mocks.waitForPendingSecureSessionWrites
      .mockReset()
      .mockResolvedValue(undefined);
  });

  it("starts native OAuth and persists the PKCE verifier to localStorage", async () => {
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
    expect(localStorage.getItem(`crate.oauth.${stateArg}`)).toContain(
      '"next":"/library"',
    );
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
    localStorage.setItem(
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
    expect(localStorage.getItem(`crate.oauth.${state}`)).toBeNull();
  });

  it("keeps the PKCE verifier when exchange fails transiently", async () => {
    const state = "s".repeat(32);
    const recordKey = `crate.oauth.${state}`;
    localStorage.setItem(
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
    expect(localStorage.getItem(recordKey)).not.toBeNull();

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
    localStorage.setItem(
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
    expect(localStorage.getItem(recordKey)).not.toBeNull();

    await expect(retryPendingNativeOAuthCallback()).resolves.toEqual({
      handled: true,
      next: "/library",
    });
    expect(mocks.apiForServerMock).toHaveBeenCalledTimes(2);
  });

  it("keeps a retryable callback when an unrelated stale deep link arrives", async () => {
    const retryableState = "a".repeat(32);
    localStorage.setItem(
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

  it("removes the PKCE verifier when exchange rejects the handoff", async () => {
    const state = "s".repeat(32);
    const recordKey = `crate.oauth.${state}`;
    localStorage.setItem(
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
    expect(localStorage.getItem(recordKey)).toBeNull();
  });

  it("discards a corrupt PKCE record instead of retrying it forever", async () => {
    const state = "s".repeat(32);
    const recordKey = `crate.oauth.${state}`;
    localStorage.setItem(recordKey, "{not-json");

    const result = await consumeOAuthCallbackUrl(
      `cratemusic://oauth/callback?code=one-time-code&state=${state}`,
    );

    expect(result).toEqual({ handled: false, next: "/" });
    expect(localStorage.getItem(recordKey)).toBeNull();
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
    localStorage.setItem(
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
    localStorage.setItem(
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
    localStorage.setItem(
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
    localStorage.setItem(
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
    localStorage.setItem(
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
});
