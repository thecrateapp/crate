import { beforeEach, describe, expect, it, vi } from "vitest";

const getApiBaseMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  getApiBase: getApiBaseMock,
}));

vi.mock("@/lib/platform", () => ({
  usesConfigurableServer: true,
}));

import { publicShareUrl } from "@/lib/share-url";

describe("publicShareUrl", () => {
  beforeEach(() => {
    getApiBaseMock.mockReset();
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
});
