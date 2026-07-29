import {
  albumCoverAssetPath,
  artistBackgroundAssetPath,
  artistPhotoAssetPath,
  genreCoverAssetPath,
  responsiveImageSrcSet,
  type AlbumRouteInput,
  type ArtistRouteInput,
} from "@/lib/library-routes";

export type ArtworkKind =
  | "album-cover"
  | "artist-background"
  | "artist-photo"
  | "external-artist"
  | "genre-cover"
  | "playlist-cover"
  | "profile-avatar"
  | "public-image"
  | "unknown";

export type ArtworkRetryPolicy = "credentials" | "eventual" | "none";

export type ArtworkPreset =
  | "album-card"
  | "artist-card"
  | "avatar"
  | "genre-card"
  | "hero"
  | "track-row";

export interface ArtworkSource {
  kind: ArtworkKind;
  logicalKey: string;
  src: string | null;
  srcSet?: string;
  sizes?: string;
  retryPolicy: ArtworkRetryPolicy;
}

interface ArtworkSourceOptions {
  kind?: ArtworkKind;
  logicalKey?: string;
  retryPolicy?: ArtworkRetryPolicy;
  srcSet?: string;
  sizes?: string;
}

interface ArtworkFactoryOptions {
  preset?: ArtworkPreset;
  size?: number;
  sizes?: string;
  version?: string | number | null;
  format?: "webp" | null;
  random?: boolean;
  retryPolicy?: ArtworkRetryPolicy;
}

interface ArtworkPresetDefinition {
  size: number;
  widths?: readonly number[];
  sizes?: string;
}

export const ARTWORK_PRESETS: Readonly<
  Record<ArtworkPreset, ArtworkPresetDefinition>
> = {
  "album-card": {
    size: 320,
    widths: [160, 256, 320, 480],
    sizes: "(max-width: 639px) 50vw, (max-width: 1023px) 33vw, 17vw",
  },
  "artist-card": {
    size: 320,
    widths: [160, 256, 320],
    sizes: "(max-width: 639px) 50vw, (max-width: 1023px) 33vw, 17vw",
  },
  avatar: { size: 128, widths: [64, 96, 128], sizes: "128px" },
  "genre-card": {
    size: 640,
    widths: [320, 480, 640],
    sizes: "(max-width: 639px) 80vw, 33vw",
  },
  hero: {
    size: 1280,
    widths: [768, 1280, 2048],
    sizes: "100vw",
  },
  "track-row": { size: 128, widths: [64, 96, 128], sizes: "64px" },
};

function normalizedKey(value: string | null | undefined): string {
  const normalized = (value || "")
    .trim()
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ");
  return normalized ? encodeURIComponent(normalized) : "";
}

function artistLogicalKey(kind: ArtworkKind, input: ArtistRouteInput): string {
  const globalUid = input.globalArtistUid || input.global_artist_uid;
  if (globalUid) return `${kind}:global:${globalUid}`;
  if (input.artistEntityUid) return `${kind}:entity:${input.artistEntityUid}`;
  if (input.artistId != null) return `${kind}:local:${input.artistId}`;
  const fallback = normalizedKey(input.artistSlug || input.artistName);
  return `${kind}:name:${fallback || "unknown"}`;
}

function albumLogicalKey(input: AlbumRouteInput): string {
  const globalUid = input.globalAlbumUid || input.global_album_uid;
  if (globalUid) return `album-cover:global:${globalUid}`;
  if (input.albumEntityUid) {
    return `album-cover:entity:${input.albumEntityUid}`;
  }
  if (input.albumId != null) return `album-cover:local:${input.albumId}`;
  const artist = normalizedKey(input.artistSlug || input.artistName);
  const album = normalizedKey(input.albumSlug || input.albumName);
  return `album-cover:name:${artist || "unknown"}:${album || "unknown"}`;
}

function resolvedOptions(options: ArtworkFactoryOptions) {
  const preset = options.preset ? ARTWORK_PRESETS[options.preset] : undefined;
  return {
    size: options.size ?? preset?.size,
    widths: preset?.widths,
    sizes: options.sizes ?? preset?.sizes,
    version: options.version,
    format: options.format === undefined ? "webp" : options.format,
    random: options.random,
  };
}

function responsiveCandidates(
  widths: readonly number[] | undefined,
  build: (size: number) => string,
): string | undefined {
  return widths ? responsiveImageSrcSet(widths, build) : undefined;
}

export function artworkFromUrl(
  src: string | null | undefined,
  options: ArtworkSourceOptions = {},
): ArtworkSource {
  const value = src?.trim() || null;
  return {
    kind: options.kind ?? "unknown",
    logicalKey:
      options.logicalKey ??
      `${options.kind ?? "unknown"}:url:${value ?? "missing"}`,
    src: value,
    srcSet: options.srcSet,
    sizes: options.sizes,
    retryPolicy: options.retryPolicy ?? "credentials",
  };
}

export function artistPhotoArtwork(
  input: ArtistRouteInput,
  options: ArtworkFactoryOptions = {},
): ArtworkSource {
  const resolved = resolvedOptions(options);
  const build = (size: number) =>
    artistPhotoAssetPath(input, {
      size,
      version: resolved.version,
      format: resolved.format,
      random: resolved.random,
    });
  return {
    kind: "artist-photo",
    logicalKey: artistLogicalKey("artist-photo", input),
    src: resolved.size ? build(resolved.size) : artistPhotoAssetPath(input),
    srcSet: responsiveCandidates(resolved.widths, build),
    sizes: resolved.sizes,
    retryPolicy: options.retryPolicy ?? "credentials",
  };
}

export function artistBackgroundArtwork(
  input: ArtistRouteInput,
  options: ArtworkFactoryOptions = {},
): ArtworkSource {
  const resolved = resolvedOptions(options);
  const build = (size: number) =>
    artistBackgroundAssetPath(input, {
      size,
      version: resolved.version,
      format: resolved.format,
      random: resolved.random,
    });
  return {
    kind: "artist-background",
    logicalKey: artistLogicalKey("artist-background", input),
    src: resolved.size
      ? build(resolved.size)
      : artistBackgroundAssetPath(input),
    srcSet: responsiveCandidates(resolved.widths, build),
    sizes: resolved.sizes,
    retryPolicy: options.retryPolicy ?? "credentials",
  };
}

export function albumCoverArtwork(
  input: AlbumRouteInput,
  options: ArtworkFactoryOptions = {},
): ArtworkSource {
  const resolved = resolvedOptions(options);
  const build = (size: number) =>
    albumCoverAssetPath(input, {
      size,
      version: resolved.version,
      format: resolved.format,
    });
  return {
    kind: "album-cover",
    logicalKey: albumLogicalKey(input),
    src: resolved.size ? build(resolved.size) : albumCoverAssetPath(input),
    srcSet: responsiveCandidates(resolved.widths, build),
    sizes: resolved.sizes,
    retryPolicy: options.retryPolicy ?? "credentials",
  };
}

export function genreCoverArtwork(
  slug: string,
  options: ArtworkFactoryOptions = {},
): ArtworkSource {
  const resolved = resolvedOptions(options);
  const build = (size: number) =>
    genreCoverAssetPath(slug, {
      size,
      version: resolved.version,
      format: resolved.format,
    });
  return {
    kind: "genre-cover",
    logicalKey: `genre-cover:${normalizedKey(slug) || "unknown"}`,
    src: resolved.size ? build(resolved.size) : genreCoverAssetPath(slug),
    srcSet: responsiveCandidates(resolved.widths, build),
    sizes: resolved.sizes,
    retryPolicy: options.retryPolicy ?? "credentials",
  };
}
