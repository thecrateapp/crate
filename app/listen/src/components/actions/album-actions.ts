import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDownToLine,
  ArrowDownToLineBold,
  Download,
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
  fetchAlbumTracks,
  sharePath,
  type AlbumMenuData,
} from "@/components/actions/shared";
import { usePlayerActions, type PlaySource } from "@/contexts/PlayerContext";
import { useOffline } from "@/contexts/OfflineContext";
import { useSavedAlbums } from "@/contexts/SavedAlbumsContext";
import {
  albumDownloadApiPath,
  albumPagePath,
  albumSharePath,
  downloadApiUrl,
} from "@/lib/library-routes";
import { isOfflineBusy } from "@/lib/offline";
import { fetchAlbumRadio } from "@/lib/radio";
import { shuffleArray } from "@/lib/utils";

function albumPlaySource(data: AlbumMenuData): PlaySource {
  const seedId = data.albumId ?? data.globalAlbumUid;
  return {
    type: "album",
    name: `${data.artist} - ${data.album}`,
    radio: seedId != null ? { seedType: "album", seedId } : undefined,
  };
}

export function useAlbumActionEntries(
  input: AlbumMenuData,
): ItemActionMenuEntry[] {
  const { t } = useTranslation();
  const { playAll } = usePlayerActions();
  const { isSaved, toggleAlbumSaved } = useSavedAlbums();
  const {
    supported: offlineSupported,
    getAlbumState,
    toggleAlbumOffline,
  } = useOffline();
  const saved = isSaved(input.albumId, input.globalAlbumUid);
  const offlineState = getAlbumState(input.albumId);
  const radioSeed = input.albumId ?? input.globalAlbumUid ?? null;
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
    const albumPath = albumPagePath({
      albumId: input.albumId,
      albumEntityUid: input.albumEntityUid,
      globalAlbumUid: input.globalAlbumUid,
      albumSlug: input.albumSlug,
      artistEntityUid: input.artistEntityUid,
      artistSlug: input.artistSlug,
      artistName: input.artist,
      albumName: input.album,
    });
    const albumShare = albumSharePath({
      albumId: input.albumId,
      albumEntityUid: input.albumEntityUid,
      globalAlbumUid: input.globalAlbumUid,
      albumSlug: input.albumSlug,
      artistSlug: input.artistSlug,
      artistName: input.artist,
      albumName: input.album,
    });

    return [
      action({
        key: "play",
        label: t("actions.album.play"),
        icon: Play,
        onSelect: async () => {
          try {
            const tracks = await fetchAlbumTracks(input);
            if (!tracks.length) {
              toast.info(t("actions.album.toasts.noTracks"));
              return;
            }
            playAll(tracks, 0, albumPlaySource(input));
          } catch {
            toast.error(t("actions.album.toasts.loadFailed"));
          }
        },
      }),
      action({
        key: "shuffle",
        label: t("actions.album.shuffle"),
        icon: Shuffle,
        onSelect: async () => {
          try {
            const tracks = await fetchAlbumTracks(input);
            if (!tracks.length) {
              toast.info(t("actions.album.toasts.noTracks"));
              return;
            }
            playAll(shuffleArray(tracks), 0, albumPlaySource(input));
          } catch {
            toast.error(t("actions.album.toasts.loadFailed"));
          }
        },
      }),
      { type: "divider", key: "divider-album-main" },
      action({
        key: "save",
        label: saved ? t("actions.album.unsave") : t("actions.album.save"),
        icon: saved ? HeartBold : Heart,
        active: saved,
        disabled: input.albumId == null && !input.globalAlbumUid,
        onSelect: async () => {
          await toggleAlbumSaved(
            input.albumId ?? null,
            input.globalAlbumUid ?? null,
          );
        },
      }),
      action({
        key: "radio",
        label: t("actions.album.radio"),
        icon: Radio,
        disabled: radioSeed == null,
        onSelect: async () => {
          if (radioSeed == null) return;
          try {
            const radio = await fetchAlbumRadio({
              albumId: radioSeed,
              artistName: input.artist,
              albumName: input.album,
            });
            if (!radio.tracks.length) {
              toast.info(t("actions.album.toasts.radioUnavailable"));
              return;
            }
            playAll(radio.tracks, 0, radio.source);
          } catch {
            toast.error(t("actions.album.toasts.radioFailed"));
          }
        },
      }),
      action({
        key: "offline",
        label: offlineActionLabel,
        icon: isOfflineBusy(offlineState)
          ? Loader2
          : offlineState === "ready"
            ? ArrowDownToLineBold
            : ArrowDownToLine,
        active: offlineState === "ready",
        disabled:
          !offlineSupported ||
          input.albumId == null ||
          isOfflineBusy(offlineState),
        onSelect: async () => {
          try {
            const result = await toggleAlbumOffline({
              albumId: input.albumId,
              title: input.album,
            });
            toast.success(
              result === "removed"
                ? t("actions.offline.toasts.removed")
                : t("actions.album.toasts.offlineReady"),
            );
          } catch (error) {
            toast.error(
              (error as Error).message ||
                t("actions.offline.toasts.updateFailed"),
            );
          }
        },
      }),
      action({
        key: "download",
        label: t("actions.album.downloadZip"),
        icon: Download,
        disabled: input.albumId == null && !input.albumEntityUid,
        onSelect: async () => {
          const path = albumDownloadApiPath({
            albumId: input.albumId,
            albumEntityUid: input.albumEntityUid,
            artistName: input.artist,
            albumName: input.album,
          });
          const url = downloadApiUrl(path);
          if (url) window.location.assign(url);
        },
      }),
      action({
        key: "share",
        label: t("actions.album.share"),
        icon: Share2,
        onSelect: sharePath(albumShare || albumPath, input.album, {
          kind: "album",
          subtitle: input.artist,
          imageUrl: input.cover,
          copiedToast: t("share.toasts.linkCopied"),
        }),
      }),
    ];
  }, [
    input,
    offlineActionLabel,
    offlineState,
    offlineSupported,
    playAll,
    radioSeed,
    saved,
    t,
    toggleAlbumOffline,
    toggleAlbumSaved,
  ]);
}
