import type { Track } from "@/contexts/PlayerContext";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";

export interface PlaylistTrackResponse {
  track_id?: number;
  track_entity_uid?: string;
  track_path: string;
  title: string;
  artist: string;
  artist_id?: number;
  artist_entity_uid?: string;
  artist_slug?: string;
  album: string;
  album_id?: number;
  album_entity_uid?: string;
  album_slug?: string;
  duration: number;
  bpm?: number | null;
  audio_key?: string | null;
  audio_scale?: string | null;
  energy?: number | null;
  danceability?: number | null;
  valence?: number | null;
  bliss_vector?: number[] | null;
}

export interface PlaylistDetailResponse {
  tracks: PlaylistTrackResponse[];
}

export function toPlayerTracks(tracks: PlaylistTrackResponse[]): Track[] {
  return tracks.map((track) =>
    toPlayableTrack(
      {
        ...track,
        id: track.track_id ?? track.track_entity_uid ?? track.track_path,
        entity_uid: track.track_entity_uid,
        path: track.track_path,
        library_track_id: track.track_id,
      },
      {
        cover:
          track.artist && track.album
            ? albumCoverApiUrl(
                {
                  albumId: track.album_id,
                  albumEntityUid: track.album_entity_uid,
                  artistEntityUid: track.artist_entity_uid,
                  albumSlug: track.album_slug,
                  artistName: track.artist,
                  albumName: track.album,
                },
                { size: 512 },
              )
            : undefined,
      },
    ),
  );
}
