import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => "android",
  },
}));

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn(),
    getLaunchUrl: vi.fn(async () => null),
    exitApp: vi.fn(),
  },
}));

vi.mock("@capacitor/network", () => ({
  Network: {
    addListener: vi.fn(),
    getStatus: vi.fn(async () => ({ connected: true })),
  },
}));

vi.mock("@capacitor/status-bar", () => ({
  StatusBar: {
    setStyle: vi.fn(async () => {}),
    setOverlaysWebView: vi.fn(async () => {}),
    setBackgroundColor: vi.fn(async () => {}),
  },
  Style: { Dark: "DARK" },
}));

vi.mock("@capacitor/browser", () => ({
  Browser: {
    close: vi.fn(async () => {}),
  },
}));

const {
  apiMock,
  getSecureSessionValue,
  removeSecureSessionValue,
  setAuthTokens,
  setAuthTokensForServer,
  setSecureSessionValue,
  waitForPendingSecureSessionWrites,
} = vi.hoisted(() => ({
  apiMock: vi.fn(),
  getSecureSessionValue: vi.fn(),
  removeSecureSessionValue: vi.fn(),
  setAuthTokens: vi.fn(),
  setAuthTokensForServer: vi.fn(() => true),
  setSecureSessionValue: vi.fn(),
  waitForPendingSecureSessionWrites: vi.fn(),
}));
vi.mock("@/lib/api", () => ({
  api: apiMock,
  apiForServer: apiMock,
  setAuthTokens,
  setAuthTokensForServer,
}));
vi.mock("@/lib/native-secure-session", () => ({
  getSecureSessionValue,
  removeSecureSessionValue,
  setSecureSessionValue,
}));
vi.mock("@/lib/server-store", () => ({
  waitForPendingSecureSessionWrites,
  getCurrentServerId: () => "server-a",
  getServers: () => [{ id: "server-a" }],
  setCurrentServerId: () => {},
}));

import {
  beginNativeOAuth,
  consumeOAuthCallbackUrl,
  consumePendingOAuthNext,
  getOAuthCallbackPayload,
} from "@/lib/capacitor";

describe("capacitor OAuth callback helpers", () => {
  beforeEach(() => {
    localStorage.clear();
    apiMock.mockReset();
    getSecureSessionValue.mockReset();
    removeSecureSessionValue.mockReset();
    setAuthTokens.mockReset();
    setAuthTokensForServer.mockReset().mockReturnValue(true);
    setSecureSessionValue.mockReset();
    waitForPendingSecureSessionWrites.mockReset();
    waitForPendingSecureSessionWrites.mockResolvedValue(undefined);
  });

  it("rejects desktop token callbacks without an expected state", async () => {
    const result = await consumeOAuthCallbackUrl(
      "cratemusic://oauth/callback?token=abc123&next=%2Fmixes",
    );

    expect(result).toEqual({ handled: false, next: "/" });
    expect(setAuthTokens).not.toHaveBeenCalled();
  });

  it("rejects arbitrary HTTPS callback hosts", async () => {
    const result = await consumeOAuthCallbackUrl(
      "https://listen.lespedants.org/auth/callback?token=abc123&next=%2Fmixes",
    );

    expect(result).toEqual({ handled: false, next: "/" });
    expect(setAuthTokens).not.toHaveBeenCalled();
  });

  it("ignores unrelated URLs", async () => {
    const result = await consumeOAuthCallbackUrl("https://example.com/login");

    expect(result).toEqual({ handled: false, next: "/" });
    expect(setAuthTokens).not.toHaveBeenCalled();
    expect(consumePendingOAuthNext()).toBeNull();
  });

  it("starts native OAuth with an app-owned PKCE binding", async () => {
    apiMock.mockResolvedValue({
      provider: "google",
      login_url: "https://accounts.example/authorize",
    });
    setSecureSessionValue.mockResolvedValue(undefined);

    const result = await beginNativeOAuth("google", "/stats");

    expect(result).toBe("https://accounts.example/authorize");
    expect(apiMock).toHaveBeenCalledWith(
      "server-a",
      "/api/auth/oauth/google/start",
      "POST",
      expect.objectContaining({
        return_to: "cratemusic://oauth/callback",
        native_code_challenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        native_state: expect.stringMatching(/^[A-Za-z0-9_-]{16,}$/),
      }),
    );
    expect(setSecureSessionValue).toHaveBeenCalledWith(
      expect.stringMatching(/^crate\.oauth\./),
      expect.stringContaining('"next":"/stats"'),
    );
  });

  it("exchanges a one-time callback code and always deletes its verifier", async () => {
    getSecureSessionValue.mockResolvedValue(
      JSON.stringify({
        verifier: "v".repeat(43),
        next: "/stats",
        createdAt: Date.now(),
        serverId: "server-a",
      }),
    );
    apiMock.mockResolvedValue({
      token: "access-token",
      refresh_token: "refresh-token",
      access_expires_at: "2030-01-01T00:00:00Z",
    });
    removeSecureSessionValue.mockResolvedValue(undefined);

    const result = await consumeOAuthCallbackUrl(
      `cratemusic://oauth/callback?code=one-time-code-token&state=${"s".repeat(
        43,
      )}`,
    );

    expect(result).toEqual({ handled: true, next: "/stats" });
    expect(apiMock).toHaveBeenCalledWith(
      "server-a",
      "/api/auth/native/exchange",
      "POST",
      {
        code: "one-time-code-token",
        code_verifier: "v".repeat(43),
        state: "s".repeat(43),
      },
    );
    expect(setAuthTokensForServer).toHaveBeenCalledWith(
      "server-a",
      "access-token",
      "refresh-token",
      "2030-01-01T00:00:00Z",
    );
    expect(waitForPendingSecureSessionWrites).toHaveBeenCalledOnce();
    expect(removeSecureSessionValue).toHaveBeenCalledWith(
      `crate.oauth.${"s".repeat(43)}`,
    );
  });

  it("keeps the verifier when native code exchange fails transiently", async () => {
    getSecureSessionValue.mockResolvedValue(
      JSON.stringify({
        verifier: "v".repeat(43),
        next: "/",
        createdAt: Date.now(),
        serverId: "server-a",
      }),
    );
    apiMock.mockRejectedValue(new Error("exchange failed"));
    removeSecureSessionValue.mockResolvedValue(undefined);

    const result = await consumeOAuthCallbackUrl(
      `cratemusic://oauth/callback?code=one-time-code-token&state=${"s".repeat(
        43,
      )}`,
    );

    expect(result).toEqual({ handled: false, next: "/", retryable: true });
    expect(removeSecureSessionValue).not.toHaveBeenCalled();
  });

  it("rejects the callback when the exchanged session cannot be persisted", async () => {
    getSecureSessionValue.mockResolvedValue(
      JSON.stringify({
        verifier: "v".repeat(43),
        next: "/stats",
        createdAt: Date.now(),
        serverId: "server-a",
      }),
    );
    apiMock.mockResolvedValue({
      token: "access-token",
      refresh_token: "refresh-token",
    });
    waitForPendingSecureSessionWrites.mockRejectedValue(
      new Error("keystore unavailable"),
    );
    removeSecureSessionValue.mockResolvedValue(undefined);

    const result = await consumeOAuthCallbackUrl(
      `cratemusic://oauth/callback?code=one-time-code-token&state=${"s".repeat(
        43,
      )}`,
    );

    expect(result).toEqual({ handled: false, next: "/" });
    expect(setAuthTokensForServer).toHaveBeenLastCalledWith(
      "server-a",
      null,
      null,
      null,
    );
  });

  it("parses token and next from plain search params too", () => {
    expect(getOAuthCallbackPayload("?token=abc123&next=%2Fstats")).toEqual({
      token: "abc123",
      refreshToken: null,
      accessExpiresAt: null,
      next: "/stats",
    });
  });
});
