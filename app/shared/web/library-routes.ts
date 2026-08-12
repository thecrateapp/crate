import { encPath } from "./utils";

function resolveAssetUrl(path: string) {
  if (typeof window === "undefined") return path;
  const resolver = (
    window as Window &
      typeof globalThis & {
        __crateResolveApiAssetUrl?: (nextPath: string) => string;
      }
  ).__crateResolveApiAssetUrl;
  return typeof resolver === "function" ? resolver(path) : path;
}

export interface ArtistRouteInput {
  artistId?: number | null;
  artistEntityUid?: string | null;
  globalArtistUid?: string | null;
  global_artist_uid?: string | null;
  artistSlug?: string | null;
  artistName?: string | null;
}

export interface AlbumRouteInput {
  albumId?: number | null;
  albumEntityUid?: string | null;
  globalAlbumUid?: string | null;
  global_album_uid?: string | null;
  artistEntityUid?: string | null;
  albumSlug?: string | null;
  artistSlug?: string | null;
  artistName?: string | null;
  albumName?: string | null;
}

export interface GlobalArtistRouteInput {
  globalArtistUid?: string | null;
  global_artist_uid?: string | null;
  artistSlug?: string | null;
  artistName?: string | null;
}

export interface GlobalAlbumRouteInput {
  globalAlbumUid?: string | null;
  global_album_uid?: string | null;
  albumSlug?: string | null;
  albumName?: string | null;
  artistSlug?: string | null;
  artistName?: string | null;
}

export interface TrackRouteInput {
  id?: string | number | null;
  trackId?: number | null;
  libraryTrackId?: number | null;
  globalTrackUid?: string | null;
  global_track_uid?: string | null;
  entityUid?: string | null;
  trackEntityUid?: string | null;
  trackSlug?: string | null;
  title?: string | null;
  artistName?: string | null;
  path?: string | null;
  trackPath?: string | null;
}

export interface ImageAssetOptions {
  size?: number | null;
  random?: boolean;
  version?: string | number | null;
  format?: "webp" | null;
}

const artistAssetVersions = new Map<number, string>();
const albumAssetVersions = new Map<number, string>();
const genreAssetVersions = new Map<string, string>();
let globalArtistAssetVersion: string | null = null;
let globalAlbumAssetVersion: string | null = null;

const RESERVED_ARTIST_CHILD_SLUGS = new Set(["top-tracks", "shows", "radio"]);

function slugifySegment(value: string | null | undefined, fallback: string) {
  const normalized = (value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase();
  const slug = normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || fallback;
}

function safeSlug(slug: string | null | undefined, fallback: string) {
  return encPath(
    slugifySegment(slug && slug.trim() ? slug : fallback, fallback),
  );
}

function encodeEntityUid(value: string | null | undefined) {
  return value ? encodeURIComponent(value) : "";
}

function uidFromRouteRef(value: string | null | undefined) {
  if (!value) return null;
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    decoded = value;
  }
  const separatorIndex = decoded.lastIndexOf("--");
  const uid = separatorIndex >= 0 ? decoded.slice(separatorIndex + 2) : decoded;
  return uid.trim() || null;
}

function isUuidLike(value: string | null | undefined) {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value,
      ),
  );
}

function resolveTrackEntityUid(input: TrackRouteInput) {
  if (resolveGlobalTrackUid(input)) {
    return input.entityUid || input.trackEntityUid || null;
  }
  if (input.entityUid || input.trackEntityUid) {
    return input.entityUid || input.trackEntityUid || null;
  }
  if (isUuidLike(typeof input.id === "string" ? input.id : null)) {
    return input.id as string;
  }
  return null;
}

function resolveGlobalTrackUid(input: TrackRouteInput) {
  return input.globalTrackUid || input.global_track_uid || null;
}

function resolveTrackLibraryId(input: TrackRouteInput) {
  if (input.libraryTrackId != null) return input.libraryTrackId;
  if (input.trackId != null) return input.trackId;
  if (typeof input.id === "number") return input.id;
  if (typeof input.id === "string" && /^\d+$/.test(input.id))
    return Number(input.id);
  return null;
}

function resolveTrackPath(input: TrackRouteInput) {
  if (input.trackPath && input.trackPath.trim()) return input.trackPath;
  if (input.path && input.path.trim()) return input.path;
  if (typeof input.id === "string" && input.id.includes("/")) return input.id;
  return null;
}

function resolveAlbumEntityUid(input: AlbumRouteInput) {
  return input.albumEntityUid || null;
}

function resolveAlbumLibraryId(input: AlbumRouteInput) {
  return input.albumId ?? null;
}

function encodeTrackPath(path: string) {
  const normalized = path.startsWith("/music/") ? path.slice(7) : path;
  return encodeURIComponent(normalized).replace(/%2F/g, "/");
}

function publicArtistSlug(input: ArtistRouteInput) {
  if (input.artistSlug && input.artistSlug.trim()) {
    return slugifySegment(input.artistSlug, "artist");
  }
  if (input.artistName && input.artistName.trim()) {
    return slugifySegment(input.artistName, "artist");
  }
  return null;
}

function publicAlbumSlug(input: AlbumRouteInput) {
  if (input.albumName && input.albumName.trim()) {
    return slugifySegment(input.albumName, "album");
  }
  if (input.albumSlug && input.albumSlug.trim()) {
    const normalizedAlbumSlug = slugifySegment(input.albumSlug, "album");
    const normalizedArtistSlug = input.artistSlug
      ? slugifySegment(input.artistSlug, "artist")
      : null;
    if (
      normalizedArtistSlug &&
      normalizedAlbumSlug.startsWith(`${normalizedArtistSlug}-`)
    ) {
      const strippedArtistPrefix = normalizedAlbumSlug.slice(
        normalizedArtistSlug.length + 1,
      );
      if (strippedArtistPrefix.startsWith(`${normalizedArtistSlug}-`))
        return strippedArtistPrefix;
      if (!/^(?:[ivxlcdm]+|\d+)$/i.test(strippedArtistPrefix))
        return strippedArtistPrefix;
    }
    return normalizedAlbumSlug;
  }
  return null;
}

export function isReservedArtistChildSlug(slug: string | null | undefined) {
  return slug
    ? RESERVED_ARTIST_CHILD_SLUGS.has(slugifySegment(slug, ""))
    : false;
}

function withAssetOptions(path: string, options?: ImageAssetOptions) {
  if (!options) return path;
  const params = new URLSearchParams();
  if (options.size != null) params.set("size", String(options.size));
  if (options.random) params.set("random", "1");
  if (options.version != null && String(options.version).trim())
    params.set("v", String(options.version));
  if (options.format) params.set("format", options.format);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function resolveAssetVersion(
  explicitVersion: string | number | null | undefined,
  runtimeVersion: string | null | undefined,
) {
  if (runtimeVersion && String(runtimeVersion).trim()) {
    return runtimeVersion;
  }
  if (explicitVersion != null && String(explicitVersion).trim()) {
    return explicitVersion;
  }
  return undefined;
}

export function recordAssetInvalidationScope(
  scope: string,
  version: string | number = Date.now(),
) {
  if (
    scope === "library" ||
    scope === "home" ||
    scope === "shows" ||
    scope === "upcoming"
  ) {
    globalArtistAssetVersion = String(version);
    globalAlbumAssetVersion = String(version);
  }
  if (scope.startsWith("artist:")) {
    const artistId = Number(scope.slice("artist:".length));
    if (Number.isFinite(artistId)) {
      artistAssetVersions.set(artistId, String(version));
    }
    return;
  }
  if (scope.startsWith("album:")) {
    const albumId = Number(scope.slice("album:".length));
    if (Number.isFinite(albumId)) {
      albumAssetVersions.set(albumId, String(version));
    }
    return;
  }
  if (scope.startsWith("genre:")) {
    const genreSlug = slugifySegment(scope.slice("genre:".length), "");
    if (genreSlug) genreAssetVersions.set(genreSlug, String(version));
  }
}

export function artistPagePath(input: ArtistRouteInput) {
  const slug = publicArtistSlug(input);
  if (input.artistId != null && slug) {
    return `/artists/${encPath(slug)}`;
  }
  if (input.artistId != null) {
    return `/artists/${input.artistId}/${safeSlug(
      input.artistSlug,
      input.artistName || "artist",
    )}`;
  }
  const globalPath = globalArtistPagePath(input);
  if (globalPath) return globalPath;
  if (slug) {
    return `/artists/${encPath(slug)}`;
  }
  return "/artists";
}

export function globalArtistPagePath(input: GlobalArtistRouteInput) {
  const slug = publicArtistSlug(input);
  return slug ? `/artists/${encPath(slug)}` : "";
}

export function globalArtistUidFromRouteRef(value: string | null | undefined) {
  return uidFromRouteRef(value);
}

export function artistTopTracksPath(input: ArtistRouteInput) {
  const slug = publicArtistSlug(input);
  if (slug) {
    return `/artists/${encPath(slug)}/top-tracks`;
  }
  if (input.artistId != null) {
    return `/artists/${input.artistId}/${safeSlug(
      input.artistSlug,
      input.artistName || "artist",
    )}/top-tracks`;
  }
  return "/artists";
}

export function artistSharePath(input: ArtistRouteInput) {
  const slug = publicArtistSlug(input);
  return slug ? `/share/artist/${encPath(slug)}` : "/share";
}

export function artistApiPath(input: ArtistRouteInput) {
  const globalArtistUid = input.globalArtistUid || input.global_artist_uid;
  if (globalArtistUid) {
    return `/api/catalog/artists/${encodeEntityUid(globalArtistUid)}/page`;
  }
  const slug = publicArtistSlug(input);
  if (slug) {
    return `/api/artist-slugs/${encPath(slug)}`;
  }
  if (input.artistEntityUid) {
    return `/api/artists/by-entity/${encodeEntityUid(input.artistEntityUid)}`;
  }
  if (input.artistId != null) {
    const params = new URLSearchParams();
    if (input.artistSlug && input.artistSlug.trim()) {
      params.set("slug", input.artistSlug.trim());
    }
    const query = params.toString();
    return query
      ? `/api/artists/${input.artistId}?${query}`
      : `/api/artists/${input.artistId}`;
  }
  return "";
}

export function artistPhotoAssetPath(
  input: ArtistRouteInput,
  options?: ImageAssetOptions,
) {
  const globalArtistUid = input.globalArtistUid || input.global_artist_uid;
  if (globalArtistUid) {
    const runtimeVersion =
      input.artistId != null
        ? artistAssetVersions.get(input.artistId) ?? globalArtistAssetVersion
        : globalArtistAssetVersion;
    return withAssetOptions(
      `/api/catalog/artists/${encodeEntityUid(globalArtistUid)}/photo`,
      {
        ...options,
        version: resolveAssetVersion(options?.version, runtimeVersion),
      },
    );
  }
  if (input.artistId != null) {
    const runtimeVersion =
      artistAssetVersions.get(input.artistId) ?? globalArtistAssetVersion;
    return withAssetOptions(`/api/artists/${input.artistId}/photo`, {
      ...options,
      version: resolveAssetVersion(options?.version, runtimeVersion),
    });
  }
  if (input.artistEntityUid) {
    return withAssetOptions(
      `/api/artists/by-entity/${encodeEntityUid(input.artistEntityUid)}/photo`,
      {
        ...options,
        version: resolveAssetVersion(
          options?.version,
          globalArtistAssetVersion,
        ),
      },
    );
  }
  return "";
}

export function artistPhotoApiUrl(
  input: ArtistRouteInput,
  options?: ImageAssetOptions,
) {
  return resolveAssetUrl(artistPhotoAssetPath(input, options));
}

export function artistBackgroundAssetPath(
  input: ArtistRouteInput,
  options?: ImageAssetOptions,
) {
  const globalArtistUid = input.globalArtistUid || input.global_artist_uid;
  if (globalArtistUid) {
    const runtimeVersion =
      input.artistId != null
        ? artistAssetVersions.get(input.artistId) ?? globalArtistAssetVersion
        : globalArtistAssetVersion;
    return withAssetOptions(
      `/api/catalog/artists/${encodeEntityUid(globalArtistUid)}/background`,
      {
        ...options,
        version: resolveAssetVersion(options?.version, runtimeVersion),
      },
    );
  }
  if (input.artistId != null) {
    const runtimeVersion =
      artistAssetVersions.get(input.artistId) ?? globalArtistAssetVersion;
    return withAssetOptions(`/api/artists/${input.artistId}/background`, {
      ...options,
      version: resolveAssetVersion(options?.version, runtimeVersion),
    });
  }
  if (input.artistEntityUid) {
    return withAssetOptions(
      `/api/artists/by-entity/${encodeEntityUid(
        input.artistEntityUid,
      )}/background`,
      {
        ...options,
        version: resolveAssetVersion(
          options?.version,
          globalArtistAssetVersion,
        ),
      },
    );
  }
  return "";
}

export function artistBackgroundApiUrl(
  input: ArtistRouteInput,
  options?: ImageAssetOptions,
) {
  return resolveAssetUrl(artistBackgroundAssetPath(input, options));
}

export function artistHeroAssetPath(
  input: ArtistRouteInput,
  composition: "desktop" | "mobile",
  options?: ImageAssetOptions,
) {
  let path = "";
  if (input.artistId != null) {
    path = `/api/artists/${input.artistId}/hero`;
  } else if (input.artistEntityUid) {
    path = `/api/artists/by-entity/${encodeEntityUid(
      input.artistEntityUid,
    )}/hero`;
  }
  if (!path) return "";
  const params = new URLSearchParams({ composition });
  if (options?.size != null) params.set("size", String(options.size));
  if (options?.version != null && String(options.version).trim())
    params.set("v", String(options.version));
  if (options?.format) params.set("format", options.format);
  return `${path}?${params.toString()}`;
}

export function artistHeroApiUrl(
  input: ArtistRouteInput,
  composition: "desktop" | "mobile",
  options?: ImageAssetOptions,
) {
  return resolveAssetUrl(artistHeroAssetPath(input, composition, options));
}

export function albumPagePath(input: AlbumRouteInput) {
  const artistSlug = publicArtistSlug({
    artistId: null,
    artistSlug: input.artistSlug,
    artistName: input.artistName,
  });
  const albumSlug = publicAlbumSlug(input);
  const hasGlobalAlbumUid = Boolean(
    input.globalAlbumUid || input.global_album_uid,
  );
  const localAlbumPath =
    artistSlug && albumSlug
      ? isReservedArtistChildSlug(albumSlug)
        ? `/artists/${encPath(artistSlug)}/albums/${encPath(albumSlug)}`
        : `/artists/${encPath(artistSlug)}/${encPath(albumSlug)}`
      : "";
  if (localAlbumPath && (input.albumId != null || !hasGlobalAlbumUid)) {
    return localAlbumPath;
  }
  if (input.albumId != null) {
    return `/albums/${input.albumId}/${safeSlug(
      input.albumSlug,
      input.albumName || "album",
    )}`;
  }
  const globalPath = globalAlbumPagePath(input);
  if (globalPath) return globalPath;
  if (localAlbumPath) {
    return localAlbumPath;
  }
  return "/albums";
}

export function globalAlbumPagePath(input: GlobalAlbumRouteInput) {
  const artistSlug = publicArtistSlug(input);
  const albumSlug = publicAlbumSlug(input);
  if (!artistSlug || !albumSlug) return "";
  return isReservedArtistChildSlug(albumSlug)
    ? `/artists/${encPath(artistSlug)}/albums/${encPath(albumSlug)}`
    : `/artists/${encPath(artistSlug)}/${encPath(albumSlug)}`;
}

export function globalAlbumUidFromRouteRef(value: string | null | undefined) {
  return uidFromRouteRef(value);
}

export function albumApiPath(input: AlbumRouteInput) {
  const globalAlbumUid = input.globalAlbumUid || input.global_album_uid;
  if (globalAlbumUid) {
    return `/api/catalog/albums/${encodeEntityUid(globalAlbumUid)}`;
  }
  const artistSlug = publicArtistSlug({
    artistId: null,
    artistEntityUid: input.artistEntityUid,
    artistSlug: input.artistSlug,
    artistName: input.artistName,
  });
  const albumSlug = publicAlbumSlug(input);
  if (artistSlug && albumSlug) {
    return `/api/artist-slugs/${encPath(artistSlug)}/albums/${encPath(
      albumSlug,
    )}`;
  }
  if (input.albumEntityUid) {
    return `/api/albums/by-entity/${encodeEntityUid(input.albumEntityUid)}`;
  }
  if (input.albumId != null) {
    return `/api/albums/${input.albumId}`;
  }
  return "";
}

export function albumSharePath(input: AlbumRouteInput) {
  const artistSlug = publicArtistSlug(input);
  const albumSlug = publicAlbumSlug(input);
  return artistSlug && albumSlug
    ? `/share/album/${encPath(artistSlug)}/${encPath(albumSlug)}`
    : "/share";
}

export function albumRelatedApiPath(input: AlbumRouteInput) {
  if (input.albumEntityUid) {
    return `/api/albums/by-entity/${encodeEntityUid(
      input.albumEntityUid,
    )}/related`;
  }
  if (input.albumId != null) {
    return `/api/albums/${input.albumId}/related`;
  }
  return "";
}

export function trackInfoApiPath(input: TrackRouteInput) {
  const globalTrackUid = resolveGlobalTrackUid(input);
  if (globalTrackUid)
    return `/api/catalog/tracks/${encodeEntityUid(globalTrackUid)}/info`;

  const entityUid = resolveTrackEntityUid(input);
  if (entityUid)
    return `/api/tracks/by-entity/${encodeEntityUid(entityUid)}/info`;

  const trackId = resolveTrackLibraryId(input);
  if (trackId != null) return `/api/tracks/${trackId}/info`;

  const path = resolveTrackPath(input);
  if (path) return `/api/track-info/${encodeTrackPath(path)}`;

  return "";
}

export function trackPlaybackApiPath(input: TrackRouteInput) {
  const globalTrackUid = resolveGlobalTrackUid(input);
  if (globalTrackUid)
    return `/api/catalog/tracks/${encodeEntityUid(globalTrackUid)}/playback`;

  const entityUid = resolveTrackEntityUid(input);
  if (entityUid)
    return `/api/tracks/by-entity/${encodeEntityUid(entityUid)}/playback`;

  const trackId = resolveTrackLibraryId(input);
  if (trackId != null) return `/api/tracks/${trackId}/playback`;

  return "";
}

export function trackEqFeaturesApiPath(input: TrackRouteInput) {
  const globalTrackUid = resolveGlobalTrackUid(input);
  if (globalTrackUid)
    return `/api/catalog/tracks/${encodeEntityUid(globalTrackUid)}/eq-features`;

  const entityUid = resolveTrackEntityUid(input);
  if (entityUid)
    return `/api/tracks/by-entity/${encodeEntityUid(entityUid)}/eq-features`;

  const trackId = resolveTrackLibraryId(input);
  if (trackId != null) return `/api/tracks/${trackId}/eq-features`;

  return "";
}

export function trackEffectiveEqApiPath(input: TrackRouteInput) {
  const globalTrackUid = resolveGlobalTrackUid(input);
  if (globalTrackUid)
    return `/api/catalog/tracks/${encodeEntityUid(globalTrackUid)}/eq`;

  const entityUid = resolveTrackEntityUid(input);
  if (entityUid)
    return `/api/tracks/by-entity/${encodeEntityUid(entityUid)}/eq`;

  const trackId = resolveTrackLibraryId(input);
  if (trackId != null) return `/api/tracks/${trackId}/eq`;

  return "";
}

export function trackEqPresetApiPath(input: TrackRouteInput) {
  const trackId = resolveTrackLibraryId(input);
  if (trackId != null) return `/api/tracks/${trackId}/eq-preset`;
  return "";
}

export function trackGenreApiPath(input: TrackRouteInput) {
  const globalTrackUid = resolveGlobalTrackUid(input);
  if (globalTrackUid)
    return `/api/catalog/tracks/${encodeEntityUid(globalTrackUid)}/genre`;

  const entityUid = resolveTrackEntityUid(input);
  if (entityUid)
    return `/api/tracks/by-entity/${encodeEntityUid(entityUid)}/genre`;

  const trackId = resolveTrackLibraryId(input);
  if (trackId != null) return `/api/tracks/${trackId}/genre`;

  return "";
}

export function trackStreamApiPath(input: TrackRouteInput) {
  const globalTrackUid = resolveGlobalTrackUid(input);
  if (globalTrackUid)
    return `/api/catalog/tracks/${encodeEntityUid(globalTrackUid)}/stream`;

  const entityUid = resolveTrackEntityUid(input);
  if (entityUid)
    return `/api/tracks/by-entity/${encodeEntityUid(entityUid)}/stream`;

  const trackId = resolveTrackLibraryId(input);
  if (trackId != null) return `/api/tracks/${trackId}/stream`;

  const path = resolveTrackPath(input);
  if (path) return `/api/stream/${encodeTrackPath(path)}`;

  return "";
}

export function trackDownloadApiPath(input: TrackRouteInput) {
  const entityUid = resolveTrackEntityUid(input);
  if (entityUid)
    return `/api/tracks/by-entity/${encodeEntityUid(entityUid)}/download`;

  const trackId = resolveTrackLibraryId(input);
  if (trackId != null) return `/api/tracks/${trackId}/download`;

  const path = resolveTrackPath(input);
  if (path) return `/api/download/track/${encodeTrackPath(path)}`;

  return "";
}

export function albumDownloadApiPath(input: AlbumRouteInput) {
  const entityUid = resolveAlbumEntityUid(input);
  if (entityUid)
    return `/api/albums/by-entity/${encodeEntityUid(entityUid)}/download`;

  const albumId = resolveAlbumLibraryId(input);
  if (albumId != null) return `/api/albums/${albumId}/download`;

  return "";
}

export function trackOfflineManifestApiPath(input: TrackRouteInput) {
  const entityUid = resolveTrackEntityUid(input);
  if (entityUid)
    return `/api/offline/tracks/by-entity/${encodeEntityUid(
      entityUid,
    )}/manifest`;

  const trackId = resolveTrackLibraryId(input);
  if (trackId != null) return `/api/offline/tracks/${trackId}/manifest`;

  const path = resolveTrackPath(input);
  if (path)
    return `/api/offline/tracks/by-path/${encodeTrackPath(path)}/manifest`;

  return "";
}

export function trackSharePath(input: TrackRouteInput) {
  const entityUid = resolveTrackEntityUid(input);
  const libraryId = resolveTrackLibraryId(input);
  const globalTrackUid = resolveGlobalTrackUid(input);
  const ref = entityUid || libraryId || globalTrackUid;
  const slug = safeSlug(
    input.trackSlug,
    input.title || input.artistName || "track",
  );
  return ref ? `/share/track/${encodeURIComponent(ref)}/${slug}` : "/share";
}

export function albumCoverAssetPath(
  input: AlbumRouteInput,
  options?: ImageAssetOptions,
) {
  const globalAlbumUid = input.globalAlbumUid || input.global_album_uid;
  if (globalAlbumUid) {
    const runtimeVersion =
      input.albumId != null
        ? albumAssetVersions.get(input.albumId) ?? globalAlbumAssetVersion
        : globalAlbumAssetVersion;
    return withAssetOptions(
      `/api/catalog/albums/${encodeEntityUid(globalAlbumUid)}/cover`,
      {
        ...options,
        version: resolveAssetVersion(options?.version, runtimeVersion),
      },
    );
  }
  if (input.albumId != null) {
    const runtimeVersion =
      albumAssetVersions.get(input.albumId) ?? globalAlbumAssetVersion;
    return withAssetOptions(`/api/albums/${input.albumId}/cover`, {
      ...options,
      version: resolveAssetVersion(options?.version, runtimeVersion),
    });
  }
  if (input.albumEntityUid) {
    return withAssetOptions(
      `/api/albums/by-entity/${encodeEntityUid(input.albumEntityUid)}/cover`,
      {
        ...options,
        version: resolveAssetVersion(options?.version, globalAlbumAssetVersion),
      },
    );
  }
  return "";
}

export function albumCoverApiUrl(
  input: AlbumRouteInput,
  options?: ImageAssetOptions,
) {
  return resolveAssetUrl(albumCoverAssetPath(input, options));
}

export function genreCoverAssetPath(slug: string, options?: ImageAssetOptions) {
  const normalizedSlug = slugifySegment(slug, "");
  if (!normalizedSlug) return "";
  return withAssetOptions(`/api/genres/${encPath(normalizedSlug)}/cover`, {
    ...options,
    version: resolveAssetVersion(
      options?.version,
      genreAssetVersions.get(normalizedSlug),
    ),
  });
}

export function genreCoverApiUrl(slug: string, options?: ImageAssetOptions) {
  return resolveAssetUrl(genreCoverAssetPath(slug, options));
}
