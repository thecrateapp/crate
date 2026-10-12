import { describe, expect, it } from "vitest";

import { releaseCategory } from "@/components/artist/artist-library-model";
import type { ArtistAlbum } from "@/components/artist/artist-model";

function album(overrides: Partial<ArtistAlbum>): ArtistAlbum {
  return {
    id: 1,
    name: "Exalted Eagles",
    display_name: "Exalted Eagles",
    tracks: 3,
    formats: ["flac"],
    size_mb: 90,
    year: "2026",
    has_cover: true,
    ...overrides,
  };
}

describe("releaseCategory fallback", () => {
  it("treats short untyped releases as singles", () => {
    expect(releaseCategory(album({ tracks: 1 }))).toBe("ep_single");
    expect(releaseCategory(album({ tracks: 3 }))).toBe("ep_single");
  });

  it("keeps longer untyped releases as albums", () => {
    expect(
      releaseCategory(
        album({ name: "Four Songs", display_name: "Four Songs", tracks: 4 }),
      ),
    ).toBe("album");
  });

  it("prefers the category sent by the backend", () => {
    expect(
      releaseCategory(album({ tracks: 2, release_category: "album" })),
    ).toBe("album");
  });
});
