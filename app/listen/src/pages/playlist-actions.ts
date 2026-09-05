import type { TFunction } from "i18next";
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowDownToLineBold,
  Loader2,
  Pencil,
  Play,
  Radio,
  RefreshCw,
  Share2,
  Shuffle,
  Trash2,
  Users,
  type CrateIcon,
} from "@crate/ui/icons";
import type { ContextMenuEntry } from "@crate/ui/domain/actions";
import { toast } from "sonner";

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
import { publicShareUrl } from "@/lib/share-url";
import { openShareSheet } from "@/lib/social-share";
import { shuffleArray } from "@/lib/utils";
import type { PlaylistOfflinePresentation } from "@/pages/playlist-page-model";
import type {
  PlaylistData,
  PlaylistInvite,
  PlaylistSavePayload,
} from "@/pages/playlist-types";

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
  onInviteCreated: (invite: PlaylistInvite) => void;
  playerTracks: Track[];
  playAll: PlayerActionsValue["playAll"];
  refetch: () => void;
  setCreatingInvite: (value: boolean) => void;
  setDeleteOpen: (value: boolean) => void;
  setDeleting: (value: boolean) => void;
  setEditorOpen: (value: boolean) => void;
  setMembersOpen: (value: boolean) => void;
  setRemovingMemberId: (value: number | null) => void;
  setSaving: (value: boolean) => void;
  t: TFunction;
  togglePlaylistOffline: ReturnType<typeof useOffline>["togglePlaylistOffline"];
  inviteData: PlaylistInvite | null;
}

export interface PlaylistActions {
  handleAddTrackToPlaylist: (
    playlistId: number,
    track: TrackRowData,
  ) => Promise<void>;
  handleCopyInviteLink: () => Promise<void>;
  handleCreateCollaboratorInvite: () => Promise<void>;
  handleCreatePlaylistFromTrack: (track: TrackRowData) => void;
  handleDeletePlaylist: () => Promise<void>;
  handlePlay: () => void;
  handlePlayTrack: (trackEntryId: number) => void;
  handlePlaylistRadio: () => Promise<void>;
  handleRegenerate: () => Promise<void>;
  handleRemoveMember: (memberUserId: number) => Promise<void>;
  handleSavePlaylist: (payload: PlaylistSavePayload) => Promise<void>;
  handleShare: () => void;
  handleShuffle: () => void;
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
  onInviteCreated,
  playerTracks,
  playAll,
  refetch,
  setCreatingInvite,
  setDeleteOpen,
  setDeleting,
  setEditorOpen,
  setMembersOpen,
  setRemovingMemberId,
  setSaving,
  t,
  togglePlaylistOffline,
  inviteData,
}: PlaylistActionInput): PlaylistActions {
  function handlePlay() {
    if (!playerTracks.length) return;
    playAll(playerTracks, 0, {
      type: "playlist",
      name: data?.name || "Playlist",
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
      href: `/playlists/${data.id}`,
      radio: { seedType: "playlist", seedId: data.id },
    });
  }

  function handleShuffle() {
    if (!playerTracks.length) return;
    playAll(shuffleArray(playerTracks), 0, {
      type: "playlist",
      name: data?.name || "Playlist",
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
        toast.info(t("playlist.toasts.radioUnavailable"));
        return;
      }
      playAll(radio.tracks, 0, radio.source);
    } catch {
      toast.error(t("playlist.toasts.radioFailed"));
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
      toast.success(
        result === "removed"
          ? t("playlist.toasts.offlineRemoved")
          : t("playlist.toasts.availableOffline"),
      );
    } catch (error) {
      toast.error(
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
      toast.success(t("playlist.toasts.trackAdded"));
    } catch {
      toast.error(t("playlist.toasts.trackAddFailed"));
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
      toast.success(t("playlist.toasts.regenerated"));
      refetch();
    } catch {
      toast.error(t("playlist.toasts.regenerateFailed"));
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
        visibility: payload.visibility,
        is_collaborative: payload.isCollaborative,
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

      toast.success(t("playlist.toasts.updated"));
      setEditorOpen(false);
      refetch();
    } catch {
      toast.error(t("playlist.toasts.updateFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeletePlaylist() {
    if (!id) return;
    setDeleting(true);
    try {
      await api(`/api/playlists/${id}`, "DELETE");
      toast.success(t("playlist.toasts.deleted"));
      navigate("/library?tab=playlists");
    } catch {
      toast.error(t("playlist.toasts.deleteFailed"));
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  async function handleCreateCollaboratorInvite() {
    if (!data) return;
    setCreatingInvite(true);
    try {
      const invite = await api<PlaylistInvite>(
        `/api/playlists/${data.id}/invites`,
        "POST",
        {},
      );
      onInviteCreated(invite);
      toast.success(t("playlist.toasts.inviteCreated"));
    } catch {
      toast.error(t("playlist.toasts.inviteCreateFailed"));
    } finally {
      setCreatingInvite(false);
    }
  }

  async function handleCopyInviteLink() {
    if (!inviteData || typeof window === "undefined") return;
    const inviteLink = `${window.location.origin}${inviteData.join_url}`;
    try {
      await navigator.clipboard.writeText(inviteLink);
      toast.success(t("playlist.toasts.inviteCopied"));
    } catch {
      toast.error(t("playlist.toasts.inviteCopyFailed"));
    }
  }

  async function handleRemoveMember(memberUserId: number) {
    if (!data) return;
    setRemovingMemberId(memberUserId);
    try {
      await api(`/api/playlists/${data.id}/members/${memberUserId}`, "DELETE");
      toast.success(t("playlist.toasts.collaboratorRemoved"));
      refetch();
    } catch {
      toast.error(t("playlist.toasts.collaboratorRemoveFailed"));
    } finally {
      setRemovingMemberId(null);
    }
  }

  const offlineIcon: CrateIcon =
    offlineState === "ready"
      ? ArrowDownToLineBold
      : offlinePresentation.busy
        ? Loader2
        : offlineState === "error"
          ? AlertCircle
          : ArrowDownToLine;
  const secondaryActions: PlaylistHeroSecondaryAction[] = data
    ? [
        {
          key: "radio",
          label: "Radio",
          ariaLabel: t("playlist.actions.radio"),
          icon: Radio,
          disabled: playerTracks.length === 0,
          onClick: () => void handlePlaylistRadio(),
        },
        {
          key: "offline",
          label: t("common.offline"),
          ariaLabel:
            offlineState === "ready"
              ? t("playlist.offline.removeCopy")
              : t("playlist.offline.makeAvailable"),
          icon: offlineIcon,
          iconClassName: offlinePresentation.busy ? "animate-spin" : undefined,
          className:
            offlineState === "ready"
              ? "text-text-accent drop-shadow-accent-action"
              : offlinePresentation.busy
                ? "text-accent-action"
                : offlineState === "error"
                  ? "text-state-warning-text/90"
                  : undefined,
          disabled:
            !offlineSupported || data.is_smart || offlinePresentation.busy,
          title: offlinePresentation.buttonLabel,
          onClick: () => void handleToggleOffline(),
        },
        ...(data.is_collaborative
          ? [
              {
                key: "collaborators",
                label: t("playlist.actions.collabs"),
                ariaLabel: t("playlist.actions.collaborators"),
                icon: Users,
                onClick: () => setMembersOpen(true),
              } satisfies PlaylistHeroSecondaryAction,
            ]
          : []),
        {
          key: "edit",
          label: t("common.edit"),
          ariaLabel: t("common.edit"),
          icon: Pencil,
          onClick: () => setEditorOpen(true),
        },
        {
          key: "share",
          label: t("common.share"),
          ariaLabel: t("common.share"),
          icon: Share2,
          onClick: handleShare,
        },
      ]
    : [];
  const playlistMenuItems: ContextMenuEntry[] = data
    ? [
        {
          key: "play",
          label: t("playlist.actions.playPlaylist"),
          icon: Play,
          disabled: playerTracks.length === 0,
          onSelect: handlePlay,
        },
        {
          key: "shuffle",
          label: t("playlist.actions.shufflePlaylist"),
          icon: Shuffle,
          disabled: playerTracks.length === 0,
          onSelect: handleShuffle,
        },
        {
          key: "radio",
          label: t("playlist.actions.startRadio"),
          icon: Radio,
          disabled: playerTracks.length === 0,
          onSelect: handlePlaylistRadio,
        },
        { type: "divider", key: "playlist-state-divider" },
        {
          key: "offline",
          label: offlinePresentation.buttonLabel,
          icon: offlineIcon,
          active: offlineState === "ready",
          disabled:
            !offlineSupported || data.is_smart || offlinePresentation.busy,
          onSelect: handleToggleOffline,
        },
        ...(data.is_collaborative
          ? [
              {
                key: "collaborators",
                label: t("playlist.actions.collaborators"),
                icon: Users,
                onSelect: () => setMembersOpen(true),
              } satisfies ContextMenuEntry,
            ]
          : []),
        {
          key: "edit",
          label: t("playlist.actions.editPlaylist"),
          icon: Pencil,
          onSelect: () => setEditorOpen(true),
        },
        ...(data.is_smart
          ? [
              {
                key: "regenerate",
                label: t("playlist.actions.regenerate"),
                icon: RefreshCw,
                onSelect: handleRegenerate,
              } satisfies ContextMenuEntry,
            ]
          : []),
        {
          key: "share",
          label: t("playlist.actions.sharePlaylist"),
          icon: Share2,
          onSelect: handleShare,
        },
        { type: "divider", key: "playlist-danger-divider" },
        {
          key: "delete",
          label: t("playlist.actions.deletePlaylist"),
          icon: Trash2,
          danger: true,
          onSelect: () => setDeleteOpen(true),
        },
      ]
    : [];

  return {
    handleAddTrackToPlaylist,
    handleCopyInviteLink,
    handleCreateCollaboratorInvite,
    handleCreatePlaylistFromTrack,
    handleDeletePlaylist,
    handlePlay,
    handlePlayTrack,
    handlePlaylistRadio,
    handleRegenerate,
    handleRemoveMember,
    handleSavePlaylist,
    handleShare,
    handleShuffle,
    handleToggleOffline,
    offlineIcon,
    playlistMenuItems,
    secondaryActions,
  };
}
