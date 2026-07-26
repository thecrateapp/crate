import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  getApiBase: vi.fn(() => "https://api.example.test"),
  getAuthToken: vi.fn(() => "listen-token"),
  apiAssetUrl: vi.fn((path: string) => {
    const url = /^https?:\/\//i.test(path)
      ? path
      : `https://api.example.test${path}`;
    if (/[?&]token=/.test(url)) return url;
    return `${url}${url.includes("?") ? "&" : "?"}token=listen-token`;
  }),
}));

import {
  albumApiPath,
  albumCoverApiUrl,
  globalAlbumPagePath,
  globalAlbumUidFromRouteRef,
  globalArtistPagePath,
  globalArtistUidFromRouteRef,
  albumPagePath,
  albumSharePath,
  artistApiPath,
  artistBackgroundApiUrl,
  genreCoverApiUrl,
  artistPagePath,
  artistPhotoApiUrl,
  artistSharePath,
  artistTopTracksPath,
  isReservedArtistChildSlug,
  responsiveImageSrcSet,
  recordAssetInvalidationScope,
  trackDownloadApiPath,
  trackEffectiveEqApiPath,
  trackEqFeaturesApiPath,
  trackEqPresetApiPath,
  trackGenreApiPath,
  trackInfoApiPath,
  trackPlaybackApiPath,
  trackSharePath,
  trackOfflineManifestApiPath,
  trackStreamApiPath,
} from "@/lib/library-routes";

describe("library route asset helpers", () => {
  afterEach(() => {
    delete (
      window as Window &
        typeof globalThis & {
          __crateResolveApiAssetUrl?: (path: string) => string;
        }
    ).__crateResolveApiAssetUrl;
  });

  it("appends query options before the auth token for album covers", () => {
    const url = albumCoverApiUrl({ albumId: 42 }, { size: 256 });

    expect(url).toBe(
      "https://api.example.test/api/albums/42/cover?size=256&format=webp&token=listen-token",
    );
  });

  it("builds responsive candidates without duplicating image query params", () => {
    const srcSet = responsiveImageSrcSet([160, 320], (size) =>
      albumCoverApiUrl({ albumId: 42 }, { size }),
    );

    expect(srcSet).toBe(
      "https://api.example.test/api/albums/42/cover?size=160&format=webp&token=listen-token 160w, " +
        "https://api.example.test/api/albums/42/cover?size=320&format=webp&token=listen-token 320w",
    );
    expect(srcSet).not.toContain("size=160&size=");
  });

  it("does not double-prefix URLs already resolved by the shared asset resolver", () => {
    (
      window as Window &
        typeof globalThis & {
          __crateResolveApiAssetUrl?: (path: string) => string;
        }
    ).__crateResolveApiAssetUrl = (path: string) => {
      const url = `https://api.example.test${path}`;
      return `${url}${url.includes("?") ? "&" : "?"}token=listen-token`;
    };

    const url = albumCoverApiUrl({ albumId: 42 }, { size: 256 });

    expect(url).toBe(
      "https://api.example.test/api/albums/42/cover?size=256&format=webp&token=listen-token",
    );
  });

  it("preserves multiple asset query params when adding the auth token", () => {
    const url = artistBackgroundApiUrl(
      { artistId: 7 },
      { size: 1280, random: true },
    );

    expect(url).toBe(
      "https://api.example.test/api/artists/7/background?size=1280&random=1&format=webp&token=listen-token",
    );
  });

  it("builds sized artist photo URLs for small listen surfaces", () => {
    const url = artistPhotoApiUrl({ artistId: 9 }, { size: 128 });

    expect(url).toBe(
      "https://api.example.test/api/artists/9/photo?size=128&format=webp&token=listen-token",
    );
  });

  it("falls back to entity UID artist assets when numeric ids are unavailable", () => {
    const url = artistPhotoApiUrl(
      { artistEntityUid: "artist-entity-9" },
      { size: 128 },
    );

    expect(url).toBe(
      "https://api.example.test/api/artists/by-entity/artist-entity-9/photo?size=128&format=webp&token=listen-token",
    );
  });

  it("builds canonical artist background URLs for global artists", () => {
    const url = artistBackgroundApiUrl(
      { globalArtistUid: "artist-global-1" },
      { size: 1280 },
    );

    expect(url).toBe(
      "https://api.example.test/api/catalog/artists/artist-global-1/background?size=1280&format=webp&token=listen-token",
    );
  });

  it("adds a cache-busting artist asset version after invalidation", () => {
    recordAssetInvalidationScope("artist:9", "artwork-2");

    const url = artistPhotoApiUrl({ artistId: 9 }, { size: 128 });

    expect(url).toBe(
      "https://api.example.test/api/artists/9/photo?size=128&v=artwork-2&format=webp&token=listen-token",
    );
  });

  it("adds the local artist invalidation version to canonical asset URLs", () => {
    recordAssetInvalidationScope("artist:19", "artwork-global-19");

    const url = artistBackgroundApiUrl(
      { artistId: 19, globalArtistUid: "artist-global-19" },
      { size: 1280 },
    );

    expect(url).toBe(
      "https://api.example.test/api/catalog/artists/artist-global-19/background?size=1280&v=artwork-global-19&format=webp&token=listen-token",
    );

    expect(
      artistPhotoApiUrl(
        { artistId: 19, globalArtistUid: "artist-global-19" },
        { size: 640 },
      ),
    ).toBe(
      "https://api.example.test/api/catalog/artists/artist-global-19/photo?size=640&v=artwork-global-19&format=webp&token=listen-token",
    );
  });

  it("adds the local album invalidation version to canonical cover URLs", () => {
    recordAssetInvalidationScope("album:23", "artwork-global-23");

    const url = albumCoverApiUrl(
      { albumId: 23, globalAlbumUid: "album-global-23" },
      { size: 640 },
    );

    expect(url).toBe(
      "https://api.example.test/api/catalog/albums/album-global-23/cover?size=640&v=artwork-global-23&format=webp&token=listen-token",
    );
  });

  it("versions curated genre covers from genre invalidation events", () => {
    recordAssetInvalidationScope("genre:post-metal", "genre-artwork-4");

    const url = genreCoverApiUrl("post-metal", { size: 640 });

    expect(url).toBe(
      "https://api.example.test/api/genres/post-metal/cover?size=640&v=genre-artwork-4&format=webp&token=listen-token",
    );
  });

  it("prefers the runtime invalidation version over a stale explicit asset version", () => {
    recordAssetInvalidationScope("artist:11", "artwork-live");

    const url = artistBackgroundApiUrl(
      { artistId: 11 },
      { size: 1280, version: "stale-db-version" },
    );

    expect(url).toBe(
      "https://api.example.test/api/artists/11/background?size=1280&v=artwork-live&format=webp&token=listen-token",
    );
  });

  it("preserves the artist slug as a backend fallback for deep links", () => {
    const path = artistApiPath({ artistId: 52, artistSlug: "poison-the-well" });

    expect(path).toBe("/api/artist-slugs/poison-the-well");
  });

  it("builds canonical artist paths from slugs", () => {
    expect(
      artistPagePath({
        artistId: 7,
        artistSlug: "quicksand",
        artistName: "Quicksand",
      }),
    ).toBe("/artists/quicksand");
    expect(
      artistTopTracksPath({
        artistId: 7,
        artistSlug: "quicksand",
        artistName: "Quicksand",
      }),
    ).toBe("/artists/quicksand/top-tracks");
  });

  it("prefers local artist paths when a local artist also has a global uid", () => {
    expect(
      artistPagePath({
        artistId: 7,
        globalArtistUid: "artist-global-7",
        artistSlug: "quicksand",
        artistName: "Quicksand",
      }),
    ).toBe("/artists/quicksand");
  });

  it("builds fully human artist share paths", () => {
    expect(
      artistSharePath({
        artistId: 7,
        artistEntityUid: "artist-entity-7",
        artistSlug: "quicksand",
        artistName: "Quicksand",
      }),
    ).toBe("/share/artist/quicksand");
  });

  it("builds nested album paths under the artist when the slug is not reserved", () => {
    const path = albumPagePath({
      albumId: 9,
      artistSlug: "quicksand",
      albumSlug: "quicksand-slip",
      artistName: "Quicksand",
      albumName: "Slip",
    });

    expect(path).toBe("/artists/quicksand/slip");
  });

  it("builds human album paths from names when stored slugs are absent", () => {
    expect(
      albumPagePath({
        albumId: 9,
        artistName: "High Vis",
        albumName: "No Sense No Feeling",
      }),
    ).toBe("/artists/high-vis/no-sense-no-feeling");
  });

  it("matches backend slug normalization for non-ASCII punctuation and letters", () => {
    expect(
      albumPagePath({
        albumId: 9,
        artistName: "Derby Motoreta’s Burrito Kachimba",
        albumName: "Bolsa Amarilla y Piedra Potente",
      }),
    ).toBe(
      "/artists/derby-motoretas-burrito-kachimba/bolsa-amarilla-y-piedra-potente",
    );
    expect(
      albumPagePath({
        albumId: 10,
        artistName: "Trentemøller",
        albumName: "Late Night Tales: Trentemøller",
      }),
    ).toBe("/artists/trentemller/late-night-tales-trentemller");
  });

  it("prefers local album paths when a local album also has a global uid", () => {
    expect(
      albumPagePath({
        albumId: 9,
        globalAlbumUid: "785621b5-738e-5922-b6e3-108984976091",
        artistName: "Birds In Row",
        albumName: "Gris Klein",
      }),
    ).toBe("/artists/birds-in-row/gris-klein");
  });

  it("strips stored artist prefixes even when the album name is absent", () => {
    expect(
      albumPagePath({
        albumId: 9,
        artistSlug: "quicksand",
        albumSlug: "quicksand-slip",
      }),
    ).toBe("/artists/quicksand/slip");

    expect(
      albumApiPath({
        artistSlug: "quicksand",
        albumSlug: "quicksand-slip",
      }),
    ).toBe("/api/artist-slugs/quicksand/albums/slip");
  });

  it("keeps album slugs whose title starts with the artist name", () => {
    expect(
      albumPagePath({
        albumId: 9,
        artistSlug: "lip-critic",
        albumSlug: "lip-critic-ii",
      }),
    ).toBe("/artists/lip-critic/lip-critic-ii");

    expect(
      albumApiPath({
        artistSlug: "lip-critic",
        albumSlug: "lip-critic-ii",
      }),
    ).toBe("/api/artist-slugs/lip-critic/albums/lip-critic-ii");
  });

  it("strips only duplicated artist prefixes from stored album slugs", () => {
    expect(
      albumPagePath({
        albumId: 9,
        artistSlug: "lip-critic",
        albumSlug: "lip-critic-lip-critic-ii",
      }),
    ).toBe("/artists/lip-critic/lip-critic-ii");
  });

  it("keeps reserved album slugs human without colliding with artist children", () => {
    const path = albumPagePath({
      albumId: 9,
      artistSlug: "quicksand",
      albumSlug: "quicksand-top-tracks",
      artistName: "Quicksand",
      albumName: "Top Tracks",
    });

    expect(path).toBe("/artists/quicksand/albums/top-tracks");
    expect(isReservedArtistChildSlug("top-tracks")).toBe(true);
  });

  it("resolves album API paths by artist and public album slug", () => {
    const path = albumApiPath({
      artistSlug: "quicksand",
      albumSlug: "quicksand-slip",
      artistName: "Quicksand",
      albumName: "Slip",
    });

    expect(path).toBe("/api/artist-slugs/quicksand/albums/slip");
  });

  it("builds fully human album share paths", () => {
    expect(
      albumSharePath({
        albumId: 9,
        albumEntityUid: "album-entity-9",
        artistName: "Quicksand",
        albumSlug: "quicksand-slip",
        albumName: "Slip",
      }),
    ).toBe("/share/album/quicksand/slip");
  });

  it("falls back to entity UID album APIs and artwork when slugs and numeric ids are unavailable", () => {
    const path = albumApiPath({ albumEntityUid: "album-entity-42" });
    const cover = albumCoverApiUrl(
      { albumEntityUid: "album-entity-42" },
      { size: 256 },
    );

    expect(path).toBe("/api/albums/by-entity/album-entity-42");
    expect(cover).toBe(
      "https://api.example.test/api/albums/by-entity/album-entity-42/cover?size=256&format=webp&token=listen-token",
    );
  });

  it("builds human global catalog page URLs while keeping global asset URLs internal", () => {
    expect(
      globalArtistPagePath({
        globalArtistUid: "257828ee-c041-574d-aedf-2f74ca60e1fa",
        artistName: "High Vis",
      }),
    ).toBe("/artists/high-vis");
    expect(
      globalArtistPagePath({
        globalArtistUid: "artist-global-1",
        artistName: "Birds In Row",
      }),
    ).toBe("/artists/birds-in-row");
    expect(
      globalAlbumPagePath({
        globalAlbumUid: "album-global-1",
        artistName: "High Vis",
        albumName: "No Sense No Feeling",
      }),
    ).toBe("/artists/high-vis/no-sense-no-feeling");
    expect(
      albumCoverApiUrl({ globalAlbumUid: "album-global-1" }, { size: 256 }),
    ).toBe(
      "https://api.example.test/api/catalog/albums/album-global-1/cover?size=256&format=webp&token=listen-token",
    );
  });

  it("never exposes global identifiers in public share URLs", () => {
    expect(
      artistSharePath({
        globalArtistUid: "257828ee-c041-574d-aedf-2f74ca60e1fa",
        artistName: "High Vis",
      }),
    ).toBe("/share/artist/high-vis");
    expect(
      albumSharePath({
        globalAlbumUid: "40919666-af53-5810-a574-9cfeb5cec68b",
        artistName: "High Vis",
        albumName: "Blending",
      }),
    ).toBe("/share/album/high-vis/blending");
  });

  it("parses human global catalog route refs back to stable UIDs", () => {
    expect(
      globalArtistUidFromRouteRef(
        "high-vis--257828ee-c041-574d-aedf-2f74ca60e1fa",
      ),
    ).toBe("257828ee-c041-574d-aedf-2f74ca60e1fa");
    expect(
      globalArtistUidFromRouteRef("257828ee-c041-574d-aedf-2f74ca60e1fa"),
    ).toBe("257828ee-c041-574d-aedf-2f74ca60e1fa");
    expect(globalAlbumUidFromRouteRef("slip--album-global-1")).toBe(
      "album-global-1",
    );
    expect(globalAlbumUidFromRouteRef("album-global-1")).toBe("album-global-1");
  });

  it("builds canonical track routes preferring entity_uid", () => {
    expect(
      trackInfoApiPath({ entityUid: "track-entity-1", libraryTrackId: 12 }),
    ).toBe("/api/tracks/by-entity/track-entity-1/info");
    expect(
      trackPlaybackApiPath({ entityUid: "track-entity-1", libraryTrackId: 12 }),
    ).toBe("/api/tracks/by-entity/track-entity-1/playback");
    expect(trackEqFeaturesApiPath({ entityUid: "track-entity-1" })).toBe(
      "/api/tracks/by-entity/track-entity-1/eq-features",
    );
    expect(trackEffectiveEqApiPath({ entityUid: "track-entity-1" })).toBe(
      "/api/tracks/by-entity/track-entity-1/eq",
    );
    expect(
      trackEqPresetApiPath({
        entityUid: "track-entity-1",
        libraryTrackId: 12,
      }),
    ).toBe("/api/tracks/12/eq-preset");
    expect(trackGenreApiPath({ entityUid: "track-entity-1" })).toBe(
      "/api/tracks/by-entity/track-entity-1/genre",
    );
    expect(trackStreamApiPath({ entityUid: "track-entity-1" })).toBe(
      "/api/tracks/by-entity/track-entity-1/stream",
    );
    expect(trackDownloadApiPath({ entityUid: "track-entity-1" })).toBe(
      "/api/tracks/by-entity/track-entity-1/download",
    );
    expect(trackOfflineManifestApiPath({ entityUid: "track-entity-1" })).toBe(
      "/api/offline/tracks/by-entity/track-entity-1/manifest",
    );
  });

  it("builds global catalog playback routes when a global track uid exists", () => {
    expect(
      trackInfoApiPath({
        globalTrackUid: "global-track-1",
        entityUid: "track-entity-1",
        libraryTrackId: 12,
      }),
    ).toBe("/api/catalog/tracks/global-track-1/info");
    expect(
      trackPlaybackApiPath({
        globalTrackUid: "global-track-1",
        entityUid: "track-entity-1",
        libraryTrackId: 12,
      }),
    ).toBe("/api/catalog/tracks/global-track-1/playback");
    expect(
      trackStreamApiPath({
        globalTrackUid: "global-track-1",
        entityUid: "track-entity-1",
        libraryTrackId: 12,
      }),
    ).toBe("/api/catalog/tracks/global-track-1/stream");
    expect(
      trackEqFeaturesApiPath({
        globalTrackUid: "global-track-1",
        entityUid: "track-entity-1",
        libraryTrackId: 12,
      }),
    ).toBe("/api/catalog/tracks/global-track-1/eq-features");
    expect(
      trackEffectiveEqApiPath({
        globalTrackUid: "global-track-1",
        entityUid: "track-entity-1",
        libraryTrackId: 12,
      }),
    ).toBe("/api/catalog/tracks/global-track-1/eq");
    expect(
      trackGenreApiPath({
        globalTrackUid: "global-track-1",
        entityUid: "track-entity-1",
        libraryTrackId: 12,
      }),
    ).toBe("/api/catalog/tracks/global-track-1/genre");
  });

  it("builds track download and offline manifest routes from numeric ids", () => {
    expect(trackDownloadApiPath({ libraryTrackId: 12 })).toBe(
      "/api/tracks/12/download",
    );
    expect(trackOfflineManifestApiPath({ libraryTrackId: 12 })).toBe(
      "/api/offline/tracks/12/manifest",
    );
  });

  it("builds track offline manifest routes from paths", () => {
    expect(
      trackOfflineManifestApiPath({
        path: "/music/High Vis/Blending/01-talk.flac",
      }),
    ).toBe(
      "/api/offline/tracks/by-path/High%20Vis/Blending/01-talk.flac/manifest",
    );
  });

  it("builds public track share paths from entity_uid", () => {
    expect(
      trackSharePath({
        entityUid: "track-entity-1",
        libraryTrackId: 12,
        title: "Head to Wall",
      }),
    ).toBe("/share/track/track-entity-1/head-to-wall");
  });

  it("builds public track share paths from UUID string ids", () => {
    expect(
      trackSharePath({
        id: "123e4567-e89b-12d3-a456-426614174000",
        title: "Head to Wall",
      }),
    ).toBe("/share/track/123e4567-e89b-12d3-a456-426614174000/head-to-wall");
  });

  it("builds public track share paths from global track uids", () => {
    expect(
      trackSharePath({
        globalTrackUid: "global-track-1",
        title: "Head to Wall",
      }),
    ).toBe("/share/track/global-track-1/head-to-wall");
  });

  it("falls back to id/path routes only when canonical identity is missing", () => {
    expect(trackInfoApiPath({ libraryTrackId: 12 })).toBe(
      "/api/tracks/12/info",
    );
    expect(trackPlaybackApiPath({ libraryTrackId: 12 })).toBe(
      "/api/tracks/12/playback",
    );
    expect(trackEffectiveEqApiPath({ libraryTrackId: 12 })).toBe(
      "/api/tracks/12/eq",
    );
    expect(trackEqPresetApiPath({ libraryTrackId: 12 })).toBe(
      "/api/tracks/12/eq-preset",
    );
    expect(trackStreamApiPath({ libraryTrackId: 12 })).toBe(
      "/api/tracks/12/stream",
    );
    expect(trackDownloadApiPath({ path: "Artist/Album/Track.flac" })).toBe(
      "/api/download/track/Artist/Album/Track.flac",
    );
  });
});
