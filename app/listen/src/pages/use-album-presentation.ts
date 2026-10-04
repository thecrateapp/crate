import type { CSSProperties, Dispatch, SetStateAction } from "react";
import type { TFunction } from "i18next";
import type { NavigateFunction } from "react-router";
import { toast } from "sonner";

import { useOffline } from "@/contexts/OfflineContext";
import { useSavedAlbums } from "@/contexts/SavedAlbumsContext";
import type { PlaylistOption } from "@/contexts/PlaylistComposerContext";
import type { CrateOption } from "@/hooks/use-lazy-crate-options";
import { openShareSheet } from "@/lib/social-share";
import {
  albumDownloadApiPath,
  artistPagePath,
  downloadApiUrl,
} from "@/lib/library-routes";
import { buildAlbumMenuEntries } from "@/components/actions/album-actions";
import { buildAlbumSelectionMenuItems } from "@/pages/album-menu-model";
import type { AlbumData, AlbumTrack } from "@/pages/album-types";
import {
  buildAlbumPresentationState,
  buildAlbumTrackRowData,
} from "@/pages/album-presentation-model";

const ALBUM_MOBILE_HERO_SPACING = {
  "--album-mobile-action-overlap": "2rem",
  "--album-mobile-info-action-gap": "20px",
  "--album-mobile-info-y": "0px",
} as CSSProperties;

function trackPreviewId(track: AlbumTrack) {
  return track.entity_uid ? `track-${track.entity_uid}` : undefined;
}

export function useAlbumPresentation({
  albumId,
  artistName,
  canPlay,
  canRadio,
  cratePickerOpen,
  crates,
  data,
  displayName,
  ensurePlaylistOptionsLoaded,
  ensureCrateOptionsLoaded,
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
  mobileHeroInfoOffset,
  navigate,
  playlists,
  playlistPickerOpen,
  selectionMenuPlaylistOpen,
  selectedAlbumTracks,
  setPlaylistPickerOpen,
  setCratePickerOpen,
  sharedTrackUid,
  t,
}: {
  albumId: number;
  artistName: string;
  canPlay: boolean;
  canRadio: boolean;
  data: AlbumData | null;
  displayName: string;
  ensurePlaylistOptionsLoaded: () => void;
  ensureCrateOptionsLoaded: () => void;
  globalAlbumUid: string | null;
  globalArtistUid: string | null;
  handleAddSelectedToCollection: () => void | Promise<void>;
  handleAddSelectedToPlaylist: (playlistId: number) => void | Promise<void>;
  handleAddSelectedToQueue: () => void;
  handleAddToPlaylist: (playlistId: number) => void | Promise<void>;
  handleAddToCrate: (crateId: string) => void | Promise<void>;
  handleAlbumRadio: () => void | Promise<void>;
  handleCreateCrate: () => void;
  handleCreatePlaylistFromAlbum: () => void;
  handleCreatePlaylistFromSelection: () => void;
  handlePlay: () => void;
  handlePlayNextAlbum: () => void;
  handlePlaySelectedNext: () => void;
  handleShuffle: () => void;
  handleToggleSelectionMenuPlaylist: () => void;
  mobileHeroInfoOffset: number;
  navigate: NavigateFunction;
  playlists: PlaylistOption[];
  playlistPickerOpen: boolean;
  cratePickerOpen: boolean;
  crates: CrateOption[];
  selectionMenuPlaylistOpen: boolean;
  selectedAlbumTracks: AlbumTrack[];
  setPlaylistPickerOpen: Dispatch<SetStateAction<boolean>>;
  setCratePickerOpen: Dispatch<SetStateAction<boolean>>;
  sharedTrackUid: string | null;
  t: TFunction;
}) {
  const { isSaved, saveAlbum, unsaveAlbum } = useSavedAlbums();
  const {
    supported: offlineSupported,
    getAlbumState,
    getAlbumRecord,
    toggleAlbumOffline,
  } = useOffline();
  const presentationState = buildAlbumPresentationState({
    albumId,
    artistName,
    data,
    displayName,
    getAlbumRecord,
    getAlbumState,
    globalAlbumUid,
    isSaved,
    offlineSupported,
    t,
  });
  const {
    artistPhotoUrl,
    canPersistAlbum,
    canSaveAlbum,
    coverUrl,
    genre,
    offlineButtonLabel,
    offlineBusy,
    offlineRecord,
    offlineState,
    offlineStatusDetail,
    primaryContributorName,
    primaryContributorPath,
    primaryContributorSource,
    qualityBadges,
    remoteOnly,
    saved,
    shareUrl,
    visibleContributor,
    year,
  } = presentationState;
  const canAddToCrate = Boolean(globalAlbumUid);

  function sharedTrackClass(track: AlbumTrack) {
    return sharedTrackUid && track.entity_uid === sharedTrackUid
      ? "rounded-xl ring-1 ring-primary/35 bg-accent-action/5"
      : "";
  }

  const albumTrackRowData = (track: AlbumTrack, fallbackIndex: number) =>
    buildAlbumTrackRowData({
      albumId,
      data,
      displayName,
      fallbackIndex,
      globalAlbumUid,
      globalArtistUid,
      track,
    });

  async function handleShare() {
    openShareSheet({
      kind: "album",
      title: displayName,
      subtitle: artistName,
      imageUrl: coverUrl,
      url: shareUrl,
    });
  }

  async function handleToggleSaved() {
    if (!canSaveAlbum) return;
    try {
      if (saved) {
        await unsaveAlbum(albumId, globalAlbumUid);
      } else {
        await saveAlbum(albumId, globalAlbumUid);
      }
    } catch {
      // Saved state remains unchanged when the request fails.
    }
  }

  async function handleToggleOffline() {
    if (!canPersistAlbum) return;
    try {
      const result = await toggleAlbumOffline({ albumId, title: displayName });
      toast.success(
        result === "removed"
          ? t("playlist.toasts.offlineRemoved")
          : t("album.toasts.availableOffline"),
      );
    } catch (error) {
      toast.error(
        (error as Error).message || t("playlist.toasts.offlineUpdateFailed"),
      );
    }
  }

  function handleTogglePlaylistPicker() {
    ensurePlaylistOptionsLoaded();
    setPlaylistPickerOpen((open) => !open);
  }

  function handleToggleCratePicker() {
    ensureCrateOptionsLoaded();
    setCratePickerOpen((open) => !open);
  }

  const handleGoToArtist = () =>
    navigate(
      globalArtistUid
        ? artistPagePath({
            artistId: data?.artist_id,
            artistEntityUid: data?.artist_entity_uid,
            globalArtistUid,
            artistSlug: data?.artist_slug,
            artistName,
          })
        : artistPagePath({
            artistId: data?.artist_id,
            artistSlug: data?.artist_slug,
            artistName,
          }),
    );

  function handleDownload() {
    const url = downloadApiUrl(
      albumDownloadApiPath({
        albumId: albumId > 0 ? albumId : undefined,
        albumEntityUid: data?.entity_uid,
        artistName,
        albumName: data?.name ?? displayName,
      }),
    );
    if (url) window.location.assign(url);
  }

  const albumMenuItems = buildAlbumMenuEntries(
    {
      saved,
      canSave: canSaveAlbum,
      canAddToCrate,
      canAddToPlaylist: canPersistAlbum,
      canRadio,
      canPlay,
      canDownload: albumId > 0 || Boolean(data?.entity_uid),
      offlineEnabled: offlineSupported && canPersistAlbum,
      offlineState,
      offlineLabel: offlineButtonLabel,
      globalAlbumUid,
      crates,
      cratePickerOpen,
      playlists,
      playlistPickerOpen,
      onPlay: handlePlay,
      onPlayNext: handlePlayNextAlbum,
      onShuffle: handleShuffle,
      onToggleCratePicker: handleToggleCratePicker,
      onCreateCrate: handleCreateCrate,
      onAddToCrate: (crate) => handleAddToCrate(crate.id),
      onTogglePlaylistPicker: handleTogglePlaylistPicker,
      onCreatePlaylist: handleCreatePlaylistFromAlbum,
      onAddToPlaylist: handleAddToPlaylist,
      onToggleSaved: handleToggleSaved,
      onRadio: handleAlbumRadio,
      onToggleOffline: handleToggleOffline,
      onDownload: handleDownload,
      onGoToArtist: handleGoToArtist,
      onShare: handleShare,
    },
    t,
  );
  const selectionMenuItems = buildAlbumSelectionMenuItems(
    {
      selectedCount: selectedAlbumTracks.length,
      selectionMenuPlaylistOpen,
      playlists,
      onPlayNext: handlePlaySelectedNext,
      onAddToQueue: handleAddSelectedToQueue,
      onTogglePlaylist: handleToggleSelectionMenuPlaylist,
      onCreatePlaylist: handleCreatePlaylistFromSelection,
      onAddToPlaylist: handleAddSelectedToPlaylist,
      onAddToCollection: handleAddSelectedToCollection,
    },
    t,
  );
  const albumHeroStyle = {
    ...ALBUM_MOBILE_HERO_SPACING,
    "--album-mobile-info-y": `${mobileHeroInfoOffset}px`,
  } as CSSProperties;

  return {
    albumHeroStyle,
    albumMenuItems,
    albumTrackRowData,
    artistPhotoUrl,
    canPersistAlbum,
    canSaveAlbum,
    coverUrl,
    genre,
    handleGoToArtist,
    handleShare,
    handleToggleOffline,
    handleTogglePlaylistPicker,
    handleToggleSaved,
    offlineButtonLabel,
    offlineBusy,
    offlineRecord,
    offlineState,
    offlineStatusDetail,
    offlineSupported,
    primaryContributorName,
    primaryContributorPath,
    primaryContributorSource,
    qualityBadges,
    remoteOnly,
    saved,
    selectionMenuItems,
    sharedTrackClass,
    trackPreviewId,
    visibleContributor,
    year,
  };
}
