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
// a full prewarm (300) plus a few searches
const MAX_REMEMBERED_SOURCES = 512;
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
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** A square `size` px JPEG, PNG or WebP, or null if it cannot decode. */
  toSquare: (image: Blob, size: number) => Promise<Blob | null>;
  store: (key: string, bytes: number[]) => Promise<unknown>;
  /**
   * A URL of the same image the webview already loaded at 256 px or more
   * (its ticket included), so the HTTP cache can answer without a refetch.
   */
  loadedImage?: (url: string) => string | null;
}

/** How a batch of keys is fetched. */
export interface LauncherArtPlan {
  concurrency: number;
  priority: "high" | "low";
  /** Awaited before each image of a background run (idle time). */
  pause?: () => Promise<void>;
}

/** A search's misses: all tickets in one request, four images at a time. */
export const ON_DEMAND_PLAN: LauncherArtPlan = {
  concurrency: 4,
  priority: "high",
};

const PREWARM_PLAN_CONCURRENCY = 2;

/**
 * What the user plays: low priority, in idle time, two at a time across all
 * background runs together.
 */
export const PREWARM_PLAN: LauncherArtPlan = {
  concurrency: PREWARM_PLAN_CONCURRENCY,
  priority: "low",
  pause: idle,
};

/** Tickets for a prewarm are requested this many at a time. */
const AUTHORIZE_BATCH = 32;
const MAX_STORED_KEYS = 4096;
const stored = new Set<string>();

/** Background (low priority) fetches across all runs, at most this many. */
const BACKGROUND_SLOTS = PREWARM_PLAN_CONCURRENCY;
let backgroundRunning = 0;
const backgroundWaiters: Array<() => void> = [];

async function acquireBackgroundSlot(): Promise<void> {
  if (backgroundRunning < BACKGROUND_SLOTS) {
    backgroundRunning += 1;
    return;
  }
  // the releasing run hands its slot over directly
  await new Promise<void>((resolve) => backgroundWaiters.push(resolve));
}

function releaseBackgroundSlot(): void {
  const next = backgroundWaiters.shift();
  if (next) next();
  else backgroundRunning -= 1;
}

function idle(): Promise<void> {
  return new Promise((resolve) => {
    const idleWindow = globalThis as typeof globalThis & {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
    };
    if (typeof idleWindow.requestIdleCallback === "function") {
      idleWindow.requestIdleCallback(() => resolve(), { timeout: 2_000 });
    } else {
      setTimeout(resolve, 50);
    }
  });
}

function markStored(key: string): void {
  stored.delete(key);
  stored.add(key);
  if (stored.size > MAX_STORED_KEYS) {
    const oldest = stored.values().next().value;
    if (oldest !== undefined) stored.delete(oldest);
  }
}

function sizeOf(url: URL): number | null {
  const size = Number(url.searchParams.get("size"));
  return Number.isFinite(size) && size > 0 ? size : null;
}

/**
 * The smallest copy of `url`'s image (same path and version) the webview has
 * loaded at `LAUNCHER_ART_SIZE` or more, from its resource timing entries.
 * Thumbnails smaller than that are not reused: the crop would be upscaled.
 */
export function findLoadedImage(
  url: string,
  entries: ReadonlyArray<{ name: string }> = loadedResources(),
): string | null {
  let wanted: URL;
  try {
    wanted = new URL(url, "https://crate.local");
  } catch {
    return null;
  }
  const version = wanted.searchParams.get("v");
  let best: { name: string; size: number } | null = null;
  for (const entry of entries) {
    let loaded: URL;
    try {
      loaded = new URL(entry.name);
    } catch {
      continue;
    }
    if (loaded.pathname !== wanted.pathname) continue;
    if (/^https?:/i.test(url) && loaded.origin !== wanted.origin) continue;
    if (version !== loaded.searchParams.get("v")) continue;
    const size = sizeOf(loaded);
    if (size == null || size < LAUNCHER_ART_SIZE) continue;
    if (!best || size < best.size) best = { name: entry.name, size };
  }
  return best?.name ?? null;
}

function loadedResources(): ReadonlyArray<{ name: string }> {
  try {
    return typeof performance?.getEntriesByType === "function"
      ? performance.getEntriesByType("resource")
      : [];
  } catch {
    return [];
  }
}

interface ArtJob {
  key: string;
  url: string;
  reuse: string | null;
  authorized: Promise<string | null> | null;
}

async function imageFor(
  job: ArtJob,
  deps: LauncherArtDeps,
  plan: LauncherArtPlan,
): Promise<Blob | null> {
  const init: RequestInit = { priority: plan.priority } as RequestInit;
  if (job.reuse) {
    try {
      const cached = await deps.fetch(job.reuse, {
        ...init,
        cache: "force-cache",
      });
      if (cached.ok) return await cached.blob();
    } catch {
      // fall back to a fresh fetch
    }
  }
  const authorized = await (job.authorized ??
    deps.authorize(job.url).catch(() => null));
  if (!authorized) return null;
  const response = await deps.fetch(authorized, init);
  return response.ok ? response.blob() : null;
}

async function fetchOne(
  job: ArtJob,
  deps: LauncherArtDeps,
  plan: LauncherArtPlan,
): Promise<void> {
  const image = await imageFor(job, deps, plan);
  if (!image?.size || image.size > MAX_SOURCE_BYTES) return;
  const square = await deps.toSquare(image, LAUNCHER_ART_SIZE);
  if (!square?.size) return;
  const bytes = Array.from(new Uint8Array(await square.arrayBuffer()));
  await deps.store(job.key, bytes);
  markStored(job.key);
}

function plannedJobs(keys: string[]): ArtJob[] {
  const jobs: ArtJob[] = [];
  for (const key of keys) {
    const source = sources.get(key);
    const url = source ? launcherArtUrl(source) : "";
    if (url) jobs.push({ key, url, reuse: null, authorized: null });
  }
  return jobs;
}

/** Ask for every ticket of a batch in the same tick: one batched request. */
function authorizeBatch(jobs: ArtJob[], deps: LauncherArtDeps): void {
  for (const job of jobs) {
    job.reuse = deps.loadedImage?.(job.url) ?? null;
    if (!job.reuse) job.authorized = deps.authorize(job.url).catch(() => null);
  }
}

/**
 * Fetch and store the images the shell reported missing. A search's misses
 * go out together (`ON_DEMAND_PLAN`); the prewarm trickles in idle time
 * (`PREWARM_PLAN`). A key is skipped while another run fetches it or once
 * this session stored it. Failures are dropped: the launcher keeps its icon.
 */
export async function prefetchLauncherArt(
  keys: unknown,
  deps: LauncherArtDeps,
  plan: LauncherArtPlan = ON_DEMAND_PLAN,
  signal?: AbortSignal,
): Promise<void> {
  if (!Array.isArray(keys)) return;
  const wanted = Array.from(
    new Set(
      keys.filter(
        (key): key is string =>
          typeof key === "string" &&
          KEY_PATTERN.test(key) &&
          sources.has(key) &&
          !inFlight.has(key) &&
          !stored.has(key),
      ),
    ),
  );
  const jobs = plannedJobs(wanted);
  const batch = plan.pause ? AUTHORIZE_BATCH : jobs.length;
  let next = 0;
  let authorizedUpTo = 0;
  // workers start in the same tick, so each batch's tickets share a request
  const take = (): ArtJob | undefined => {
    if (next >= authorizedUpTo && next < jobs.length) {
      authorizeBatch(jobs.slice(next, next + batch), deps);
      authorizedUpTo = next + batch;
    }
    return jobs[next++];
  };
  const worker = async () => {
    for (let job = take(); job; job = take()) {
      if (signal?.aborted) return;
      await plan.pause?.();
      if (signal?.aborted) return;
      const background = plan.priority === "low";
      if (background) await acquireBackgroundSlot();
      try {
        if (signal?.aborted) return;
        if (inFlight.has(job.key) || stored.has(job.key)) continue;
        inFlight.add(job.key);
        try {
          await fetchOne(job, deps, plan);
        } catch {
          // offline, expired session, undecodable image: no art this time
        } finally {
          inFlight.delete(job.key);
        }
      } finally {
        if (background) releaseBackgroundSlot();
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(plan.concurrency, jobs.length) }, worker),
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
  stored.clear();
  backgroundRunning = 0;
  backgroundWaiters.length = 0;
}
