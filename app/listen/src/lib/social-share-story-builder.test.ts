import { afterEach, describe, expect, it, vi } from "vitest";

const { getApiAuthHeadersMock, getApiBaseMock } = vi.hoisted(() => ({
  getApiAuthHeadersMock: vi.fn(),
  getApiBaseMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  getApiAuthHeaders: getApiAuthHeadersMock,
  getApiBase: getApiBaseMock,
  resolveMaybeApiAssetUrl: (src: string) => src,
}));

import {
  resolveArtworkAuthHeaders,
  resolveCrateStoryComposition,
} from "@/lib/social-share-story-builder";
import {
  buildCrateStoryByline,
  buildCrateStoryMetadata,
  buildInstagramStorySubtitle,
  formatShareDisplayUrl,
} from "@/lib/social-share-story-canvas";

describe("resolveArtworkAuthHeaders", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("attaches auth headers for our own configured server's artwork URLs", () => {
    getApiBaseMock.mockReturnValue("https://my-instance.example");
    getApiAuthHeadersMock.mockReturnValue({ Authorization: "Bearer secret" });

    expect(
      resolveArtworkAuthHeaders("https://my-instance.example/api/covers/1"),
    ).toEqual({ Authorization: "Bearer secret" });
  });

  it("attaches auth headers for same-origin relative API paths", () => {
    getApiBaseMock.mockReturnValue("");
    getApiAuthHeadersMock.mockReturnValue({ Authorization: "Bearer secret" });

    expect(resolveArtworkAuthHeaders("/api/covers/1")).toEqual({
      Authorization: "Bearer secret",
    });
  });

  it("never attaches auth headers for third-party artwork URLs", () => {
    getApiBaseMock.mockReturnValue("https://my-instance.example");

    expect(
      resolveArtworkAuthHeaders("https://lastfm-img.example/cover.jpg"),
    ).toBeUndefined();
    expect(getApiAuthHeadersMock).not.toHaveBeenCalled();
  });

  it("does not attach auth headers just because the path starts with /api/ on a different origin", () => {
    getApiBaseMock.mockReturnValue("https://my-instance.example");

    // A malicious host could serve a path that merely *looks* like our
    // API — isApiUrl()'s old path-only check would have matched this and
    // leaked the bearer token/device headers to attacker.example.
    expect(
      resolveArtworkAuthHeaders("https://attacker.example/api/cover.jpg"),
    ).toBeUndefined();
    expect(getApiAuthHeadersMock).not.toHaveBeenCalled();
  });
});

describe("resolveCrateStoryComposition", () => {
  it("uses the ranked stack for ordered Crates", () => {
    expect(
      resolveCrateStoryComposition({
        kind: "crate",
        title: "Best of 2026",
        url: "/crate/1",
        crateIsOrdered: true,
      }),
    ).toBe("ranked-stack");
  });

  it("uses the coverflow fan for unordered Crates", () => {
    expect(
      resolveCrateStoryComposition({
        kind: "crate",
        title: "Road trip records",
        url: "/crate/2",
        crateIsOrdered: false,
      }),
    ).toBe("coverflow-fan");
  });

  it("never uses the ranked stack for other kinds", () => {
    expect(
      resolveCrateStoryComposition({
        kind: "playlist",
        title: "Mix",
        url: "/playlist/2",
        crateIsOrdered: true,
      }),
    ).toBe("coverflow-fan");
  });
});

describe("Crate story text", () => {
  const payload = {
    kind: "crate" as const,
    title: "Road trip records",
    subtitle: "Diego",
    url: "https://listen.example/share/crate/2",
    crateAlbums: [
      { imageUrl: null, name: "One", artistName: "Artist", position: 0 },
      { imageUrl: null, name: "Two", artistName: "Artist", position: 1 },
    ],
    crateTrackCount: 18,
    crateIsOrdered: false,
  };

  it("falls back to English metadata when no labels are provided", () => {
    expect(buildCrateStoryMetadata(payload)).toBe("2 albums · 18 tracks");
    expect(buildCrateStoryByline(payload)).toBe("A selected Crate by Diego");
  });

  it("prefers the explicit owner and album count fields", () => {
    expect(buildCrateStoryByline({ ...payload, crateOwnerName: "Jane" })).toBe(
      "A selected Crate by Jane",
    );
    expect(buildCrateStoryMetadata({ ...payload, crateAlbumCount: 12 })).toBe(
      "12 albums · 18 tracks",
    );
  });

  it("uses localized labels when provided", () => {
    const labels = {
      subtitle: "Crate de Diego",
      metadata: "2 álbumes · 18 canciones",
    };
    expect(buildCrateStoryByline(payload, labels)).toBe("Crate de Diego");
    expect(buildCrateStoryMetadata(payload, labels)).toBe(
      "2 álbumes · 18 canciones",
    );
  });

  it("shows the share URL without protocol", () => {
    expect(formatShareDisplayUrl(payload.url)).toBe(
      "listen.example/share/crate/2",
    );
  });
});

describe("Instagram story subtitle", () => {
  const album = {
    kind: "album" as const,
    title: "El Cielo",
    subtitle: "Dredg",
    url: "https://listen.example/share/album/1",
  };

  it("renders the localized subtitle passed by the caller", () => {
    expect(
      buildInstagramStorySubtitle(album, { subtitle: "Álbum de Dredg" }),
    ).toBe("Álbum de Dredg");
  });

  it("never falls back to hard-coded English connectors", () => {
    expect(buildInstagramStorySubtitle(album)).toBe("Dredg");
    expect(buildInstagramStorySubtitle({ ...album, kind: "track" }, {})).toBe(
      "Dredg",
    );
    expect(
      buildInstagramStorySubtitle({ ...album, kind: "artist", subtitle: "" }),
    ).toBe("Crate");
  });
});
