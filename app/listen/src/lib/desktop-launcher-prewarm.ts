// Prewarm the desktop launcher's art cache with what the user listens to, so
// the launcher shows covers for familiar music on its first search.
//
// The set is bounded: at most PREWARM_ALBUM_LIMIT albums and
// PREWARM_ARTIST_LIMIT artists, in this order: the most played artists (home
// discovery), then the play history from the newest (PREWARM_HISTORY_LIMIT
// plays, album then artist for each), then recently played home items, then
// followed artists. The shell reports which of them it has not cached
// (`launcher_art_missing`) and only those are fetched, at low priority.

import type { Track } from "@/contexts/player-types";
import {
  albumArtKey,
  artistArtKey,
  prefetchLauncherArt,
  PREWARM_PLAN,
  rememberLauncherArtSource,
  type LauncherArtDeps,
  type LauncherArtSource,
} from "@/lib/desktop-launcher-art";
import type { AlbumRouteInput, ArtistRouteInput } from "@/lib/library-routes";

export const PREWARM_ALBUM_LIMIT = 200;
export const PREWARM_ARTIST_LIMIT = 100;
export const PREWARM_HISTORY_LIMIT = 500;

export type LauncherArtEntry = [key: string, source: LauncherArtSource];

export interface PrewarmAlbum extends AlbumRouteInput {
  albumId?: number | null;
  globalAlbumUid?: string | null;
  albumEntityUid?: string | null;
}

export interface PrewarmArtist extends ArtistRouteInput {
  artistId?: number | null;
  globalArtistUid?: string | null;
  artistEntityUid?: string | null;
}

/** An ordered, deduplicated, capped set of albums and artists to warm. */
export class PrewarmSet {
  private readonly entriesByKey = new Map<string, LauncherArtSource>();
  private albums = 0;
  private artists = 0;

  constructor(
    private readonly albumLimit = PREWARM_ALBUM_LIMIT,
    private readonly artistLimit = PREWARM_ARTIST_LIMIT,
  ) {}

  addAlbum(input: PrewarmAlbum): void {
    const key = albumArtKey(input);
    if (!key || this.entriesByKey.has(key) || this.albums >= this.albumLimit)
      return;
    this.albums += 1;
    this.entriesByKey.set(key, { kind: "album", input });
  }

  addArtist(input: PrewarmArtist): void {
    const key = artistArtKey(input);
    if (!key || this.entriesByKey.has(key) || this.artists >= this.artistLimit)
      return;
    this.artists += 1;
    this.entriesByKey.set(key, { kind: "artist", input });
  }

  addTrack(track: Track): void {
    if (track.album) {
      this.addAlbum({
        albumId: track.albumId,
        globalAlbumUid: track.globalAlbumUid,
        albumEntityUid: track.albumEntityUid,
        albumSlug: track.albumSlug,
        artistSlug: track.artistSlug,
        artistName: track.artist,
        albumName: track.album,
      });
    }
    this.addArtist({
      artistId: track.artistId,
      globalArtistUid: track.globalArtistUid,
      artistEntityUid: track.artistEntityUid,
      artistSlug: track.artistSlug,
      artistName: track.artist,
    });
  }

  entries(): LauncherArtEntry[] {
    return Array.from(this.entriesByKey);
  }
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          !!item && typeof item === "object",
      )
    : [];
}

const text = (value: unknown) =>
  typeof value === "string" && value ? value : undefined;
const id = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

function albumFrom(
  row: Record<string, unknown>,
  name: unknown,
  artist: unknown,
) {
  return {
    albumId: id(row.album_id),
    globalAlbumUid: text(row.global_album_uid),
    albumEntityUid: text(row.album_entity_uid),
    albumSlug: text(row.album_slug),
    artistSlug: text(row.artist_slug),
    artistEntityUid: text(row.artist_entity_uid),
    artistName: text(artist),
    albumName: text(name),
  };
}

function artistFrom(row: Record<string, unknown>, name: unknown) {
  return {
    artistId: id(row.artist_id),
    globalArtistUid: text(row.global_artist_uid),
    artistEntityUid: text(row.artist_entity_uid),
    artistSlug: text(row.artist_slug),
    artistName: text(name),
  };
}

/** Play history rows (`/api/me/history`), newest first. */
export function addHistory(set: PrewarmSet, rows: unknown): void {
  for (const row of records(rows)) {
    if (text(row.album)) set.addAlbum(albumFrom(row, row.album, row.artist));
    set.addArtist(artistFrom(row, row.artist));
  }
}

export function addFavoriteArtists(set: PrewarmSet, discovery: unknown): void {
  const payload = (discovery ?? {}) as Record<string, unknown>;
  for (const row of records(payload.favorite_artists)) {
    set.addArtist(artistFrom(row, row.artist_name));
  }
}

export function addRecentlyPlayed(set: PrewarmSet, discovery: unknown): void {
  const payload = (discovery ?? {}) as Record<string, unknown>;
  for (const row of records(payload.recently_played)) {
    if (row.type === "album") {
      set.addAlbum(albumFrom(row, row.album_name, row.artist_name));
    } else if (row.type === "artist") {
      set.addArtist(artistFrom(row, row.artist_name));
    }
  }
}

export function addFollows(set: PrewarmSet, rows: unknown): void {
  for (const row of records(rows))
    set.addArtist(artistFrom(row, row.artist_name));
}

/**
 * What to warm at startup, from data Listen loads anyway (history, the home
 * discovery snapshot, follows). A source that fails is skipped.
 */
export async function loadPrewarmEntries(
  fetcher: (url: string) => Promise<unknown>,
): Promise<LauncherArtEntry[]> {
  const load = (url: string) => fetcher(url).catch(() => null);
  const [history, discovery, follows] = await Promise.all([
    load(`/api/me/history?limit=${PREWARM_HISTORY_LIMIT}`),
    load("/api/me/home/discovery"),
    load("/api/catalog/me/follows"),
  ]);
  const set = new PrewarmSet();
  addFavoriteArtists(set, discovery);
  addHistory(set, history);
  addRecentlyPlayed(set, discovery);
  addFollows(set, follows);
  return set.entries();
}

/** The albums and artists of some tracks (the queue, the current track). */
export function trackArtEntries(tracks: readonly Track[]): LauncherArtEntry[] {
  const set = new PrewarmSet();
  tracks.forEach((track) => set.addTrack(track));
  return set.entries();
}

export interface PrewarmDeps {
  /** The keys the shell has no image for; null where it has no cache. */
  missing: (keys: string[]) => Promise<string[] | null>;
  art: LauncherArtDeps;
  /** Idle wait between images (tests pass an immediate one). */
  pause?: () => Promise<void>;
}

/**
 * Fetch the entries the shell has not cached, two at a time at low priority.
 * Returns how many were missing, or null when the shell has no cache.
 */
export async function warmLauncherArt(
  entries: readonly LauncherArtEntry[],
  deps: PrewarmDeps,
  signal?: AbortSignal,
): Promise<number | null> {
  const missing = await deps.missing(entries.map(([key]) => key));
  if (!missing) return null;
  if (signal?.aborted || !missing.length) return 0;
  const wanted = new Set(missing);
  for (const [key, source] of entries) {
    if (wanted.has(key)) rememberLauncherArtSource(key, source);
  }
  await prefetchLauncherArt(
    missing,
    deps.art,
    { ...PREWARM_PLAN, pause: deps.pause ?? PREWARM_PLAN.pause },
    signal,
  );
  return missing.length;
}
