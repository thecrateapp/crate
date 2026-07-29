import { describe, expect, it } from "vitest";

import {
  albumCoverArtwork,
  artistBackgroundArtwork,
  artistPhotoArtwork,
  artworkFromUrl,
  genreCoverArtwork,
} from "./artwork-source";

describe("artwork source contracts", () => {
  it("builds a canonical responsive artist-card source", () => {
    const source = artistPhotoArtwork(
      {
        artistId: 42,
        globalArtistUid: "artist-global-42",
        artistName: "High Vis",
      },
      { preset: "artist-card" },
    );

    expect(source.kind).toBe("artist-photo");
    expect(source.logicalKey).toBe("artist-photo:global:artist-global-42");
    expect(source.src).toBe(
      "/api/catalog/artists/artist-global-42/photo?size=320&format=webp",
    );
    expect(source.srcSet).toContain("size=160");
    expect(source.srcSet).toContain("size=320");
    expect(source.sizes).toBe(
      "(max-width: 639px) 50vw, (max-width: 1023px) 33vw, 17vw",
    );
  });

  it("keeps logical identity stable across revision and size changes", () => {
    const compact = artistPhotoArtwork(
      { artistEntityUid: "artist-entity-9" },
      { size: 160, version: "revision-1" },
    );
    const large = artistPhotoArtwork(
      { artistEntityUid: "artist-entity-9" },
      { size: 640, version: "revision-2" },
    );

    expect(compact.logicalKey).toBe(large.logicalKey);
    expect(compact.src).not.toBe(large.src);
  });

  it("keeps fallback identities distinct for non-Latin artist names", () => {
    const first = artistPhotoArtwork({ artistName: "椎名林檎" });
    const second = artistPhotoArtwork({ artistName: "宇多田ヒカル" });

    expect(first.logicalKey).not.toBe(second.logicalKey);
    expect(first.logicalKey).not.toContain("unknown");
    expect(second.logicalKey).not.toContain("unknown");
  });

  it("allows a rendering surface to override preset sizes", () => {
    const artwork = artistPhotoArtwork(
      { artistId: 9, artistName: "High Vis" },
      { preset: "artist-card", sizes: "100px" },
    );

    expect(artwork.sizes).toBe("100px");
  });

  it("builds album, background, and genre sources without credentials", () => {
    const album = albumCoverArtwork(
      { albumId: 7, albumName: "Inlet", artistName: "Hum" },
      { preset: "album-card" },
    );
    const background = artistBackgroundArtwork(
      { artistId: 4, artistName: "Converge" },
      { preset: "hero" },
    );
    const genre = genreCoverArtwork("post-metal", { preset: "genre-card" });

    expect(album.src).toBe("/api/albums/7/cover?size=320&format=webp");
    expect(background.src).toBe(
      "/api/artists/4/background?size=1280&format=webp",
    );
    expect(genre.src).toBe("/api/genres/post-metal/cover?size=640&format=webp");
    expect(`${album.src}${background.src}${genre.src}`).not.toMatch(
      /token|media_ticket/,
    );
  });

  it("adapts opaque URLs with an explicit stable logical key", () => {
    const source = artworkFromUrl(
      "/api/network/external-artist/photo?name=Poison%20The%20Well",
      {
        kind: "external-artist",
        logicalKey: "external-artist:poison-the-well",
        retryPolicy: "eventual",
      },
    );

    expect(source).toMatchObject({
      kind: "external-artist",
      logicalKey: "external-artist:poison-the-well",
      retryPolicy: "eventual",
    });
  });
});
