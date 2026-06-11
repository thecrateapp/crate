import { type Track } from "@/contexts/PlayerContext";
import {
  albumCoverApiUrl,
  albumPagePath,
  artistPagePath,
  artistPhotoApiUrl,
} from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";

export interface SearchResult {
  artists: { id?: number; entity_uid?: string; slug?: string; name: string }[];
  albums: {
    id?: number;
    entity_uid?: string;
    slug?: string;
    artist: string;
    artist_id?: number;
    artist_entity_uid?: string;
    artist_slug?: string;
    name: string;
  }[];
  tracks: {
    id?: number;
    entity_uid?: string;
    slug?: string;
    title: string;
    artist: string;
    artist_id?: number;
    artist_entity_uid?: string;
    artist_slug?: string;
    album: string;
    album_id?: number;
    album_entity_uid?: string;
    album_slug?: string;
    path?: string;
  }[];
}

export interface TopBarSearchItem {
  type: "artist" | "album" | "track";
  label: string;
  sublabel?: string;
  navigateTo?: string;
  imageUrl?: string;
  trackData?: Track;
}

export interface TopBarSearchRecentEntry {
  label: string;
  type?: TopBarSearchItem["type"];
  navigateTo?: string;
}

const RECENTS_KEY = "listen-search-recents";
const MAX_RECENTS = 5;

function isTopBarSearchRecentEntry(
  value: unknown,
): value is TopBarSearchRecentEntry {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    "label" in (value as object) &&
    typeof (value as { label?: unknown }).label === "string" &&
    ("type" in (value as object)
      ? ["artist", "album", "track"].includes(
          String((value as { type?: unknown }).type),
        )
      : true) &&
    ("navigateTo" in (value as object)
      ? typeof (value as { navigateTo?: unknown }).navigateTo === "string"
      : true)
  );
}

export function getTopBarSearchRecents(): TopBarSearchRecentEntry[] {
  try {
    const stored = JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]");
    if (!Array.isArray(stored)) {
      return [];
    }
    return stored
      .map((entry) =>
        typeof entry === "string"
          ? { label: entry }
          : isTopBarSearchRecentEntry(entry)
            ? entry
            : null,
      )
      .filter((entry): entry is TopBarSearchRecentEntry => entry !== null);
  } catch {
    return [];
  }
}

function dedupeRecentEntries(entries: TopBarSearchRecentEntry[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.type ?? "query"}:${entry.navigateTo ?? entry.label}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function addTopBarSearchRecent(
  entry: string | TopBarSearchItem | TopBarSearchRecentEntry,
) {
  const recent: TopBarSearchRecentEntry =
    typeof entry === "string"
      ? { label: entry }
      : {
          label: entry.label,
          type: entry.type,
          navigateTo: entry.navigateTo,
        };

  const recents = getTopBarSearchRecents().filter(
    (recentItem) =>
      !(
        recentItem.type === recent.type &&
        (recentItem.navigateTo ?? recentItem.label) ===
          (recent.navigateTo ?? recent.label)
      ),
  );

  recents.unshift(recent);
  const deduped = dedupeRecentEntries(recents);
  localStorage.setItem(
    RECENTS_KEY,
    JSON.stringify(deduped.slice(0, MAX_RECENTS)),
  );
}

export function flattenTopBarSearchResults(
  data: SearchResult,
): TopBarSearchItem[] {
  const items: TopBarSearchItem[] = [];

  for (const artist of data.artists) {
    items.push({
      type: "artist",
      label: artist.name,
      navigateTo: artistPagePath({
        artistId: artist.id,
        artistSlug: artist.slug,
        artistName: artist.name,
      }),
      imageUrl: artistPhotoApiUrl(
        {
          artistId: artist.id,
          artistEntityUid: artist.entity_uid,
          artistSlug: artist.slug,
          artistName: artist.name,
        },
        { size: 128 },
      ),
    });
  }

  for (const album of data.albums) {
    items.push({
      type: "album",
      label: album.name,
      sublabel: album.artist,
      navigateTo: albumPagePath({
        albumId: album.id,
        albumSlug: album.slug,
        artistName: album.artist,
        albumName: album.name,
      }),
      imageUrl: albumCoverApiUrl(
        {
          albumId: album.id,
          albumEntityUid: album.entity_uid,
          artistEntityUid: album.artist_entity_uid,
          albumSlug: album.slug,
          artistName: album.artist,
          albumName: album.name,
        },
        { size: 128 },
      ),
    });
  }

  for (const track of data.tracks) {
    items.push({
      type: "track",
      label: track.title,
      sublabel: `${track.artist} - ${track.album}`,
      imageUrl: track.album
        ? albumCoverApiUrl(
            {
              albumId: track.album_id,
              albumEntityUid: track.album_entity_uid,
              artistEntityUid: track.artist_entity_uid,
              albumSlug: track.album_slug,
              artistName: track.artist,
              albumName: track.album,
            },
            { size: 128 },
          )
        : undefined,
      trackData: toPlayableTrack(track),
    });
  }

  return items;
}
