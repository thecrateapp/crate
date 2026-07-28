import { type Track } from "@/contexts/PlayerContext";
import { albumCoverApiUrl, artistPhotoApiUrl } from "@/lib/library-routes";
import { toTrackRowData } from "@/lib/track-row-data";
import type { TrackRowData } from "@/components/cards/TrackRow";
import type { GenreProfileItem } from "@crate/ui/domain/genres/GenrePill";

import {
  artistShowToUpcomingItem,
  type ArtistShowEvent,
} from "@/components/upcoming/UpcomingRows";
import type { PlaylistArtworkTrack } from "@/components/playlists/PlaylistArtwork";

export interface ArtistAlbum {
  id?: number | string | null;
  entity_uid?: string | null;
  global_album_uid?: string | null;
  global_uid?: string | null;
  slug?: string;
  name: string;
  display_name: string;
  tracks: number;
  formats: string[];
  size_mb: number;
  year: string;
  has_cover: boolean;
  cover_url?: string | null;
  is_pre_release?: boolean;
  release_date?: string | null;
  release_status?: string | null;
  release_type?: string | null;
  release_secondary_types?: string[];
  release_category?:
    | "album"
    | "ep_single"
    | "compilation"
    | "live"
    | "other"
    | null;
  source_url?: string | null;
}

export interface ArtistData {
  id?: number;
  entity_uid?: string | null;
  global_artist_uid?: string | null;
  global_uid?: string | null;
  slug?: string;
  name: string;
  has_photo?: boolean | null;
  updated_at?: string | null;
  albums: ArtistAlbum[];
  total_tracks: number;
  total_size_mb: number;
  primary_format: string | null;
  genres: string[];
  genre_profile?: GenreProfileItem[];
  issue_count: number;
}

export interface ArtistInfo {
  bio: string;
  tags: string[];
  similar: {
    name: string;
    match: number;
    id?: number;
    slug?: string;
    image_url?: string | null;
    url?: string | null;
    source?: string | null;
  }[];
  listeners: number;
  playcount: number;
  image_url: string | null;
  url: string;
}

export interface ArtistTopTrack {
  id: string;
  globalTrackUid?: string;
  global_track_uid?: string;
  global_uid?: string;
  global_artist_uid?: string;
  track_id?: number;
  track_entity_uid?: string;
  library_track_id?: number;
  artist_id?: number;
  artist_entity_uid?: string;
  artist_slug?: string;
  album_id?: number;
  album_entity_uid?: string;
  global_album_uid?: string;
  album_slug?: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  track: number;
  format?: string | null;
  bitrate?: number | null;
  sample_rate?: number | null;
  bit_depth?: number | null;
  bpm?: number | null;
  audio_key?: string | null;
  audio_scale?: string | null;
  energy?: number | null;
  danceability?: number | null;
  valence?: number | null;
  bliss_vector?: number[] | null;
}

export interface StatsArtist {
  artist_name: string;
  artist_id?: number | null;
  artist_slug?: string | null;
  play_count: number;
  complete_play_count: number;
  minutes_listened: number;
}

export interface StatsListResponse<T> {
  window: string;
  items: T[];
}

export interface ArtistPageEnrichment {
  setlist?: {
    probable_setlist: {
      title: string;
      frequency: number;
      play_count: number;
      last_played?: string;
    }[];
    total_shows: number;
  };
}

export interface ArtistPlaylistAppearance {
  id: number;
  name: string;
  description?: string | null;
  cover_data_url?: string | null;
  is_smart?: boolean | null;
  is_curated?: boolean | null;
  scope?: string | null;
  track_count?: number | null;
  total_duration?: number | null;
  artist_track_count?: number | null;
  artwork_tracks?: PlaylistArtworkTrack[];
}

export interface ArtistPageData {
  artist: ArtistData;
  info: ArtistInfo;
  top_tracks: ArtistTopTrack[];
  shows: {
    events: ArtistShowEvent[];
    configured: boolean;
    source: string;
  };
  appears_on: ArtistPlaylistAppearance[];
  enrichment: ArtistPageEnrichment;
  artist_hot_rank?: number | null;
}

export function buildArtistPhotoUrl(
  artistName: string,
  artistId?: number,
  artistSlug?: string,
  version?: string | null,
) {
  return artistPhotoApiUrl(
    { artistId, artistSlug, artistName },
    { size: 384, version },
  );
}

export function buildArtistAlbumCover(
  artistName: string,
  albumName: string,
  albumId?: number | null,
  albumSlug?: string,
  globalAlbumUid?: string | null,
  albumEntityUid?: string | null,
) {
  return albumCoverApiUrl(
    {
      albumId,
      albumEntityUid,
      globalAlbumUid: albumEntityUid ? undefined : globalAlbumUid,
      albumSlug,
      artistName,
      albumName,
    },
    { size: 512 },
  );
}

export function artistGenreSlug(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s-]+/g, "-");
}

export function sortArtistAlbumsByYear(albums: ArtistAlbum[]) {
  return [...albums].sort((a, b) => {
    const yearA = parseInt(a.year) || 0;
    const yearB = parseInt(b.year) || 0;
    return yearB - yearA;
  });
}

export function buildArtistPlayerTrack(
  track: ArtistTopTrack,
  artistName: string,
  coverFallback?: string,
): Track {
  const globalTrackUid =
    track.globalTrackUid ?? track.global_track_uid ?? track.global_uid;
  return {
    id: globalTrackUid || track.track_entity_uid || track.id,
    globalTrackUid,
    globalArtistUid: track.global_artist_uid,
    globalAlbumUid: track.global_album_uid,
    entityUid: track.track_entity_uid,
    title: track.title || "Unknown",
    artist: track.artist || artistName,
    artistId: track.artist_id,
    artistEntityUid: track.artist_entity_uid,
    artistSlug: track.artist_slug,
    album: track.album,
    albumId: track.album_id,
    albumEntityUid: track.album_entity_uid,
    albumSlug: track.album_slug,
    duration: track.duration,
    path: track.id.includes("/") ? track.id : undefined,
    libraryTrackId: track.library_track_id ?? track.track_id,
    format: track.format ?? undefined,
    bitrate: track.bitrate ?? null,
    sampleRate: track.sample_rate ?? null,
    bitDepth: track.bit_depth ?? null,
    bpm: track.bpm,
    audioKey: track.audio_key,
    audioScale: track.audio_scale,
    energy: track.energy,
    danceability: track.danceability,
    valence: track.valence,
    blissVector: track.bliss_vector,
    albumCover:
      track.artist && track.album
        ? buildArtistAlbumCover(
            track.artist,
            track.album,
            track.album_id,
            track.album_slug,
            track.global_album_uid,
          )
        : coverFallback,
  };
}

export function topTrackToTrackRowData(track: ArtistTopTrack): TrackRowData {
  return toTrackRowData({
    ...track,
    track_number: track.track,
  });
}

export function buildArtistShowItems(events: ArtistShowEvent[]) {
  const seenKeys = new Set<string>();
  const deduped: ArtistShowEvent[] = [];

  for (const event of events) {
    const key =
      event.id ||
      [
        event.artist_name,
        event.date,
        event.venue,
        event.city,
        event.country_code || event.country,
      ]
        .filter(Boolean)
        .join("|")
        .toLowerCase();
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    deduped.push(event);
  }

  return deduped.map(artistShowToUpcomingItem);
}
