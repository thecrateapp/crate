// Artwork for desktop launchers that show control-socket search results.
//
// Each search item carries an internal `art_key` (`album:<id>` or
// `artist:<id>`). The native shell swaps it for the path of a cached image
// when it has one, and answers `desktop_control_reply` with the keys it lacks.
// This module fetches those with the app's session, crops them to 256 px
// squares and hands the bytes to the shell (`store_launcher_art`), which
// writes them to its cache; the next search shows them.
//
// Image URLs carry the user's media ticket, so they stay in this module: keys
// are entity ids, and only bytes cross to the shell.

import type { AlbumRouteInput, ArtistRouteInput } from "@/lib/library-routes";
import { albumCoverApiUrl, artistPhotoApiUrl } from "@/lib/library-routes";

export const LAUNCHER_ART_SIZE = 256;
const MAX_REMEMBERED_SOURCES = 256;
const MAX_CONCURRENT_FETCHES = 3;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const KEY_PATTERN = /^(album|artist):[A-Za-z0-9._:-]{1,150}$/;

export type LauncherArtSource =
  | { kind: "album"; input: AlbumRouteInput }
  | { kind: "artist"; input: ArtistRouteInput };

type Id = string | number | null | undefined;

function keyFor(
  kind: "album" | "artist",
  id: Id,
  globalUid: Id,
  entityUid: Id,
): string | null {
  const candidates = [
    id != null && id !== "" ? `${kind}:${id}` : null,
    globalUid ? `${kind}:g:${globalUid}` : null,
    entityUid ? `${kind}:e:${entityUid}` : null,
  ];
  return candidates.find((key) => key && KEY_PATTERN.test(key)) ?? null;
}

/** A stable cache key for an album's cover: an id, never a URL. */
export function albumArtKey(input: {
  albumId?: Id;
  globalAlbumUid?: Id;
  albumEntityUid?: Id;
}): string | null {
  return keyFor(
    "album",
    input.albumId,
    input.globalAlbumUid,
    input.albumEntityUid,
  );
}

/** A stable cache key for an artist's photo: an id, never a URL. */
export function artistArtKey(input: {
  artistId?: Id;
  globalArtistUid?: Id;
  artistEntityUid?: Id;
}): string | null {
  return keyFor(
    "artist",
    input.artistId,
    input.globalArtistUid,
    input.artistEntityUid,
  );
}

const sources = new Map<string, LauncherArtSource>();
const inFlight = new Set<string>();

/** Remember where a key's image comes from, for a later fetch. */
export function rememberLauncherArtSource(
  key: string,
  source: LauncherArtSource,
): void {
  sources.delete(key);
  sources.set(key, source);
  while (sources.size > MAX_REMEMBERED_SOURCES) {
    const oldest = sources.keys().next().value;
    if (oldest === undefined) break;
    sources.delete(oldest);
  }
}

export function launcherArtUrl(source: LauncherArtSource): string {
  return source.kind === "album"
    ? albumCoverApiUrl(source.input, { size: LAUNCHER_ART_SIZE })
    : artistPhotoApiUrl(source.input, { size: LAUNCHER_ART_SIZE });
}

export interface LauncherArtDeps {
  /** Adds the media ticket the image route needs. */
  authorize: (url: string) => Promise<string>;
  fetch: (url: string) => Promise<Response>;
  /** A square `size` px JPEG, PNG or WebP, or null if it cannot decode. */
  toSquare: (image: Blob, size: number) => Promise<Blob | null>;
  store: (key: string, bytes: number[]) => Promise<unknown>;
}

async function fetchOne(key: string, deps: LauncherArtDeps): Promise<void> {
  const source = sources.get(key);
  if (!source) return;
  const url = launcherArtUrl(source);
  if (!url) return;
  const response = await deps.fetch(await deps.authorize(url));
  if (!response.ok) return;
  const image = await response.blob();
  if (!image.size || image.size > MAX_SOURCE_BYTES) return;
  const square = await deps.toSquare(image, LAUNCHER_ART_SIZE);
  if (!square?.size) return;
  const bytes = Array.from(new Uint8Array(await square.arrayBuffer()));
  await deps.store(key, bytes);
}

/**
 * Fetch and store the images the shell reported missing, a few at a time,
 * in the background. Failures are dropped: the launcher keeps its icon.
 */
export async function prefetchLauncherArt(
  keys: unknown,
  deps: LauncherArtDeps,
): Promise<void> {
  if (!Array.isArray(keys)) return;
  const queue = keys.filter(
    (key): key is string =>
      typeof key === "string" &&
      KEY_PATTERN.test(key) &&
      sources.has(key) &&
      !inFlight.has(key),
  );
  queue.forEach((key) => inFlight.add(key));
  const worker = async () => {
    for (let key = queue.shift(); key; key = queue.shift()) {
      try {
        await fetchOne(key, deps);
      } catch {
        // offline, expired session, undecodable image: no art this time
      } finally {
        inFlight.delete(key);
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(MAX_CONCURRENT_FETCHES, queue.length) },
      worker,
    ),
  );
}

/** Center-crop and scale an image to a `size` px square JPEG. */
export async function squareJpeg(
  image: Blob,
  size: number,
): Promise<Blob | null> {
  if (typeof createImageBitmap !== "function") return null;
  const bitmap = await createImageBitmap(image);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    if (!side) return null;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      size,
      size,
    );
    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.86),
    );
  } finally {
    bitmap.close();
  }
}

export function resetLauncherArtForTests(): void {
  sources.clear();
  inFlight.clear();
}
