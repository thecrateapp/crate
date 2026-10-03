import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useContextMenuController } from "@crate/ui/domain/actions";
import {
  openCrateComposerForAlbum,
  useOptionalCrateComposer,
} from "@/contexts/CrateComposerContext";
import { useOptionalPlaylistComposer } from "@/contexts/PlaylistComposerContext";
import { useDismissibleLayer } from "@crate/ui/lib/use-dismissible-layer";
import { useLazyCrateOptions } from "@/hooks/use-lazy-crate-options";
import type { AlbumData } from "@/pages/album-types";
import {
  useAlbumHeroMeasurement,
  useAlbumSharedTrackScroll,
} from "@/pages/use-album-page-effects";
import { useAlbumData } from "@/pages/use-album-data";
import { useAlbumPlaybackActions } from "@/pages/use-album-playback-actions";
import { useAlbumPlaylistActions } from "@/pages/use-album-playlist-actions";
import { useAlbumPresentation } from "@/pages/use-album-presentation";
import { useAlbumSelection } from "@/pages/use-album-selection";
import { api } from "@/lib/api";
import { toast } from "sonner";

export function useAlbumPageController() {
  const { t } = useTranslation();
  const {
    albumHref,
    albumId,
    albumRadioSeed,
    artistName,
    canonicalPath,
    data,
    displayName,
    error,
    globalAlbumUid,
    globalArtistUid,
    isDesktop,
    isPreRelease,
    loading,
    locationPath,
    navigate,
    playerTracks,
    selectionTracks,
    sharedTrackUid,
  } = useAlbumData();
  const [playlistPickerOpen, setPlaylistPickerOpen] = useState(false);
  const [cratePickerOpen, setCratePickerOpen] = useState(false);
  const albumHeroInfoRef = useRef<HTMLDivElement>(null);
  const albumPrimaryActionsRef = useRef<HTMLDivElement>(null);
  const [mobileHeroInfoOffset, setMobileHeroInfoOffset] = useState(0);
  const albumMenuController = useContextMenuController<HTMLButtonElement>({
    placement: "bottom-end",
  });
  const selectionMenuController = useContextMenuController<HTMLButtonElement>();
  const playlistComposer = useOptionalPlaylistComposer();
  const playlists = playlistComposer?.playlistOptions ?? [];
  const ensurePlaylistOptionsLoaded =
    playlistComposer?.ensurePlaylistOptionsLoaded ?? (() => {});
  const { crateOptions: crates, ensureCrateOptionsLoaded } =
    useLazyCrateOptions();
  const crateComposer = useOptionalCrateComposer();
  const {
    clearTrackSelection,
    handleCloseSelectionMenu,
    handleSelectionActionMenuOpen,
    handleToggleSelectionMenuPlaylist,
    handleToggleSelectionPlaylistPicker,
    handleTrackSelection,
    selectedAlbumTracks,
    selectedTrackIds,
    selectionBarRef,
    selectionMenuPlaylistOpen,
    selectionPlaylistPickerOpen,
    setSelectionPlaylistPickerOpen,
  } = useAlbumSelection({
    albumId: typeof data?.id === "number" ? data.id : undefined,
    isDesktop,
    playableAlbumTracks: selectionTracks,
    ensurePlaylistOptionsLoaded,
    selectionMenuController,
  });

  function closeAlbumMenu() {
    albumMenuController.close();
    setPlaylistPickerOpen(false);
    setCratePickerOpen(false);
  }

  async function handleAddToCrate(crateId: string) {
    if (!globalAlbumUid) return;
    const crateName = crates.find((crate) => crate.id === crateId)?.name ?? "";
    if (
      crates.some(
        (crate) =>
          crate.id === crateId && crate.albumUids.includes(globalAlbumUid),
      )
    ) {
      toast.info(t("album.toasts.alreadyInCrate", { name: crateName }));
      return;
    }
    try {
      await api(`/api/crates/${crateId}/albums`, "POST", {
        global_album_uid: globalAlbumUid,
      });
      toast.success(t("album.toasts.addedToCrate"));
      closeAlbumMenu();
    } catch (error) {
      if ((error as { status?: number }).status === 409) {
        toast.info(t("album.toasts.alreadyInCrate", { name: crateName }));
        return;
      }
      toast.error(t("album.toasts.addToCrateFailed"));
    }
  }

  function handleCreateCrate() {
    const opened = openCrateComposerForAlbum(crateComposer, {
      globalAlbumUid,
      name: displayName,
      artistName,
    });
    if (!opened) return;
    closeAlbumMenu();
  }

  const {
    handleAddSelectedToCollection,
    handleAddSelectedToPlaylist,
    handleAddSelectedToQueue,
    handleAddToPlaylist,
    handleAddTrackToPlaylist,
    handleCreatePlaylistFromAlbum,
    handleCreatePlaylistFromSelection,
    handleCreatePlaylistFromTrack,
    handlePlaySelectedNext,
  } = useAlbumPlaylistActions({
    artistName,
    clearTrackSelection,
    closeAlbumMenu,
    data,
    displayName,
    globalAlbumUid,
    handleCloseSelectionMenu,
    playableAlbumTracks: selectionTracks,
    selectedAlbumTracks,
    setPlaylistPickerOpen,
    setSelectionPlaylistPickerOpen,
    t,
  });
  const {
    handleAlbumRadio,
    handlePlay,
    handlePlayNextAlbum,
    handlePlayTrack,
    handleShuffle,
  } = useAlbumPlaybackActions({
    albumHref,
    albumRadioSeed,
    artistName,
    clearTrackSelection,
    closeAlbumMenu,
    displayName,
    isPreRelease,
    playableAlbumTracks: selectionTracks,
    playerTracks,
    setSelectionPlaylistPickerOpen,
    t,
  });
  const presentation = useAlbumPresentation({
    albumId,
    albumMenuController,
    artistName,
    canPlay: playerTracks.length > 0,
    canRadio: albumRadioSeed != null && !isPreRelease,
    cratePickerOpen,
    crates,
    data,
    displayName,
    ensurePlaylistOptionsLoaded,
    globalAlbumUid,
    globalArtistUid,
    handleAddSelectedToCollection,
    handleAddSelectedToPlaylist,
    handleAddSelectedToQueue,
    handleAddToPlaylist,
    handleAddToCrate,
    handleAlbumRadio,
    handleCreateCrate,
    handleCreatePlaylistFromAlbum,
    handleCreatePlaylistFromSelection,
    handlePlay,
    handlePlayNextAlbum,
    handlePlaySelectedNext,
    handleShuffle,
    handleToggleSelectionMenuPlaylist,
    ensureCrateOptionsLoaded,
    mobileHeroInfoOffset,
    navigate,
    playlistPickerOpen,
    playlists,
    selectedAlbumTracks,
    selectionMenuPlaylistOpen,
    setPlaylistPickerOpen,
    setCratePickerOpen,
    sharedTrackUid,
    t,
  });

  useDismissibleLayer({
    active:
      playlistPickerOpen || cratePickerOpen || selectionPlaylistPickerOpen,
    refs: [
      albumMenuController.menuRef,
      selectionBarRef,
      selectionMenuController.menuRef,
    ],
    onDismiss: () => {
      closeAlbumMenu();
      setSelectionPlaylistPickerOpen(false);
      handleCloseSelectionMenu();
    },
    closeOnScroll: true,
  });
  useAlbumHeroMeasurement({
    albumHeroInfoRef,
    albumPrimaryActionsRef,
    isDesktop,
    mobileHeroInfoOffset,
    setMobileHeroInfoOffset,
  });
  useAlbumSharedTrackScroll({
    albumId: data?.id,
    hasTracks: Boolean(data?.tracks?.length),
    sharedTrackUid,
  });

  return {
    albumHeroInfoRef,
    albumPrimaryActionsRef,
    albumMenuController,
    canonicalPath,
    closeAlbumMenu,
    clearTrackSelection,
    data,
    displayName,
    error,
    handleAddSelectedToCollection,
    handleAddSelectedToPlaylist,
    handleAddSelectedToQueue,
    handleAddToPlaylist,
    handleAddTrackToPlaylist,
    handleAlbumRadio,
    handleCloseSelectionMenu,
    handleCreatePlaylistFromAlbum,
    handleCreatePlaylistFromSelection,
    handleCreatePlaylistFromTrack,
    handlePlay,
    handlePlayTrack,
    handleSelectionActionMenuOpen,
    handleShuffle,
    handleToggleSelectionPlaylistPicker,
    handleTrackSelection,
    isDesktop,
    isPreRelease,
    globalAlbumUid,
    loading,
    locationPath,
    mobileHeroInfoOffset,
    navigate,
    playerTracks,
    presentation,
    playlists,
    selectedAlbumTracks,
    selectedTrackIds,
    selectionBarRef,
    selectionMenuController,
    selectionPlaylistPickerOpen,
    selectionMenuPlaylistOpen,
    ensurePlaylistOptionsLoaded,
    ensureCrateOptionsLoaded,
    t,
  };
}

export type AlbumPageController = ReturnType<typeof useAlbumPageController>;
export type LoadedAlbumPageController = Omit<AlbumPageController, "data"> & {
  data: AlbumData;
};
