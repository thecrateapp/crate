import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  ensureMediaAccessUrl: vi.fn(
    async (url: string) =>
      `${url}${url.includes("?") ? "&" : "?"}media_ticket=fresh`,
  ),
  isUsableMediaAssetUrl: vi.fn((url: string | null | undefined) =>
    Boolean(url),
  ),
  requiresMediaAccessTicket: vi.fn((url: string | null | undefined) =>
    Boolean(url?.startsWith("/api/")),
  ),
  resolveMaybeApiAssetUrl: vi.fn((url: string | null | undefined) =>
    url ? `${url}${url.includes("?") ? "&" : "?"}media_ticket=current` : null,
  ),
}));

vi.mock("@/lib/api", () => apiMocks);

import {
  canonicalArtworkTransportIdentity,
  preloadArtwork,
  refreshArtworkCandidate,
  resolveArtworkCandidate,
} from "./artwork-manager";
import { artworkFromUrl } from "./artwork-source";

class MockImage {
  static instances: MockImage[] = [];

  decoding = "";
  fetchPriority = "";
  onerror: ((event: Event) => void) | null = null;
  onload: ((event: Event) => void) | null = null;
  sizes = "";
  srcset = "";
  private value = "";

  constructor() {
    MockImage.instances.push(this);
  }

  set src(value: string) {
    this.value = value;
    queueMicrotask(() => this.onload?.(new Event("load")));
  }

  get src(): string {
    return this.value;
  }

  decode = vi.fn(async () => undefined);
}

describe("artwork manager", () => {
  beforeEach(() => {
    apiMocks.ensureMediaAccessUrl.mockClear();
    apiMocks.resolveMaybeApiAssetUrl.mockClear();
    MockImage.instances = [];
    vi.stubGlobal("Image", MockImage);
  });

  it("ignores transport credentials but retains content revisions", () => {
    expect(
      canonicalArtworkTransportIdentity(
        "/api/artists/9/photo?size=320&v=two&media_ticket=secret",
      ),
    ).toBe("/api/artists/9/photo?size=320&v=two");
    expect(
      canonicalArtworkTransportIdentity(
        "https://images.example/artist.jpg?token=public",
      ),
    ).toBe("https://images.example/artist.jpg?token=public");
  });

  it("resolves source and responsive candidates in one place", () => {
    const source = artworkFromUrl("/api/artists/9/photo?size=320", {
      kind: "artist-photo",
      logicalKey: "artist-photo:local:9",
      srcSet:
        "/api/artists/9/photo?size=160 160w, /api/artists/9/photo?size=320 320w",
      sizes: "50vw",
    });

    const candidate = resolveArtworkCandidate(source);

    expect(candidate?.logicalKey).toBe("artist-photo:local:9");
    expect(candidate?.src).toContain("media_ticket=current");
    expect(candidate?.srcSet).toContain("size=160&media_ticket=current 160w");
    expect(candidate?.sizes).toBe("50vw");
  });

  it("deduplicates concurrent preloads of the same content", async () => {
    const source = artworkFromUrl("/api/albums/8/cover?v=revision-4", {
      kind: "album-cover",
      logicalKey: "album-cover:local:8",
    });

    const first = preloadArtwork(source);
    const second = preloadArtwork(source);

    expect(first).toBe(second);
    await expect(first).resolves.toMatchObject({
      logicalKey: "album-cover:local:8",
    });
    expect(MockImage.instances).toHaveLength(1);
    expect(MockImage.instances[0]?.decode).toHaveBeenCalledOnce();
  });

  it("refreshes protected credentials without changing content identity", async () => {
    const source = artworkFromUrl("/api/artists/7/photo?v=revision-2", {
      kind: "artist-photo",
      logicalKey: "artist-photo:local:7",
    });
    const current = resolveArtworkCandidate(source);
    const refreshed = await refreshArtworkCandidate(source);

    expect(apiMocks.ensureMediaAccessUrl).toHaveBeenCalledWith(
      "/api/artists/7/photo?v=revision-2",
      "artwork",
      { forceRefresh: true },
    );
    expect(refreshed?.contentKey).toBe(current?.contentKey);
    expect(refreshed?.src).toContain("media_ticket=fresh");
  });

  it("refreshes one path and rebuilds every responsive candidate from it", async () => {
    const source = artworkFromUrl("/api/artists/7/photo?size=320", {
      kind: "artist-photo",
      logicalKey: "artist-photo:local:7",
      srcSet:
        "/api/artists/7/photo?size=160 160w, /api/artists/7/photo?size=320 320w",
      sizes: "50vw",
    });

    const refreshed = await refreshArtworkCandidate(source);

    expect(apiMocks.ensureMediaAccessUrl).toHaveBeenCalledTimes(1);
    expect(refreshed?.srcSet).toContain("size=160");
    expect(refreshed?.srcSet).toContain("size=320");
  });
});
