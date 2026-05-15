import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({
  usesConfigurableServer: false,
  isTauriRuntime: false,
  getListenAppId: () => "listen-web",
}));

vi.mock("@/lib/listen-device", () => ({
  getListenDeviceFingerprint: () => "fp123",
  getListenDeviceLabel: () => "Test Device",
}));

import {
  apiAssetUrl,
  apiSseUrl,
  apiWsUrl,
  getAuthToken,
  getAuthTokenExpiresAt,
  getRefreshToken,
  resolveMaybeApiAssetUrl,
  setAuthToken,
  setRefreshToken,
  setAuthTokens,
  getApiAuthHeaders,
  shouldRedirectToLoginOnUnauthorized,
  refreshAuthToken,
  apiFetch,
} from "@/lib/api";

beforeEach(() => {
  localStorage.clear();
});

describe("shouldRedirectToLoginOnUnauthorized", () => {
  it("skips redirect during public auth bootstrap routes", () => {
    expect(shouldRedirectToLoginOnUnauthorized("/login")).toBe(false);
    expect(shouldRedirectToLoginOnUnauthorized("/register")).toBe(false);
    expect(shouldRedirectToLoginOnUnauthorized("/server-setup")).toBe(false);
    expect(shouldRedirectToLoginOnUnauthorized("/auth/callback")).toBe(false);
  });

  it("redirects from protected app routes", () => {
    expect(shouldRedirectToLoginOnUnauthorized("/")).toBe(true);
    expect(shouldRedirectToLoginOnUnauthorized("/stats")).toBe(true);
  });
});

describe("playlist asset URLs", () => {
  it("uses cookies for same-origin API assets", () => {
    localStorage.setItem("listen-auth-token", "listen token");

    expect(resolveMaybeApiAssetUrl("/api/playlists/1/cover")).toBe(
      "/api/playlists/1/cover",
    );
  });

  it("preserves same-origin asset query params without adding a token", () => {
    localStorage.setItem("listen-auth-token", "listen-token");

    expect(apiAssetUrl("/api/playlists/1/cover?size=256")).toBe(
      "/api/playlists/1/cover?size=256",
    );
  });

  it("does not duplicate an existing asset token", () => {
    localStorage.setItem("listen-auth-token", "listen-token");

    expect(
      apiAssetUrl(
        "https://api.example.test/api/playlists/1/cover?token=listen-token",
      ),
    ).toBe("https://api.example.test/api/playlists/1/cover?token=listen-token");
  });

  it("adds the listen token to absolute Crate API asset URLs", () => {
    localStorage.setItem("listen-auth-token", "listen-token");

    expect(
      resolveMaybeApiAssetUrl("https://api.example.test/api/playlists/1/cover"),
    ).toBe("https://api.example.test/api/playlists/1/cover?token=listen-token");
  });

  it("leaves inline cover data unchanged", () => {
    expect(resolveMaybeApiAssetUrl("data:image/png;base64,cover")).toBe(
      "data:image/png;base64,cover",
    );
  });

  it("leaves blob URLs unchanged", () => {
    expect(resolveMaybeApiAssetUrl("blob:abc123")).toBe("blob:abc123");
  });

  it("handles full origin API URLs", () => {
    localStorage.setItem("listen-auth-token", "tok");
    expect(resolveMaybeApiAssetUrl(`${window.location.origin}/api/cover`)).toBe(
      "/api/cover",
    );
  });
});

describe("apiSseUrl", () => {
  it("returns relative path for web", () => {
    expect(apiSseUrl("/api/events")).toBe("/api/events");
  });
});

describe("apiWsUrl", () => {
  it("returns ws URL with token", () => {
    localStorage.setItem("listen-auth-token", "tok");
    const url = apiWsUrl("/api/ws");
    expect(url.startsWith("ws://")).toBe(true);
    expect(url).toContain("token=tok");
  });

  it("returns ws URL without token", () => {
    const url = apiWsUrl("/api/ws");
    expect(url.startsWith("ws://")).toBe(true);
    expect(url).not.toContain("token=");
  });
});

describe("auth tokens", () => {
  it("getAuthToken reads from localStorage", () => {
    localStorage.setItem("listen-auth-token", "abc");
    expect(getAuthToken()).toBe("abc");
  });

  it("getAuthToken returns null when absent", () => {
    expect(getAuthToken()).toBeNull();
  });

  it("getAuthTokenExpiresAt reads from localStorage", () => {
    localStorage.setItem(
      "listen-auth-token-expires-at",
      "2025-01-01T00:00:00.000Z",
    );
    expect(getAuthTokenExpiresAt()).toBe("2025-01-01T00:00:00.000Z");
  });

  it("getRefreshToken returns null for web", () => {
    expect(getRefreshToken()).toBeNull();
  });

  it("setAuthToken stores token and emits event", () => {
    const handler = vi.fn();
    window.addEventListener("crate:auth-token-updated", handler);
    setAuthToken("new-tok");
    expect(getAuthToken()).toBe("new-tok");
    expect(handler).toHaveBeenCalled();
    window.removeEventListener("crate:auth-token-updated", handler);
  });

  it("setAuthToken removes token when null", () => {
    setAuthToken("tmp");
    setAuthToken(null);
    expect(getAuthToken()).toBeNull();
  });

  it("setRefreshToken is a no-op for web", () => {
    expect(() => setRefreshToken(null)).not.toThrow();
  });

  it("setAuthTokens stores token and expiresAt", () => {
    setAuthTokens("tok", null, "2025-06-01T00:00:00.000Z");
    expect(getAuthToken()).toBe("tok");
    expect(getAuthTokenExpiresAt()).toBe("2025-06-01T00:00:00.000Z");
  });

  it("decodes JWT exp and stores it", () => {
    // JWT with payload { "exp": 1893456000 }
    const payload = btoa(JSON.stringify({ exp: 1893456000 }));
    const token = `header.${payload}.signature`;
    setAuthToken(token);
    expect(getAuthTokenExpiresAt()).toBe(
      new Date(1893456000 * 1000).toISOString(),
    );
  });
});

describe("getApiAuthHeaders", () => {
  it("includes bearer token when present", () => {
    localStorage.setItem("listen-auth-token", "tok");
    const headers = getApiAuthHeaders();
    expect(headers["Authorization"]).toBe("Bearer tok");
  });

  it("includes device headers", () => {
    const headers = getApiAuthHeaders();
    expect(headers["X-Crate-App"]).toBe("listen-web");
    expect(headers["X-Device-Label"]).toBe("Test Device");
    expect(headers["X-Device-Fingerprint"]).toBe("fp123");
  });
});

describe("refreshAuthToken", () => {
  it("returns false on network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network"));
    expect(await refreshAuthToken()).toBe(false);
  });

  it("returns false on 401 and clears token", async () => {
    localStorage.setItem("listen-auth-token", "old");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({}),
    } as Response);
    expect(await refreshAuthToken()).toBe(false);
    expect(getAuthToken()).toBeNull();
  });

  it("returns true and stores new token", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        token: "new-tok",
        access_expires_at: "2025-01-01T00:00:00Z",
      }),
    } as Response);
    expect(await refreshAuthToken()).toBe(true);
    expect(getAuthToken()).toBe("new-tok");
  });

  it("returns false when response has no token", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response);
    expect(await refreshAuthToken()).toBe(false);
  });
});

describe("apiFetch", () => {
  it("returns response on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
    } as Response);
    const res = await apiFetch("/api/test");
    expect(res.status).toBe(200);
  });

  it("refreshes token on 401 and retries", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ status: 401 } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ token: "refreshed" }),
      } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200 } as Response);

    const res = await apiFetch("/api/test");
    expect(res.status).toBe(200);
  });
});
