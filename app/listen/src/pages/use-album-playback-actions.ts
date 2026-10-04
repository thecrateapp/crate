import { usePlayerActions } from "@/contexts/PlayerContext";
import { notify } from "@crate/ui/lib/notify";

import { fetchAlbumRadio } from "@/lib/radio";
import { shuffleArray } from "@/lib/utils";
import type { Track } from "@/contexts/player-types";
import type { AlbumTrack } from "@/pages/album-types";

export function useAlbumPlaybackActions({
  albumHref,
  albumRadioSeed,
  artistName,
  clearTrackSelection,
  closeAlbumMenu,
  displayName,
  isPreRelease,
  playableAlbumTracks,
  playerTracks,
  setSelectionPlaylistPickerOpen,
  t,
}: {
  albumHref: string;
  albumRadioSeed: number | string | null;
  artistName: string;
  clearTrackSelection: () => void;
  closeAlbumMenu: () => void;
  displayName: string;
  isPreRelease: boolean;
  playableAlbumTracks: AlbumTrack[];
  playerTracks: Track[];
  setSelectionPlaylistPickerOpen: (value: boolean) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const { playAll, playNext } = usePlayerActions();

  const playFromIndex = (startIndex: number) => {
    if (playerTracks.length === 0) return;
    playAll(playerTracks, startIndex, {
      type: "album",
      name: `${artistName} — ${displayName}`,
      href: albumHref,
      radio:
        albumRadioSeed != null
          ? { seedType: "album", seedId: albumRadioSeed }
          : undefined,
    });
  };

  const handlePlay = () => playFromIndex(0);

  const handlePlayTrack = (trackId: number | string) => {
    const startIndex = playableAlbumTracks.findIndex(
      (track) => track.id === trackId,
    );
    if (startIndex < 0) return;
    clearTrackSelection();
    setSelectionPlaylistPickerOpen(false);
    playFromIndex(startIndex);
  };

  const handleShuffle = () => {
    if (playerTracks.length === 0) return;
    playAll(shuffleArray(playerTracks), 0, {
      type: "album",
      name: `${artistName} — ${displayName}`,
      href: albumHref,
      radio:
        albumRadioSeed != null
          ? { seedType: "album", seedId: albumRadioSeed }
          : undefined,
    });
  };

  async function handleAlbumRadio() {
    if (albumRadioSeed == null) {
      notify.info(t("album.toasts.radioUnavailable"));
      return;
    }
    if (isPreRelease) {
      notify.info(t("album.toasts.radioPrerelease"));
      return;
    }
    try {
      const radio = await fetchAlbumRadio({
        albumId: albumRadioSeed,
        artistName,
        albumName: displayName,
      });
      if (!radio.tracks.length) {
        notify.info(t("album.toasts.radioUnavailable"));
        return;
      }
      playAll(radio.tracks, 0, radio.source);
    } catch {
      notify.error(t("album.toasts.radioFailed"));
    }
  }

  const handlePlayNextAlbum = () => {
    if (playerTracks.length === 0) return;
    [...playerTracks].reverse().forEach((track) => playNext(track));
    notify.success(t("album.toasts.queuedNext"));
    closeAlbumMenu();
  };

  return {
    handleAlbumRadio,
    handlePlay,
    handlePlayNextAlbum,
    handlePlayTrack,
    handleShuffle,
  };
}
