import type { PlaylistArtworkTrack } from "@/components/playlists/PlaylistArtwork";

export interface Playlist {
  id: number;
  name: string;
  description?: string;
  cover_data_url?: string | null;
  artwork_tracks?: PlaylistArtworkTrack[];
  track_count: number;
  is_smart: boolean;
  visibility?: "public" | "private";
  is_collaborative?: boolean;
  user_id?: number | null;
  owner_username?: string | null;
  owner_name?: string | null;
  total_duration: number;
  created_at: string;
}

export interface PlaylistTrack {
  id: number;
  track_id?: number;
  global_track_uid?: string;
  globalTrackUid?: string;
  track_entity_uid?: string;
  track_path?: string | null;
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
  position: number;
}

export interface PlaylistDetail extends Playlist {
  tracks: PlaylistTrack[];
}

export interface CuratedPlaylist {
  id: number;
  name: string;
  description?: string;
  cover_data_url?: string | null;
  artwork_tracks?: PlaylistArtworkTrack[];
  track_count: number;
  follower_count: number;
  is_smart: boolean;
  category?: string | null;
}

export interface LibraryPlaylistsPageData {
  playlists: Playlist[];
  followed_playlists?: Playlist[];
  followed_curated_playlists: CuratedPlaylist[];
}

export function playlistOwnerLabel(playlist: Playlist): string | null {
  if (playlist.owner_name) return playlist.owner_name;
  return playlist.owner_username ? `@${playlist.owner_username}` : null;
}

export function splitLibraryPlaylists(
  playlists: Playlist[] | undefined,
  userId: number | undefined,
): { owned: Playlist[]; shared: Playlist[] } {
  const owned: Playlist[] = [];
  const shared: Playlist[] = [];
  for (const playlist of playlists ?? []) {
    if (
      userId != null &&
      playlist.user_id != null &&
      playlist.user_id !== userId
    ) {
      shared.push(playlist);
    } else {
      owned.push(playlist);
    }
  }
  return { owned, shared };
}
