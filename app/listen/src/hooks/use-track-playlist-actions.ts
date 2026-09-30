import { useCallback } from "react";

import type { PlaylistComposerTrack } from "@/components/playlists/PlaylistCreateModal";
import { useOptionalPlaylistComposer } from "@/contexts/PlaylistComposerContext";
import { useLazyPlaylistOptions } from "@/hooks/use-lazy-playlist-options";
import type { TrackMenuData } from "@/components/actions/shared";
import { api } from "@/lib/api";
import { toTrackReferencePayload } from "@/lib/track-reference";

function toPlaylistComposerTrack(track: TrackMenuData): PlaylistComposerTrack {
  return {
    entityUid: track.entity_uid,
    globalTrackUid: track.global_track_uid,
    libraryTrackId:
      track.library_track_id ??
      (typeof track.id === "number" ? track.id : undefined),
    path: track.path,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
  };
}

export function useTrackPlaylistActions() {
  const playlistComposer = useOptionalPlaylistComposer();
  const { playlistOptions, ensurePlaylistOptionsLoaded } =
    useLazyPlaylistOptions();

  const onCreatePlaylist = useCallback(
    (track: TrackMenuData) => {
      playlistComposer?.openCreatePlaylist({
        tracks: [toPlaylistComposerTrack(track)],
      });
    },
    [playlistComposer],
  );

  const onAddToPlaylist = useCallback(
    async (playlistId: number, track: TrackMenuData) => {
      await api(`/api/playlists/${playlistId}/tracks`, "POST", {
        tracks: [toTrackReferencePayload(track)],
      });
    },
    [],
  );

  return {
    playlistOptions,
    ensurePlaylistOptionsLoaded,
    onCreatePlaylist,
    onAddToPlaylist,
  };
}
