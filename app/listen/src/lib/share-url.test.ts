import { beforeEach, describe, expect, it, vi } from "vitest";

const getApiBaseMock = vi.hoisted(() => vi.fn());
const shareUrlRuntime = vi.hoisted(() => ({ usesConfigurableServer: true }));

vi.mock("@/lib/api", () => ({
  getApiBase: getApiBaseMock,
}));

vi.mock("@/lib/platform", () => ({
  get usesConfigurableServer() {
    return shareUrlRuntime.usesConfigurableServer;
  },
}));

import { inviteShareUrl, publicShareUrl } from "@/lib/share-url";

describe("publicShareUrl", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    getApiBaseMock.mockReset();
    shareUrlRuntime.usesConfigurableServer = true;
  });

  it("maps native API servers to their Listen share origin", () => {
    getApiBaseMock.mockReturnValue("https://api.example.test");

    expect(publicShareUrl("/share/track/track-1/song")).toBe(
      "https://listen.example.test/share/track/track-1/song",
    );
  });

  it("keeps non-api hosts as the share origin", () => {
    getApiBaseMock.mockReturnValue("https://music.example.test:8585");

    expect(publicShareUrl("/share/album/1/album")).toBe(
      "https://music.example.test:8585/share/album/1/album",
    );
  });

  it.each([
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "capacitor://localhost",
  ])("resolves relative invites from the configured server in %s", (origin) => {
    vi.stubGlobal("window", { location: { origin } });
    getApiBaseMock.mockReturnValue("https://api.example.test/v1");

    expect(publicShareUrl("/jam/invite/a%2Fb?source=room%20share")).toBe(
      "https://listen.example.test/jam/invite/a%2Fb?source=room%20share",
    );
  });

  it("preserves an absolute invite returned for a custom Listen domain", () => {
    getApiBaseMock.mockReturnValue("https://api.custom.test");

    expect(
      publicShareUrl(
        "https://music.custom.test/listen/playlist/invite/token?from=share",
      ),
    ).toBe("https://music.custom.test/listen/playlist/invite/token?from=share");
  });

  it("prefers the additive public URL while preserving the relative API fields", () => {
    getApiBaseMock.mockReturnValue("https://api.example.test");

    expect(
      inviteShareUrl({
        join_url: "/jam/invite/token",
        public_url: "https://listen.custom.test/library/jam/invite/token",
      }),
    ).toBe("https://listen.custom.test/library/jam/invite/token");
  });

  it("resolves the legacy relative invite when no public URL is supplied", () => {
    vi.stubGlobal("window", { location: { origin: "tauri://localhost" } });
    getApiBaseMock.mockReturnValue("https://api.example.test");

    expect(inviteShareUrl({ join_url: "/jam/invite/token" })).toBe(
      "https://listen.example.test/jam/invite/token",
    );
  });

  it("uses the current public origin for web shares", () => {
    shareUrlRuntime.usesConfigurableServer = false;
    vi.stubGlobal("window", {
      location: { origin: "https://listen.web.example.test" },
    });
    getApiBaseMock.mockReturnValue("https://api.other.example.test");

    expect(publicShareUrl("/playlist/invite/token")).toBe(
      "https://listen.web.example.test/playlist/invite/token",
    );
  });
});
