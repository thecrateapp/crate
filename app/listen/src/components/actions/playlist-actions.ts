import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDownToLine,
  ArrowDownToLineBold,
  Heart,
  HeartBold,
  Loader2,
  Play,
  Radio,
  Share2,
  Shuffle,
} from "@crate/ui/icons";
import { toast } from "sonner";

import type { ItemActionMenuEntry } from "@crate/ui/domain/actions";
import {
  action,
  sharePath,
  type PlaylistMenuData,
} from "@/components/actions/shared";
import { useOffline } from "@/contexts/OfflineContext";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { isOfflineBusy } from "@/lib/offline";
import { fetchPlaylistRadio } from "@/lib/radio";

export function usePlaylistActionEntries(
  input: PlaylistMenuData,
): ItemActionMenuEntry[] {
  const { t } = useTranslation();
  const { playAll } = usePlayerActions();
  const {
    supported: offlineSupported,
    getPlaylistState,
    togglePlaylistOffline,
  } = useOffline();
  const offlineState = getPlaylistState(input.playlistId);
  const offlineActionLabel = (() => {
    switch (offlineState) {
      case "ready":
        return t("actions.offline.removeCopy");
      case "error":
        return t("actions.offline.retryCopy");
      case "queued":
      case "downloading":
        return t("actions.offline.downloading");
      case "syncing":
        return t("actions.offline.syncing");
      default:
        return t("actions.offline.makeAvailable");
    }
  })();

  return useMemo<ItemActionMenuEntry[]>(() => {
    const entries: ItemActionMenuEntry[] = [];

    if (input.onPlay) {
      entries.push(
        action({
          key: "play",
          label: t("actions.playlist.play"),
          icon: Play,
          onSelect: async () => {
            await input.onPlay?.();
          },
        }),
      );
    }

    if (input.onShuffle) {
      entries.push(
        action({
          key: "shuffle",
          label: t("actions.playlist.shuffle"),
          icon: Shuffle,
          onSelect: async () => {
            await input.onShuffle?.();
          },
        }),
      );
    }

    if (input.onStartRadio) {
      entries.push(
        action({
          key: "radio",
          label: t("actions.playlist.radio"),
          icon: Radio,
          onSelect: async () => {
            await input.onStartRadio?.();
          },
        }),
      );
    } else if (input.playlistId != null) {
      const playlistId = input.playlistId;
      entries.push(
        action({
          key: "radio",
          label: t("actions.playlist.radio"),
          icon: Radio,
          onSelect: async () => {
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
          },
        }),
      );
    }

    if (input.canFollow && input.onToggleFollow) {
      entries.push({ type: "divider", key: "divider-playlist-follow" });
      entries.push(
        action({
          key: "follow",
          label: input.isFollowed
            ? t("actions.playlist.removeFromLibrary")
            : t("actions.playlist.addToLibrary"),
          icon: input.isFollowed ? HeartBold : Heart,
          active: input.isFollowed,
          onSelect: async () => {
            await input.onToggleFollow?.();
          },
        }),
      );
    }

    entries.push({ type: "divider", key: "divider-playlist-offline" });
    entries.push(
      action({
        key: "offline",
        label: input.isSmart
          ? t("actions.playlist.offlineStaticOnly")
          : offlineActionLabel,
        icon: isOfflineBusy(offlineState)
          ? Loader2
          : offlineState === "ready"
            ? ArrowDownToLineBold
            : ArrowDownToLine,
        active: offlineState === "ready",
        disabled:
          !offlineSupported ||
          input.playlistId == null ||
          Boolean(input.isSmart) ||
          isOfflineBusy(offlineState),
        onSelect: async () => {
          try {
            const result = await togglePlaylistOffline({
              playlistId: input.playlistId,
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
      }),
    );

    if (input.href) {
      entries.push({ type: "divider", key: "divider-playlist-share" });
      entries.push(
        action({
          key: "share",
          label: t("actions.playlist.share"),
          icon: Share2,
          onSelect: sharePath(input.href, input.name, {
            kind: "playlist",
            copiedToast: t("share.toasts.linkCopied"),
          }),
        }),
      );
    }

    return entries;
  }, [
    input,
    offlineActionLabel,
    offlineState,
    offlineSupported,
    playAll,
    t,
    togglePlaylistOffline,
  ]);
}
