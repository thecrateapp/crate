import type { TFunction } from "i18next";
import type { CrateIcon } from "@crate/ui/icons";
import type { ContextMenuEntry } from "@crate/ui/domain/actions";
import { notify } from "@crate/ui/lib/notify";

import type { TrackRowData } from "@/components/cards/TrackRow";
import type { PlaylistHeroSecondaryAction } from "@/components/playlists/PlaylistHeroSection";
import type { useOffline } from "@/contexts/OfflineContext";
import type { Track } from "@/contexts/PlayerContext";
import type { PlayerActionsValue } from "@/contexts/player-context";
import type { usePlaylistComposer } from "@/contexts/PlaylistComposerContext";
import { api, resolveMaybeApiAssetUrl } from "@/lib/api";
import type { OfflineItemState } from "@/lib/offline";
import { toPlayableTrack } from "@/lib/playable-track";
import {
  hasTrackReference,
  toTrackReferencePayload,
} from "@/lib/track-reference";
import { fetchPlaylistRadio } from "@/lib/radio";
import { publicShareUrl } from "@/lib/share-url";
import { openShareSheet } from "@/lib/social-share";
import { shuffleArray } from "@/lib/utils";
import type { CuratedOfflinePresentation } from "@/pages/curated-playlist-model";
import type { CuratedPlaylistData } from "@/pages/curated-playlist-types";
import {
  buildPlaylistPageActions,
  getPlaylistOfflineIcon,
} from "@/pages/playlist-action-menus";

type OpenCreatePlaylist = ReturnType<
  typeof usePlaylistComposer
>["openCreatePlaylist"];

interface CuratedPlaylistActionInput {
  data: CuratedPlaylistData | undefined;
  id: string | undefined;
  offlinePresentation: CuratedOfflinePresentation;
  offlineState: OfflineItemState;
  offlineSupported: boolean;
  openCreatePlaylist: OpenCreatePlaylist;
  playerTracks: Track[];
  playAll: PlayerActionsValue["playAll"];
  refetch: () => void;
  setTogglingFollow: (value: boolean) => void;
  t: TFunction;
  togglePlaylistOffline: ReturnType<typeof useOffline>["togglePlaylistOffline"];
  togglingFollow: boolean;
}

export interface CuratedPlaylistActions {
  handleAddTrackToPlaylist: (
    playlistId: number,
    track: TrackRowData,
  ) => Promise<void>;
  handleCreatePlaylistFromTrack: (track: TrackRowData) => void;
  handlePlay: () => void;
  handlePlayTrack: (trackEntryId: number) => void;
  handlePlaylistRadio: () => Promise<void>;
  handleShare: () => void;
  handleShuffle: () => void;
  handleToggleFollow: () => Promise<void>;
  handleToggleOffline: () => Promise<void>;
  offlineIcon: CrateIcon;
  playlistMenuItems: ContextMenuEntry[];
  secondaryActions: PlaylistHeroSecondaryAction[];
}

export function buildCuratedPlaylistActions({
  data,
  id,
  offlinePresentation,
  offlineState,
  offlineSupported,
  openCreatePlaylist,
  playerTracks,
  playAll,
  refetch,
  setTogglingFollow,
  t,
  togglePlaylistOffline,
  togglingFollow,
}: CuratedPlaylistActionInput): CuratedPlaylistActions {
  function handlePlay() {
    if (!playerTracks.length) return;
    playAll(playerTracks, 0, {
      type: "playlist",
      name: data?.name || "Playlist",
      id: data?.id,
      href: data ? `/curation/playlists/${data.id}` : undefined,
      radio: data ? { seedType: "playlist", seedId: data.id } : undefined,
    });
  }

  function handlePlayTrack(trackEntryId: number) {
    if (!data || !playerTracks.length) return;
    const startIndex = data.tracks.findIndex(
      (track) => track.id === trackEntryId,
    );
    if (startIndex < 0) return;
    playAll(playerTracks, startIndex, {
      type: "playlist",
      name: data.name || "Playlist",
      id: data.id,
      href: `/curation/playlists/${data.id}`,
      radio: { seedType: "playlist", seedId: data.id },
    });
  }

  function handleShuffle() {
    if (!playerTracks.length) return;
    playAll(shuffleArray(playerTracks), 0, {
      type: "playlist",
      name: data?.name || "Playlist",
      id: data?.id,
      href: data ? `/curation/playlists/${data.id}` : undefined,
      radio: data ? { seedType: "playlist", seedId: data.id } : undefined,
    });
  }

  async function handlePlaylistRadio() {
    if (!data) return;
    try {
      const radio = await fetchPlaylistRadio({
        playlistId: data.id,
        playlistName: data.name,
      });
      if (!radio.tracks.length) {
        notify.info(t("playlist.toasts.radioUnavailable"));
        return;
      }
      playAll(radio.tracks, 0, radio.source);
    } catch {
      notify.error(t("playlist.toasts.radioFailed"));
    }
  }

  function handleShare() {
    if (!data) return;
    openShareSheet({
      kind: "playlist",
      title: data.name,
      subtitle: data.description,
      imageUrl: resolveMaybeApiAssetUrl(data.cover_data_url),
      url: publicShareUrl(`/curation/playlist/${data.id}`),
    });
  }

  async function handleAddTrackToPlaylist(
    playlistId: number,
    track: TrackRowData,
  ) {
    if (!hasTrackReference(track)) return;
    try {
      await api(`/api/playlists/${playlistId}/tracks`, "POST", {
        tracks: [
          toTrackReferencePayload({
            ...track,
            album: track.album || "",
            duration: track.duration || 0,
          }),
        ],
      });
      notify.success(t("playlist.toasts.trackAdded"));
    } catch {
      notify.error(t("playlist.toasts.trackAddFailed"));
    }
  }

  function handleCreatePlaylistFromTrack(track: TrackRowData) {
    openCreatePlaylist({
      tracks: hasTrackReference(track) ? [toPlayableTrack(track)] : [],
    });
  }

  async function handleToggleFollow() {
    if (!id || !data) return;
    setTogglingFollow(true);
    try {
      if (data.is_followed) {
        await api(`/api/curation/playlists/${id}/follow`, "DELETE");
        notify.success(t("playlist.toasts.removedLibrary"));
      } else {
        await api(`/api/curation/playlists/${id}/follow`, "POST");
        notify.success(t("playlist.toasts.addedLibrary"));
      }
      refetch();
    } catch {
      notify.error(t("playlist.toasts.updateFailed"));
    } finally {
      setTogglingFollow(false);
    }
  }

  async function handleToggleOffline() {
    if (!data) return;
    try {
      const result = await togglePlaylistOffline({
        playlistId: data.id,
        title: data.name,
        isSmart: data.is_smart,
      });
      notify.success(
        result === "removed"
          ? t("playlist.toasts.offlineRemoved")
          : t("playlist.toasts.availableOffline"),
      );
    } catch (offlineError) {
      notify.error(
        (offlineError as Error).message ||
          t("playlist.toasts.offlineUpdateFailed"),
      );
    }
  }

  const { offlineIcon, playlistMenuItems, secondaryActions } = data
    ? buildPlaylistPageActions({
        t,
        playDisabled: playerTracks.length === 0,
        onPlay: handlePlay,
        onShuffle: handleShuffle,
        onRadio: handlePlaylistRadio,
        onShare: handleShare,
        offline: {
          state: offlineState,
          presentation: offlinePresentation,
          supported: offlineSupported,
          isSmart: data.is_smart,
          onToggle: handleToggleOffline,
        },
        follow: {
          followed: data.is_followed,
          pending: togglingFollow,
          onToggle: handleToggleFollow,
        },
      })
    : {
        offlineIcon: getPlaylistOfflineIcon(offlineState, offlinePresentation),
        playlistMenuItems: [],
        secondaryActions: [],
      };

  return {
    handleAddTrackToPlaylist,
    handleCreatePlaylistFromTrack,
    handlePlay,
    handlePlayTrack,
    handlePlaylistRadio,
    handleShare,
    handleShuffle,
    handleToggleFollow,
    handleToggleOffline,
    offlineIcon,
    playlistMenuItems,
    secondaryActions,
  };
}
