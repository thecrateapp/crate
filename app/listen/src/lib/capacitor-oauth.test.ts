import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiMock: vi.fn(),
  setAuthTokens: vi.fn(),
  getCurrentServerId: vi.fn<() => string | null>(() => null),
  setCurrentServerId: vi.fn(),
  getServers: vi.fn<() => Array<{ id: string }>>(() => []),
  waitForPendingSecureSessionWrites: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: mocks.apiMock,
  setAuthTokens: mocks.setAuthTokens,
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
  setCurrentServerId: mocks.setCurrentServerId,
  getServers: mocks.getServers,
}));

import {
  beginNativeOAuth,
  consumeOAuthCallbackUrl,
} from "@/lib/capacitor-oauth";

// Tauri desktop has no OS-backed secure session plugin, so its PKCE
// verifier record is kept in localStorage instead — otherwise it's the
// exact same beginNativeOAuth/exchangeNativeOAuthCallback flow mobile
// uses (capacitor.test.ts covers the Capacitor/secure-session side).
describe("desktop (Tauri) native OAuth via localStorage", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.apiMock.mockReset();
    mocks.setAuthTokens.mockReset();
    mocks.getCurrentServerId.mockReset().mockReturnValue(null);
    mocks.setCurrentServerId.mockReset();
    mocks.getServers.mockReset().mockReturnValue([]);
    mocks.waitForPendingSecureSessionWrites
      .mockReset()
      .mockResolvedValue(undefined);
  });

  it("starts native OAuth and persists the PKCE verifier to localStorage", async () => {
    mocks.apiMock.mockResolvedValue({
      provider: "google",
      login_url: "https://accounts.example/authorize",
    });

    const loginUrl = await beginNativeOAuth("google", "/library");

    expect(loginUrl).toBe("https://accounts.example/authorize");
    expect(mocks.apiMock).toHaveBeenCalledWith(
      "/api/auth/oauth/google/start",
      "POST",
      expect.objectContaining({
        return_to: "cratemusic://oauth/callback",
        native_code_challenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        native_state: expect.stringMatching(/^[A-Za-z0-9_-]{16,}$/),
      }),
    );

    const stateArg = mocks.apiMock.mock.calls[0]?.[2].native_state as string;
    expect(localStorage.getItem(`crate.oauth.${stateArg}`)).toContain(
      '"next":"/library"',
    );
  });

  it("rolls back the stored verifier if the start request fails", async () => {
    mocks.apiMock.mockRejectedValue(new Error("network error"));

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
        serverId: null,
      }),
    );
    mocks.apiMock.mockResolvedValue({
      token: "access-token",
      refresh_token: "refresh-token",
      access_expires_at: "2030-01-01T00:00:00Z",
    });

    const result = await consumeOAuthCallbackUrl(
      `cratemusic://oauth/callback?code=one-time-code&state=${state}`,
    );

    expect(result).toEqual({ handled: true, next: "/stats" });
    expect(mocks.apiMock).toHaveBeenCalledWith(
      "/api/auth/native/exchange",
      "POST",
      {
        code: "one-time-code",
        code_verifier: "v".repeat(43),
        state,
      },
    );
    expect(mocks.setAuthTokens).toHaveBeenCalledWith(
      "access-token",
      "refresh-token",
      "2030-01-01T00:00:00Z",
    );
    // The one-time verifier record must not survive a successful exchange.
    expect(localStorage.getItem(`crate.oauth.${state}`)).toBeNull();
  });

  it("rejects a callback whose state has no matching stored verifier", async () => {
    const result = await consumeOAuthCallbackUrl(
      "cratemusic://oauth/callback?code=one-time-code&state=unknown-state",
    );

    expect(result).toEqual({ handled: false, next: "/" });
    expect(mocks.setAuthTokens).not.toHaveBeenCalled();
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
    mocks.apiMock.mockResolvedValue({ token: "access-token" });

    const result = await consumeOAuthCallbackUrl(
      `cratemusic://oauth/callback?code=one-time-code&state=${state}`,
    );

    expect(result).toEqual({ handled: true, next: "/library" });
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
    mocks.apiMock.mockResolvedValue({ token: "access-token" });

    const result = await consumeOAuthCallbackUrl(
      `cratemusic://oauth/callback?code=one-time-code&state=${state}`,
    );

    expect(result).toEqual({ handled: false, next: "/" });
    expect(mocks.setAuthTokens).not.toHaveBeenCalled();
    expect(mocks.setCurrentServerId).not.toHaveBeenCalled();
  });
});
