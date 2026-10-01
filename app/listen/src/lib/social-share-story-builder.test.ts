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

  it("uses the editorial hero for unordered Crates", () => {
    expect(
      resolveCrateStoryComposition({
        kind: "crate",
        title: "Road trip records",
        url: "/crate/2",
        crateIsOrdered: false,
      }),
    ).toBe("hero-editorial");
  });
});
