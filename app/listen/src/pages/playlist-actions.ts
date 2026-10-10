import type { TFunction } from "i18next";
import type { CrateIcon } from "@crate/ui/icons";
import type { ContextMenuEntry } from "@crate/ui/domain/actions";
import { notify } from "@crate/ui/lib/notify";

import type { TrackRowData } from "@/components/cards/TrackRow";
import type { PlaylistHeroSecondaryAction } from "@/components/playlists/PlaylistHeroSection";
import type { PlaylistComposerTrack } from "@/components/playlists/PlaylistCreateModal";
import type { Track } from "@/contexts/PlayerContext";
import type { PlayerActionsValue } from "@/contexts/player-context";
import type { useOffline } from "@/contexts/OfflineContext";
import type { usePlaylistComposer } from "@/contexts/PlaylistComposerContext";
import { api, resolveMaybeApiAssetUrl } from "@/lib/api";
import type { OfflineItemState } from "@/lib/offline";
import { toPlayableTrack } from "@/lib/playable-track";
import {
  hasTrackReference,
  toTrackReferencePayload,
} from "@/lib/track-reference";
import { fetchPlaylistRadio } from "@/lib/radio";
import {
  canCopy,
  canEdit,
  canFollow,
  canManage,
} from "@/lib/collaboration-access";
import { publicShareUrl } from "@/lib/share-url";
import { openShareSheet } from "@/lib/social-share";
import { shuffleArray } from "@/lib/utils";
import {
  buildPlaylistPageActions,
  getPlaylistOfflineIcon,
  type PlaylistPageActions,
} from "@/pages/playlist-action-menus";
import type { PlaylistOfflinePresentation } from "@/pages/playlist-page-model";
import type { UserSearchResult } from "@/pages/people-types";
import type { PlaylistData, PlaylistSavePayload } from "@/pages/playlist-types";

const EMPTY_PAGE_ACTIONS: PlaylistPageActions = {
  offlineIcon: getPlaylistOfflineIcon("idle", { busy: false }),
  playlistMenuItems: [],
  secondaryActions: [],
};

type OpenCreatePlaylist = ReturnType<
  typeof usePlaylistComposer
>["openCreatePlaylist"];

interface PlaylistActionInput {
  data: PlaylistData | undefined;
  editableTracks: PlaylistComposerTrack[];
  id: string | undefined;
  offlinePresentation: PlaylistOfflinePresentation;
  offlineState: OfflineItemState;
  offlineSupported: boolean;
  openCreatePlaylist: OpenCreatePlaylist;
  navigate: (to: string) => void;
  playerTracks: Track[];
  playAll: PlayerActionsValue["playAll"];
  refetch: () => void;
  setCopying: (value: boolean) => void;
  setDeleteOpen: (value: boolean) => void;
  setDeleting: (value: boolean) => void;
  setEditorOpen: (value: boolean) => void;
  setLeaving: (value: boolean) => void;
  setMembersOpen: (value: boolean) => void;
  setRemovingMemberId: (value: number | null) => void;
  setSaving: (value: boolean) => void;
  setTogglingFollow: (value: boolean) => void;
  t: TFunction;
  togglePlaylistOffline: ReturnType<typeof useOffline>["togglePlaylistOffline"];
  togglingFollow: boolean;
}

export interface PlaylistActions {
  handleAddTrackToPlaylist: (
    playlistId: number,
    track: TrackRowData,
  ) => Promise<void>;
  handleAddMember: (candidate: UserSearchResult) => Promise<void>;
  handleCopyToMyPlaylists: () => Promise<void>;
  handleCreatePlaylistFromTrack: (track: TrackRowData) => void;
  handleDeletePlaylist: () => Promise<void>;
  handleLeave: () => Promise<void>;
  handlePlay: () => void;
  handlePlayTrack: (trackEntryId: number) => void;
  handlePlaylistRadio: () => Promise<void>;
  handleRegenerate: () => Promise<void>;
  handleRemoveMember: (memberUserId: number) => Promise<void>;
  handleSavePlaylist: (payload: PlaylistSavePayload) => Promise<void>;
  handleShare: () => void;
  handleShuffle: () => void;
  handleToggleFollow: () => Promise<void>;
  handleToggleOffline: () => Promise<void>;
  offlineIcon: CrateIcon;
  playlistMenuItems: ContextMenuEntry[];
  secondaryActions: PlaylistHeroSecondaryAction[];
}

export function buildPlaylistActions({
  data,
  editableTracks,
  id,
  offlinePresentation,
  offlineState,
  offlineSupported,
  openCreatePlaylist,
  navigate,
  playerTracks,
  playAll,
  refetch,
  setCopying,
  setDeleteOpen,
  setDeleting,
  setEditorOpen,
  setLeaving,
  setMembersOpen,
  setRemovingMemberId,
  setSaving,
  setTogglingFollow,
  t,
  togglePlaylistOffline,
  togglingFollow,
}: PlaylistActionInput): PlaylistActions {
  function handlePlay() {
    if (!playerTracks.length) return;
    playAll(playerTracks, 0, {
      type: "playlist",
      name: data?.name || "Playlist",
      id: data?.id,
      href: data ? `/playlists/${data.id}` : undefined,
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
      href: `/playlists/${data.id}`,
      radio: { seedType: "playlist", seedId: data.id },
    });
  }

  function handleShuffle() {
    if (!playerTracks.length) return;
    playAll(shuffleArray(playerTracks), 0, {
      type: "playlist",
      name: data?.name || "Playlist",
      id: data?.id,
      href: data ? `/playlists/${data.id}` : undefined,
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
      url: publicShareUrl(`/playlist/${data.id}`),
    });
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
    } catch (error) {
      notify.error(
        (error as Error).message || t("playlist.toasts.offlineUpdateFailed"),
      );
    }
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

  async function handleRegenerate() {
    if (!id) return;
    try {
      await api(`/api/playlists/${id}/generate`, "POST");
      notify.success(t("playlist.toasts.regenerated"));
      refetch();
    } catch {
      notify.error(t("playlist.toasts.regenerateFailed"));
    }
  }

  async function handleSavePlaylist(payload: PlaylistSavePayload) {
    if (!id || !data) return;
    setSaving(true);
    try {
      await api(`/api/playlists/${id}`, "PUT", {
        name: payload.name,
        description: payload.description,
        cover_data_url: payload.coverDataUrl,
        ...(canManage(data)
          ? {
              visibility: payload.visibility,
              is_collaborative: payload.isCollaborative,
            }
          : {}),
      });

      const originalByEntryId = new Map(
        editableTracks
          .filter((track) => track.playlistEntryId != null)
          .map((track) => [track.playlistEntryId as number, track]),
      );
      const nextEntryIds = new Set(
        payload.tracks
          .map((track) => track.playlistEntryId)
          .filter((value): value is number => value != null),
      );
      const removedTracks = [...originalByEntryId.values()]
        .filter((track) => !nextEntryIds.has(track.playlistEntryId as number))
        .sort((a, b) => (b.playlistPosition || 0) - (a.playlistPosition || 0));

      for (const track of removedTracks) {
        if (track.playlistPosition != null) {
          await api(
            `/api/playlists/${id}/tracks/${track.playlistPosition}`,
            "DELETE",
          );
        }
      }

      const newTracks = payload.tracks.filter(
        (track) => track.playlistEntryId == null && hasTrackReference(track),
      );
      if (newTracks.length > 0) {
        await api(`/api/playlists/${id}/tracks`, "POST", {
          tracks: newTracks.map((track) =>
            toTrackReferencePayload({
              ...track,
              album: track.album || "",
              duration: track.duration || 0,
            }),
          ),
        });
      }

      notify.success(t("playlist.toasts.updated"));
      setEditorOpen(false);
      refetch();
    } catch {
      notify.error(t("playlist.toasts.updateFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeletePlaylist() {
    if (!id) return;
    setDeleting(true);
    try {
      await api(`/api/playlists/${id}`, "DELETE");
      notify.success(t("playlist.toasts.deleted"));
      navigate("/library?tab=playlists");
    } catch {
      notify.error(t("playlist.toasts.deleteFailed"));
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  async function handleAddMember(candidate: UserSearchResult) {
    if (!data) return;
    try {
      await api(`/api/playlists/${data.id}/members`, "POST", {
        user_id: candidate.id,
      });
      notify.success(
        t("collaboration.added", {
          name: candidate.display_name || candidate.username,
        }),
      );
      refetch();
    } catch {
      notify.error(t("collaboration.addFailed"));
    }
  }

  async function handleLeave() {
    if (!data) return;
    setLeaving(true);
    try {
      await api(`/api/playlists/${data.id}/leave`, "POST");
      notify.success(t("collaboration.left", { name: data.name }));
      navigate("/library?tab=playlists");
    } catch {
      notify.error(t("collaboration.leaveFailed"));
    } finally {
      setLeaving(false);
    }
  }

  async function handleToggleFollow() {
    if (!data) return;
    setTogglingFollow(true);
    try {
      await api(
        `/api/playlists/${data.id}/follow`,
        data.is_followed ? "DELETE" : "POST",
      );
      notify.success(
        data.is_followed
          ? t("playlist.toasts.removedLibrary")
          : t("playlist.toasts.addedLibrary"),
      );
      refetch();
    } catch {
      notify.error(t("playlist.toasts.updateFailed"));
    } finally {
      setTogglingFollow(false);
    }
  }

  async function handleCopyToMyPlaylists() {
    if (!data) return;
    setCopying(true);
    try {
      const copy = await api<{ id: number }>(
        `/api/playlists/${data.id}/copy`,
        "POST",
      );
      notify.success(t("collaboration.copiedPlaylist", { name: data.name }));
      navigate(`/playlist/${copy.id}`);
    } catch {
      notify.error(t("collaboration.copyFailed"));
    } finally {
      setCopying(false);
    }
  }

  async function handleRemoveMember(memberUserId: number) {
    if (!data) return;
    setRemovingMemberId(memberUserId);
    try {
      await api(`/api/playlists/${data.id}/members/${memberUserId}`, "DELETE");
      notify.success(t("playlist.toasts.collaboratorRemoved"));
      refetch();
    } catch {
      notify.error(t("playlist.toasts.collaboratorRemoveFailed"));
    } finally {
      setRemovingMemberId(null);
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
        follow: canFollow(data)
          ? {
              followed: Boolean(data.is_followed),
              pending: togglingFollow,
              onToggle: handleToggleFollow,
            }
          : undefined,
        onCopy: canCopy(data) ? handleCopyToMyPlaylists : undefined,
        onCollaborators:
          canManage(data) || (canEdit(data) && data.is_collaborative)
            ? () => setMembersOpen(true)
            : undefined,
        onEdit: canEdit(data) ? () => setEditorOpen(true) : undefined,
        onRegenerate:
          canEdit(data) && data.is_smart ? handleRegenerate : undefined,
        onDelete: canManage(data) ? () => setDeleteOpen(true) : undefined,
      })
    : EMPTY_PAGE_ACTIONS;

  return {
    handleAddMember,
    handleAddTrackToPlaylist,
    handleCopyToMyPlaylists,
    handleCreatePlaylistFromTrack,
    handleDeletePlaylist,
    handleLeave,
    handlePlay,
    handlePlayTrack,
    handlePlaylistRadio,
    handleRegenerate,
    handleRemoveMember,
    handleSavePlaylist,
    handleShare,
    handleShuffle,
    handleToggleFollow,
    handleToggleOffline,
    offlineIcon,
    playlistMenuItems,
    secondaryActions,
  };
}
