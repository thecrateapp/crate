import { toast } from "sonner";

import { action, type MenuActionConfig } from "@crate/ui/domain/actions";

import {
  buildArtistPlayerTrack,
  type ArtistTopTrack,
} from "@/components/artist/artist-model";
import type { Track } from "@/contexts/PlayerContext";
import { api } from "@/lib/api";
import { isUuidLikeTrackId, toPlayableTrack } from "@/lib/playable-track";
import { publicShareUrl } from "@/lib/share-url";
import { openShareSheet, type SharePayload } from "@/lib/social-share";
import {
  albumApiPath,
  albumCoverApiUrl,
  artistApiPath,
  artistPhotoApiUrl,
} from "@/lib/library-routes";

export type { MenuActionConfig };
export { action };

export interface TrackMenuData {
  id?: string | number;
  global_track_uid?: string;
  global_artist_uid?: string;
  global_album_uid?: string;
  entity_uid?: string;
  slug?: string;
  title: string;
  artist: string;
  artist_id?: number;
  artist_entity_uid?: string;
  artist_slug?: string;
  album?: string;
  album_id?: number;
  album_entity_uid?: string;
  album_slug?: string;
  duration?: number;
  path?: string;
  library_track_id?: number;
  format?: string;
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
  is_suggested?: boolean;
  suggestion_source?: "playlist";
}

export interface AlbumMenuData {
  artist: string;
  artistSlug?: string;
  artistEntityUid?: string;
  album: string;
  albumId?: number;
  albumEntityUid?: string;
  globalAlbumUid?: string;
  albumSlug?: string;
  cover?: string;
}

export interface ArtistMenuData {
  artistId?: number;
  artistEntityUid?: string;
  globalArtistUid?: string;
  artistSlug?: string;
  imageUrl?: string | null;
  name: string;
}

export interface PlaylistMenuData {
  playlistId?: number;
  name: string;
  isSmart?: boolean;
  href?: string;
  canFollow?: boolean;
  isFollowed?: boolean;
  onToggleFollow?: () => Promise<void> | void;
  onPlay?: () => Promise<void> | void;
  onShuffle?: () => Promise<void> | void;
  onStartRadio?: () => Promise<void> | void;
}

/** Normalize any full `Track` (camelCase) into the menu-friendly shape preserving suggestion metadata. */
export function trackToMenuData(track: Track): TrackMenuData {
  const entityUid =
    track.entityUid || (isUuidLikeTrackId(track.id) ? track.id : undefined);

  return {
    id: track.id,
    global_track_uid: track.globalTrackUid,
    global_artist_uid: track.globalArtistUid,
    global_album_uid: track.globalAlbumUid,
    entity_uid: entityUid,
    title: track.title,
    artist: track.artist,
    artist_id: track.artistId,
    artist_entity_uid: track.artistEntityUid,
    artist_slug: track.artistSlug,
    album: track.album,
    album_id: track.albumId,
    album_entity_uid: track.albumEntityUid,
    album_slug: track.albumSlug,
    duration: track.duration,
    path: track.path,
    library_track_id: track.libraryTrackId,
    format: track.format,
    bitrate: track.bitrate,
    sample_rate: track.sampleRate,
    bit_depth: track.bitDepth,
    bpm: track.bpm,
    audio_key: track.audioKey,
    audio_scale: track.audioScale,
    energy: track.energy,
    danceability: track.danceability,
    valence: track.valence,
    bliss_vector: track.blissVector,
    is_suggested: track.isSuggested,
    suggestion_source: track.suggestionSource,
  };
}

/** Rebuild a player-ready Track from menu data, honoring optional cover override and carrying metadata. */
export function buildTrackMenuPlayerTrack(
  track: TrackMenuData,
  cover?: string,
): Track {
  const resolvedCover =
    cover ||
    (track.global_album_uid
      ? albumCoverApiUrl(
          {
            globalAlbumUid: track.global_album_uid,
          },
          { size: 512 },
        )
      : track.album_id != null
        ? albumCoverApiUrl(
            {
              albumId: track.album_id,
              albumSlug: track.album_slug,
              artistName: track.artist,
              albumName: track.album,
            },
            { size: 512 },
          )
        : undefined);

  return toPlayableTrack(track, { cover: resolvedCover });
}

export function sharePath(
  path: string,
  label: string,
  options: Partial<Omit<SharePayload, "title" | "url">> & {
    copiedToast?: string;
  } = {},
) {
  return async () => {
    const url = publicShareUrl(path);
    const opened = openShareSheet({
      kind: options.kind ?? "playlist",
      title: label,
      subtitle: options.subtitle,
      imageUrl: options.imageUrl,
      url,
    });
    if (!opened) {
      await navigator.clipboard.writeText(url);
      toast.success(options.copiedToast ?? "Link copied");
    }
  };
}

export async function fetchAlbumTracks(data: AlbumMenuData): Promise<Track[]> {
  const response = await api<{
    artist: string;
    name: string;
    display_name: string;
    tracks: Array<{
      id: number | string;
      entity_uid?: string;
      global_track_uid?: string;
      filename: string;
      path?: string | null;
      length_sec: number;
      format?: string;
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
      tags: { title: string };
    }>;
  }>(
    albumApiPath({
      albumId: data.albumId,
      albumEntityUid: data.albumEntityUid,
      globalAlbumUid: data.globalAlbumUid,
      albumSlug: data.albumSlug,
      artistSlug: data.artistSlug,
      artistName: data.artist,
      albumName: data.album,
    }),
  );

  const coverUrl =
    data.cover ||
    albumCoverApiUrl(
      {
        albumId: data.albumId,
        albumEntityUid: data.albumEntityUid,
        globalAlbumUid: data.globalAlbumUid,
        albumSlug: data.albumSlug,
        artistName: data.artist,
        albumName: data.album,
      },
      { size: 512 },
    );

  return (response.tracks || []).map((track) =>
    toPlayableTrack(
      {
        id: track.id,
        entity_uid: track.entity_uid,
        global_album_uid: data.globalAlbumUid,
        title: track.tags?.title || track.filename || "Unknown",
        artist: response.artist,
        album: response.display_name || response.name,
        album_id: data.albumId,
        album_entity_uid: data.albumEntityUid,
        global_track_uid: track.global_track_uid,
        album_slug: data.albumSlug,
        duration: track.length_sec,
        path: track.path,
        format: track.format || undefined,
        bitrate: track.bitrate,
        sample_rate: track.sample_rate,
        bit_depth: track.bit_depth,
        bpm: track.bpm,
        audio_key: track.audio_key,
        audio_scale: track.audio_scale,
        energy: track.energy,
        danceability: track.danceability,
        valence: track.valence,
        bliss_vector: track.bliss_vector,
      },
      { cover: coverUrl || undefined },
    ),
  );
}

export async function fetchArtistTopTracks(
  artist: ArtistMenuData,
): Promise<Track[]> {
  const topTracks = artist.globalArtistUid
    ? (
        await api<{ top_tracks?: ArtistTopTrack[] }>(
          artistApiPath({ globalArtistUid: artist.globalArtistUid }),
        )
      ).top_tracks || []
    : artist.artistSlug
      ? await api<ArtistTopTrack[]>(
          `/api/artist-slugs/${encodeURIComponent(
            artist.artistSlug,
          )}/top-tracks?count=12`,
        )
      : artist.artistId != null
        ? await api<ArtistTopTrack[]>(
            `/api/artists/${artist.artistId}/top-tracks?count=12`,
          )
        : [];
  const coverFallback =
    artistPhotoApiUrl(
      {
        artistId: artist.artistId,
        artistEntityUid: artist.artistEntityUid,
        globalArtistUid: artist.globalArtistUid,
        artistSlug: artist.artistSlug,
        artistName: artist.name,
      },
      { size: 512 },
    ) || undefined;
  return (topTracks || []).map((track) =>
    buildArtistPlayerTrack(track, artist.name, coverFallback),
  );
}
