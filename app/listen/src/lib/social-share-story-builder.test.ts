import { afterEach, describe, expect, it, vi } from "vitest";

const { isApiUrlMock, getApiAuthHeadersMock } = vi.hoisted(() => ({
  isApiUrlMock: vi.fn(),
  getApiAuthHeadersMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  isApiUrl: isApiUrlMock,
  getApiAuthHeaders: getApiAuthHeadersMock,
  resolveMaybeApiAssetUrl: (src: string) => src,
}));

import { resolveArtworkAuthHeaders } from "@/lib/social-share-story-builder";

describe("resolveArtworkAuthHeaders", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("attaches auth headers for our own API's artwork URLs", () => {
    isApiUrlMock.mockReturnValue(true);
    getApiAuthHeadersMock.mockReturnValue({ Authorization: "Bearer secret" });

    expect(
      resolveArtworkAuthHeaders("https://my-instance.example/api/covers/1"),
    ).toEqual({ Authorization: "Bearer secret" });
  });

  it("never attaches auth headers for third-party artwork URLs", () => {
    isApiUrlMock.mockReturnValue(false);

    expect(
      resolveArtworkAuthHeaders("https://lastfm-img.example/cover.jpg"),
    ).toBeUndefined();
    expect(getApiAuthHeadersMock).not.toHaveBeenCalled();
  });
});
