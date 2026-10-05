import type { TFunction } from "i18next";
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowDownToLineBold,
  Heart,
  HeartBold,
  Loader2,
  Pencil,
  Radio,
  Share2,
  Users,
  type CrateIcon,
} from "@crate/ui/icons";
import type { ContextMenuEntry } from "@crate/ui/domain/actions";

import { buildPlaylistMenuItems } from "@/components/actions/playlist-actions";
import type { PlaylistHeroSecondaryAction } from "@/components/playlists/PlaylistHeroSection";
import type { OfflineItemState } from "@/lib/offline";

type Handler = () => void | Promise<void>;

export interface PlaylistPageOffline {
  state: OfflineItemState;
  presentation: { busy: boolean; buttonLabel: string };
  supported: boolean;
  isSmart: boolean;
  onToggle: Handler;
}

export interface PlaylistPageActionInput {
  t: TFunction;
  playDisabled: boolean;
  onPlay: Handler;
  onShuffle: Handler;
  onRadio: Handler;
  onShare: Handler;
  offline?: PlaylistPageOffline;
  follow?: { followed: boolean; pending: boolean; onToggle: Handler };
  onCollaborators?: Handler;
  onEdit?: Handler;
  onRegenerate?: Handler;
  onDelete?: Handler;
}

export interface PlaylistPageActions {
  offlineIcon: CrateIcon;
  playlistMenuItems: ContextMenuEntry[];
  secondaryActions: PlaylistHeroSecondaryAction[];
}

export function getPlaylistOfflineIcon(
  offlineState: OfflineItemState,
  offlinePresentation: { busy: boolean },
): CrateIcon {
  return offlineState === "ready"
    ? ArrowDownToLineBold
    : offlinePresentation.busy
      ? Loader2
      : offlineState === "error"
        ? AlertCircle
        : ArrowDownToLine;
}

function offlineDisabled(offline: PlaylistPageOffline) {
  return !offline.supported || offline.isSmart || offline.presentation.busy;
}

export function buildPlaylistPageActions({
  t,
  playDisabled,
  onPlay,
  onShuffle,
  onRadio,
  onShare,
  offline,
  follow,
  onCollaborators,
  onEdit,
  onRegenerate,
  onDelete,
}: PlaylistPageActionInput): PlaylistPageActions {
  const offlineIcon = offline
    ? getPlaylistOfflineIcon(offline.state, offline.presentation)
    : ArrowDownToLine;

  const playlistMenuItems = buildPlaylistMenuItems({
    t,
    playDisabled,
    onPlay,
    onShuffle,
    onStartRadio: onRadio,
    follow: follow
      ? {
          followed: follow.followed,
          disabled: follow.pending,
          onToggle: follow.onToggle,
        }
      : undefined,
    offline: offline
      ? {
          label: offline.presentation.buttonLabel,
          icon: offlineIcon,
          active: offline.state === "ready",
          disabled: offlineDisabled(offline),
          onToggle: offline.onToggle,
        }
      : undefined,
    onCollaborators,
    onEdit,
    onRegenerate,
    onShare,
    onDelete,
  });

  const secondaryActions: PlaylistHeroSecondaryAction[] = [
    {
      key: "radio",
      label: t("radio.title"),
      ariaLabel: t("playlist.actions.radio"),
      icon: Radio,
      disabled: playDisabled,
      onClick: () => void onRadio(),
    },
  ];
  if (offline) {
    secondaryActions.push({
      key: "offline",
      label: t("common.offline"),
      ariaLabel:
        offline.state === "ready"
          ? t("playlist.offline.removeCopy")
          : t("playlist.offline.makeAvailable"),
      icon: offlineIcon,
      iconClassName: offline.presentation.busy ? "animate-spin" : undefined,
      className:
        offline.state === "ready"
          ? "text-text-accent drop-shadow-accent-action"
          : offline.presentation.busy
            ? "text-accent-action"
            : offline.state === "error"
              ? "text-state-warning-text/90"
              : undefined,
      disabled: offlineDisabled(offline),
      title: offline.presentation.buttonLabel,
      onClick: () => void offline.onToggle(),
    });
  }
  if (follow) {
    secondaryActions.push({
      key: "follow",
      label: follow.followed ? t("common.following") : t("common.follow"),
      ariaLabel: follow.followed
        ? t("playlist.actions.removeFromLibrary")
        : t("common.follow"),
      icon: follow.pending ? Loader2 : follow.followed ? HeartBold : Heart,
      iconClassName: follow.pending ? "animate-spin" : undefined,
      active: follow.followed,
      pulseIcon: follow.followed,
      disabled: follow.pending,
      onClick: () => void follow.onToggle(),
    });
  }
  if (onCollaborators) {
    secondaryActions.push({
      key: "collaborators",
      label: t("playlist.actions.collabs"),
      ariaLabel: t("playlist.actions.collaborators"),
      icon: Users,
      onClick: () => void onCollaborators(),
    });
  }
  if (onEdit) {
    secondaryActions.push({
      key: "edit",
      label: t("common.edit"),
      ariaLabel: t("common.edit"),
      icon: Pencil,
      onClick: () => void onEdit(),
    });
  }
  secondaryActions.push({
    key: "share",
    label: t("common.share"),
    ariaLabel: t("common.share"),
    icon: Share2,
    onClick: () => void onShare(),
  });

  return { offlineIcon, playlistMenuItems, secondaryActions };
}
