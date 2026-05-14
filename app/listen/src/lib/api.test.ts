import { beforeEach, describe, expect, it } from "vitest";

import {
  apiAssetUrl,
  getAuthTokenExpiresAt,
  resolveMaybeApiAssetUrl,
  setAuthTokens,
  shouldRedirectToLoginOnUnauthorized,
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
  it("stores explicit access expiry metadata", () => {
    setAuthTokens("listen-token", undefined, "2026-05-12T13:08:10+00:00");

    expect(getAuthTokenExpiresAt()).toBe("2026-05-12T13:08:10+00:00");
  });

  it("uses cookies for same-origin API assets", () => {
    localStorage.setItem("listen-auth-token", "listen token");

    expect(resolveMaybeApiAssetUrl("/api/playlists/1/cover")).toBe(
      "/api/playlists/1/cover",
    );
  });

  it("preserves existing query params without adding a same-origin token", () => {
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
});
