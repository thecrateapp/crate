import { useCallback, useEffect, useMemo, useRef } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  ArrowDownToLine,
  ArrowDownToLineBold,
  Heart,
  HeartBold,
  Loader2,
  Pencil,
  Play,
  Radio,
  RefreshCw,
  Share2,
  Shuffle,
  Sparkles,
  Trash2,
  Users,
  type CrateIcon,
} from "@crate/ui/icons";
import { toast } from "sonner";

import type {
  ContextMenuHeader,
  ItemActionMenuEntry,
} from "@crate/ui/domain/actions";
import type { EntityActionMenu } from "@crate/ui/domain/entity";
import { useListenEntityMenu } from "@/components/actions/entity-menu";
import {
  action,
  sharePath,
  type PlaylistMenuData,
} from "@/components/actions/shared";
import { useOffline } from "@/contexts/OfflineContext";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { isOfflineBusy, type OfflineItemState } from "@/lib/offline";
import { fetchPlaylistRadio } from "@/lib/radio";

type MenuHandler = () => void | Promise<void>;

export interface PlaylistItemMenuData extends PlaylistMenuData {
  extraEntries?: ItemActionMenuEntry[];
}

export interface PlaylistMenuItemsInput {
  t: TFunction;
  playDisabled?: boolean;
  onPlay?: MenuHandler;
  onShuffle?: MenuHandler;
  onStartRadio?: MenuHandler;
  follow?: {
    followed: boolean;
    disabled?: boolean;
    onToggle: MenuHandler;
  };
  offline?: {
    label: string;
    icon: CrateIcon;
    active: boolean;
    disabled: boolean;
    onToggle: MenuHandler;
  };
  onCollaborators?: MenuHandler;
  onEdit?: MenuHandler;
  onRegenerate?: MenuHandler;
  onShare?: MenuHandler;
  onDelete?: MenuHandler;
  extraEntries?: ItemActionMenuEntry[];
}

function joinGroups(groups: Array<[string, ItemActionMenuEntry[]]>) {
  const entries: ItemActionMenuEntry[] = [];
  for (const [key, group] of groups) {
    if (!group.length) continue;
    if (entries.length) {
      entries.push({ type: "divider", key: `divider-playlist-${key}` });
    }
    entries.push(...group);
  }
  return entries;
}

export function buildPlaylistMenuItems({
  t,
  playDisabled = false,
  onPlay,
  onShuffle,
  onStartRadio,
  follow,
  offline,
  onCollaborators,
  onEdit,
  onRegenerate,
  onShare,
  onDelete,
  extraEntries,
}: PlaylistMenuItemsInput): ItemActionMenuEntry[] {
  const playback: ItemActionMenuEntry[] = [];
  if (onPlay) {
    playback.push(
      action({
        key: "play",
        label: t("actions.playlist.play"),
        icon: Play,
        disabled: playDisabled,
        onSelect: onPlay,
      }),
    );
  }
  if (onShuffle) {
    playback.push(
      action({
        key: "shuffle",
        label: t("actions.playlist.shuffle"),
        icon: Shuffle,
        disabled: playDisabled,
        onSelect: onShuffle,
      }),
    );
  }
  if (onStartRadio) {
    playback.push(
      action({
        key: "radio",
        label: t("actions.playlist.radio"),
        icon: Radio,
        disabled: playDisabled,
        onSelect: onStartRadio,
      }),
    );
  }

  const library: ItemActionMenuEntry[] = [];
  if (follow) {
    library.push(
      action({
        key: "follow",
        label: follow.followed
          ? t("actions.playlist.removeFromLibrary")
          : t("actions.playlist.addToLibrary"),
        icon: follow.followed ? HeartBold : Heart,
        active: follow.followed,
        disabled: follow.disabled,
        onSelect: follow.onToggle,
      }),
    );
  }
  if (offline) {
    library.push(
      action({
        key: "offline",
        label: offline.label,
        icon: offline.icon,
        active: offline.active,
        disabled: offline.disabled,
        onSelect: offline.onToggle,
      }),
    );
  }
  if (onCollaborators) {
    library.push(
      action({
        key: "collaborators",
        label: t("playlist.actions.collaborators"),
        icon: Users,
        onSelect: onCollaborators,
      }),
    );
  }
  if (onEdit) {
    library.push(
      action({
        key: "edit",
        label: t("playlist.actions.editPlaylist"),
        icon: Pencil,
        onSelect: onEdit,
      }),
    );
  }
  if (onRegenerate) {
    library.push(
      action({
        key: "regenerate",
        label: t("playlist.actions.regenerate"),
        icon: RefreshCw,
        onSelect: onRegenerate,
      }),
    );
  }

  const share: ItemActionMenuEntry[] = onShare
    ? [
        action({
          key: "share",
          label: t("actions.playlist.share"),
          icon: Share2,
          onSelect: onShare,
        }),
      ]
    : [];

  const danger: ItemActionMenuEntry[] = [...(extraEntries ?? [])];
  if (onDelete) {
    danger.push(
      action({
        key: "delete",
        label: t("playlist.actions.deletePlaylist"),
        icon: Trash2,
        danger: true,
        onSelect: onDelete,
      }),
    );
  }

  return joinGroups([
    ["playback", playback],
    ["library", library],
    ["share", share],
    ["danger", danger],
  ]);
}

function playlistOfflineLabelKey(state: OfflineItemState): string {
  switch (state) {
    case "ready":
      return "actions.offline.removeCopy";
    case "error":
      return "actions.offline.retryCopy";
    case "queued":
    case "downloading":
      return "actions.offline.downloading";
    case "syncing":
      return "actions.offline.syncing";
    default:
      return "actions.offline.makeAvailable";
  }
}

interface PlaylistMenuContext {
  t: TFunction;
  playAll: ReturnType<typeof usePlayerActions>["playAll"];
  offlineSupported: boolean;
  offlineState: OfflineItemState;
  togglePlaylistOffline: ReturnType<typeof useOffline>["togglePlaylistOffline"];
}

function buildPlaylistItemEntries(
  input: PlaylistItemMenuData,
  {
    t,
    playAll,
    offlineSupported,
    offlineState,
    togglePlaylistOffline,
  }: PlaylistMenuContext,
): ItemActionMenuEntry[] {
  const playlistId = input.playlistId;
  const startRadio =
    input.onStartRadio ??
    (playlistId != null
      ? async () => {
          try {
            const radio = await fetchPlaylistRadio({
              playlistId,
              playlistName: input.name,
            });
            if (!radio.tracks.length) {
              toast.info(t("actions.playlist.toasts.radioUnavailable"));
              return;
            }
            playAll(radio.tracks, 0, radio.source);
          } catch {
            toast.error(t("actions.playlist.toasts.radioFailed"));
          }
        }
      : undefined);

  return buildPlaylistMenuItems({
    t,
    onPlay: input.onPlay,
    onShuffle: input.onShuffle,
    onStartRadio: startRadio,
    follow:
      input.canFollow && input.onToggleFollow
        ? {
            followed: Boolean(input.isFollowed),
            onToggle: input.onToggleFollow,
          }
        : undefined,
    offline: {
      label: input.isSmart
        ? t("actions.playlist.offlineStaticOnly")
        : t(playlistOfflineLabelKey(offlineState)),
      icon: isOfflineBusy(offlineState)
        ? Loader2
        : offlineState === "ready"
          ? ArrowDownToLineBold
          : ArrowDownToLine,
      active: offlineState === "ready",
      disabled:
        !offlineSupported ||
        playlistId == null ||
        Boolean(input.isSmart) ||
        isOfflineBusy(offlineState),
      onToggle: async () => {
        try {
          const result = await togglePlaylistOffline({
            playlistId,
            title: input.name,
            isSmart: input.isSmart,
          });
          toast.success(
            result === "removed"
              ? t("actions.offline.toasts.removed")
              : t("actions.playlist.toasts.offlineReady"),
          );
        } catch (error) {
          toast.error(
            (error as Error).message ||
              t("actions.offline.toasts.updateFailed"),
          );
        }
      },
    },
    onShare: input.href
      ? sharePath(input.href, input.name, {
          kind: "playlist",
          copiedToast: t("share.toasts.linkCopied"),
        })
      : undefined,
    extraEntries: input.extraEntries,
  });
}

function usePlaylistMenuContext(
  playlistId: number | undefined,
): PlaylistMenuContext {
  const { t } = useTranslation();
  const { playAll } = usePlayerActions();
  const { supported, getPlaylistState, togglePlaylistOffline } = useOffline();
  return {
    t,
    playAll,
    offlineSupported: supported,
    offlineState: getPlaylistState(playlistId),
    togglePlaylistOffline,
  };
}

export function usePlaylistActionEntries(
  input: PlaylistMenuData,
): ItemActionMenuEntry[] {
  const { t, playAll, offlineSupported, offlineState, togglePlaylistOffline } =
    usePlaylistMenuContext(input.playlistId);

  return useMemo(
    () =>
      buildPlaylistItemEntries(input, {
        t,
        playAll,
        offlineSupported,
        offlineState,
        togglePlaylistOffline,
      }),
    [input, offlineState, offlineSupported, playAll, t, togglePlaylistOffline],
  );
}

export interface PlaylistActionMenuHeader {
  title: string;
  subtitle?: string;
  detail?: string;
}

export function usePlaylistActionMenu(
  input: PlaylistItemMenuData,
  { title, subtitle, detail }: PlaylistActionMenuHeader,
): EntityActionMenu {
  const context = usePlaylistMenuContext(input.playlistId);
  const latest = useRef({ input, context });
  useEffect(() => {
    latest.current = { input, context };
  });
  const getActions = useCallback(
    () =>
      buildPlaylistItemEntries(latest.current.input, latest.current.context),
    [],
  );

  const header = useMemo<ContextMenuHeader>(
    () => ({
      type: "media",
      title,
      subtitle,
      detail,
      imageShape: "square",
      fallbackIcon: Sparkles,
    }),
    [detail, subtitle, title],
  );

  return useListenEntityMenu(getActions, header);
}
