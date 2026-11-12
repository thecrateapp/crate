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

import type { PlaySource, Track } from "@/contexts/player-types";
import type {
  AlbumMenuData,
  ArtistMenuData,
} from "@/components/actions/shared";
import {
  albumGlobalUid,
  artistGlobalUid,
  toSearchPlayerTrack,
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
): DesktopSearchItem[] {
  const items: DesktopSearchItem[] = [];
  for (const artist of (data.artists ?? []).slice(0, perKind)) {
    items.push({
      kind: "artist",
      title: artist.name,
      subtitle: "Artist",
      ref: {
        kind: "artist",
        artist: {
          name: artist.name,
          artistId: artist.id,
          artistEntityUid: artist.entity_uid,
          globalArtistUid: artistGlobalUid(artist) ?? undefined,
          artistSlug: artist.slug,
        },
      },
    });
  }
  for (const album of (data.albums ?? []).slice(0, perKind)) {
    items.push({
      kind: "album",
      title: album.name,
      subtitle: album.year ? `${album.artist} · ${album.year}` : album.artist,
      ref: {
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
      },
    });
  }
  for (const track of (data.tracks ?? []).slice(0, perKind)) {
    items.push({
      kind: "track",
      title: track.title,
      subtitle: [track.artist, track.album].filter(Boolean).join(" · "),
      ref: { kind: "track", track: bareTrack(track) },
    });
  }
  return items;
}

export async function searchForDesktop(
  query: string,
  fetcher: (url: string) => Promise<Partial<SearchData>>,
): Promise<DesktopSearchItem[]> {
  const q = query.trim();
  if (!q) return [];
  const data = await fetcher(
    `/api/catalog/search?q=${encodeURIComponent(q)}&limit=${DESKTOP_SEARCH_LIMIT}`,
  );
  return toDesktopSearchItems(data ?? {});
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
