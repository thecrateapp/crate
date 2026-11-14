// Search and play for desktop widgets (the Ryoku launcher provider, the MCP
// server), through the desktop control bridge.
//
// `search` returns a short mixed list; each item carries a `ref` that `play_item`
// hands back to play it, with the same helpers the app's own search and menus
// use: a track plays as a one-track queue, an album plays in order, an artist
// plays its top tracks.
//
// Refs leave the app (launcher rows, MCP replies), so they never carry media
// URLs: Crate signs those with a media ticket. A track ref is the bare search
// row; the playable track, with its cover, is built here when it plays.
//
// Items also carry `duration` (tracks) and an internal `art_key` that the
// native shell turns into a cached image path (desktop-launcher-art.ts).

import type { PlaySource, Track } from "@/contexts/player-types";
import type {
  AlbumMenuData,
  ArtistMenuData,
} from "@/components/actions/shared";
import {
  albumArtKey,
  artistArtKey,
  type LauncherArtSource,
} from "@/lib/desktop-launcher-art";
import { albumPagePath, artistPagePath } from "@/lib/library-routes";
import {
  albumGlobalUid,
  artistGlobalUid,
  toSearchPlayerTrack,
  trackGlobalUid,
  type SearchData,
  type SearchTrack,
} from "@/pages/search-results-model";

export const DESKTOP_SEARCH_LIMIT = 8;

export type DesktopPlayRef =
  | { kind: "track"; track: SearchTrack }
  | { kind: "album"; album: AlbumMenuData }
  | { kind: "artist"; artist: ArtistMenuData };

export interface DesktopSearchItem {
  kind: DesktopPlayRef["kind"];
  title: string;
  subtitle: string;
  ref: DesktopPlayRef;
  /** Internal: the shell replaces it with `art`, a cached image path. */
  art_key?: string;
  /** Tracks only: whole seconds. */
  duration?: number;
}

/** Called for each item that has artwork, with where to fetch it. */
export type DesktopArtSink = (key: string, source: LauncherArtSource) => void;

function withArt(
  item: DesktopSearchItem,
  key: string | null,
  source: LauncherArtSource,
  onArt?: DesktopArtSink,
): DesktopSearchItem {
  if (!key) return item;
  onArt?.(key, source);
  return { ...item, art_key: key };
}

function trackAlbumArt(track: SearchTrack): {
  key: string | null;
  source: LauncherArtSource;
} {
  const globalAlbumUid = track.global_album_uid ?? track.album_entity_uid;
  const key = albumArtKey({
    albumId: track.album_id,
    globalAlbumUid: track.global_album_uid,
    albumEntityUid: track.album_entity_uid,
  });
  // the same album input the app's own search rows use for the cover
  const input =
    trackGlobalUid(track) && globalAlbumUid
      ? { globalAlbumUid }
      : {
          albumId: track.album_id,
          albumEntityUid: track.album_entity_uid,
          artistEntityUid: track.artist_entity_uid,
          albumSlug: track.album_slug,
          artistName: track.artist,
          albumName: track.album,
        };
  return { key, source: { kind: "album", input } };
}

const CREDENTIAL_IN_URL =
  /[?&](media_ticket|ticket|token|access_token|signature|sig)=/i;

/** Drop URL fields and anything that carries a credential. */
function bareTrack(track: SearchTrack): SearchTrack {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(track)) {
    if (/url$|cover$/i.test(key)) continue;
    if (
      typeof value === "string" &&
      (CREDENTIAL_IN_URL.test(value) || /^https?:/i.test(value))
    )
      continue;
    out[key] = value;
  }
  return out as unknown as SearchTrack;
}

/** Artists, then albums, then tracks, at most `perKind` of each. */
export function toDesktopSearchItems(
  data: Partial<SearchData>,
  perKind = 4,
  onArt?: DesktopArtSink,
): DesktopSearchItem[] {
  const items: DesktopSearchItem[] = [];
  for (const artist of (data.artists ?? []).slice(0, perKind)) {
    const ref: DesktopPlayRef = {
      kind: "artist",
      artist: {
        name: artist.name,
        artistId: artist.id,
        artistEntityUid: artist.entity_uid,
        globalArtistUid: artistGlobalUid(artist) ?? undefined,
        artistSlug: artist.slug,
      },
    };
    const item: DesktopSearchItem = {
      kind: "artist",
      title: artist.name,
      subtitle: "Artist",
      ref,
    };
    items.push(
      artist.has_photo === false
        ? item
        : withArt(
            item,
            artistArtKey(ref.artist),
            {
              kind: "artist",
              input: { ...ref.artist, artistName: artist.name },
            },
            onArt,
          ),
    );
  }
  for (const album of (data.albums ?? []).slice(0, perKind)) {
    const ref: DesktopPlayRef = {
      kind: "album",
      album: {
        artist: album.artist,
        artistSlug: album.artist_slug,
        artistEntityUid: album.artist_entity_uid,
        album: album.name,
        albumId: album.id,
        albumEntityUid: album.entity_uid,
        globalAlbumUid: albumGlobalUid(album) ?? undefined,
        albumSlug: album.slug,
      },
    };
    const item: DesktopSearchItem = {
      kind: "album",
      title: album.name,
      subtitle: album.year ? `${album.artist} · ${album.year}` : album.artist,
      ref,
    };
    items.push(
      album.has_cover === false
        ? item
        : withArt(
            item,
            albumArtKey(ref.album),
            { kind: "album", input: albumRouteInput(ref.album) },
            onArt,
          ),
    );
  }
  for (const track of (data.tracks ?? []).slice(0, perKind)) {
    const item: DesktopSearchItem = {
      kind: "track",
      title: track.title,
      subtitle: [track.artist, track.album].filter(Boolean).join(" · "),
      ref: { kind: "track", track: bareTrack(track) },
    };
    if (typeof track.duration === "number" && track.duration >= 0) {
      item.duration = Math.round(track.duration);
    }
    const art = trackAlbumArt(track);
    items.push(track.album ? withArt(item, art.key, art.source, onArt) : item);
  }
  return items;
}

export async function searchForDesktop(
  query: string,
  fetcher: (url: string) => Promise<Partial<SearchData>>,
  onArt?: DesktopArtSink,
): Promise<DesktopSearchItem[]> {
  const q = query.trim();
  if (!q) return [];
  const data = await fetcher(
    `/api/catalog/search?q=${encodeURIComponent(q)}&limit=${DESKTOP_SEARCH_LIMIT}`,
  );
  return toDesktopSearchItems(data ?? {}, undefined, onArt);
}

function albumRouteInput(album: AlbumMenuData) {
  return {
    albumId: album.albumId,
    albumEntityUid: album.albumEntityUid,
    globalAlbumUid: album.globalAlbumUid,
    albumSlug: album.albumSlug,
    artistEntityUid: album.artistEntityUid,
    artistSlug: album.artistSlug,
    artistName: album.artist,
    albumName: album.album,
  };
}

/**
 * The page a ref opens in the app: the artist, the album, or a track's album
 * with the track highlighted (`?track=`). Null when the ref is too thin to
 * name a page.
 */
export function desktopRefPagePath(ref: DesktopPlayRef): string | null {
  if (ref.kind === "artist") {
    const path = artistPagePath({
      artistId: ref.artist.artistId,
      artistEntityUid: ref.artist.artistEntityUid,
      globalArtistUid: ref.artist.globalArtistUid,
      artistSlug: ref.artist.artistSlug,
      artistName: ref.artist.name,
    });
    return path === "/artists" ? null : path;
  }
  if (ref.kind === "album") {
    const path = albumPagePath(albumRouteInput(ref.album));
    return path === "/albums" ? null : path;
  }
  const track = ref.track;
  if (!track.album) return null;
  const path = albumPagePath({
    albumId: track.album_id,
    albumEntityUid: track.album_entity_uid,
    globalAlbumUid: track.global_album_uid,
    artistEntityUid: track.artist_entity_uid,
    albumSlug: track.album_slug,
    artistSlug: track.artist_slug,
    artistName: track.artist,
    albumName: track.album,
  });
  if (path === "/albums") return null;
  return track.entity_uid
    ? `${path}?track=${encodeURIComponent(track.entity_uid)}`
    : path;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Accept only the shapes `toDesktopSearchItems` produces. */
export function parseDesktopPlayRef(value: unknown): DesktopPlayRef | null {
  if (!isRecord(value)) return null;
  if (value.kind === "track" && isRecord(value.track)) {
    const t = value.track;
    return typeof t.title === "string" && typeof t.artist === "string"
      ? { kind: "track", track: t as unknown as SearchTrack }
      : null;
  }
  if (value.kind === "album" && isRecord(value.album)) {
    const a = value.album;
    return typeof a.album === "string" && typeof a.artist === "string"
      ? { kind: "album", album: a as unknown as AlbumMenuData }
      : null;
  }
  if (value.kind === "artist" && isRecord(value.artist)) {
    const a = value.artist;
    return typeof a.name === "string"
      ? { kind: "artist", artist: a as unknown as ArtistMenuData }
      : null;
  }
  return null;
}

export interface DesktopPlayActions {
  play: (track: Track, source?: PlaySource) => void;
  playAll: (tracks: Track[], startIndex?: number, source?: PlaySource) => void;
}

export interface DesktopPlayDeps {
  resolveTrack: (track: Track) => Promise<Track>;
  fetchAlbumTracks: (album: AlbumMenuData) => Promise<Track[]>;
  fetchArtistTopTracks: (artist: ArtistMenuData) => Promise<Track[]>;
}

/** A queue_item failure, with a short reason for the desktop client. */
export class DesktopControlError extends Error {}

export interface DesktopQueueActions {
  addToQueue: (track: Track) => void;
  jamQueueLocked: boolean;
}

async function tracksForRef(
  ref: DesktopPlayRef,
  deps: DesktopPlayDeps,
): Promise<Track[]> {
  if (ref.kind === "track") {
    return [await deps.resolveTrack(toSearchPlayerTrack(ref.track))];
  }
  if (ref.kind === "album") return deps.fetchAlbumTracks(ref.album);
  return deps.fetchArtistTopTracks(ref.artist);
}

/**
 * Append a ref to the end of the queue: a track, an album's tracks in order,
 * or an artist's top tracks. Throws DesktopControlError when it cannot.
 */
export async function queueDesktopRef(
  ref: DesktopPlayRef,
  actions: DesktopQueueActions,
  deps: DesktopPlayDeps,
): Promise<number> {
  if (actions.jamQueueLocked) {
    throw new DesktopControlError("The queue is locked by a Jam session");
  }
  let tracks: Track[];
  try {
    tracks = await tracksForRef(ref, deps);
  } catch {
    throw new DesktopControlError("Crate could not load that item");
  }
  if (!tracks.length) throw new DesktopControlError("Nothing to queue");
  tracks.forEach((track) => actions.addToQueue(track));
  return tracks.length;
}

export async function playDesktopRef(
  ref: DesktopPlayRef,
  actions: DesktopPlayActions,
  deps: DesktopPlayDeps,
): Promise<boolean> {
  if (ref.kind === "track") {
    actions.play(await deps.resolveTrack(toSearchPlayerTrack(ref.track)), {
      type: "queue",
      name: "Search",
    });
    return true;
  }
  if (ref.kind === "album") {
    const tracks = await deps.fetchAlbumTracks(ref.album);
    if (!tracks.length) return false;
    const seedId = ref.album.albumId ?? ref.album.globalAlbumUid;
    actions.playAll(tracks, 0, {
      type: "album",
      name: `${ref.album.artist} - ${ref.album.album}`,
      radio: seedId != null ? { seedType: "album", seedId } : undefined,
    });
    return true;
  }
  const tracks = await deps.fetchArtistTopTracks(ref.artist);
  if (!tracks.length) return false;
  actions.playAll(tracks, 0, { type: "queue", name: ref.artist.name });
  return true;
}
