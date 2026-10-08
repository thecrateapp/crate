import { useCallback, useState } from "react";

import type { PlaylistComposerTrack } from "@/components/playlists/PlaylistCreateModal";
import { useOptionalPlaylistComposer } from "@/contexts/PlaylistComposerContext";
import type { TrackMenuData } from "@/components/actions/shared";
import { api } from "@/lib/api";
import { toTrackReferencePayload } from "@/lib/track-reference";

const noop = () => {};

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
  const playlistOptions = playlistComposer?.playlistOptions ?? [];
  const ensurePlaylistOptionsLoaded =
    playlistComposer?.ensurePlaylistOptionsLoaded ?? noop;
  const [playlistPickerOpen, setPlaylistPickerOpen] = useState(false);
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        ensurePlaylistOptionsLoaded();
      } else {
        setPlaylistPickerOpen(false);
      }
    },
    [ensurePlaylistOptionsLoaded],
  );
  const onTogglePlaylistPicker = useCallback(() => {
    ensurePlaylistOptionsLoaded();
    setPlaylistPickerOpen((open) => !open);
  }, [ensurePlaylistOptionsLoaded]);

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
    onOpenChange,
    onTogglePlaylistPicker,
    onCreatePlaylist,
    onAddToPlaylist,
    playlistPickerOpen,
  };
}
