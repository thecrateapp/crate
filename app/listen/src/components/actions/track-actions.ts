import { useMemo } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowDownToLine,
  ArrowDownToLineBold,
  Download,
  Loader2,
  Disc3,
  Heart,
  HeartBold,
  ListMusic,
  ListPlus,
  Play,
  Plus,
  Radio,
  Share2,
  UserRound,
} from "@crate/ui/icons";
import { toast } from "sonner";

import type { ItemActionMenuEntry } from "@crate/ui/domain/actions";
import {
  action,
  buildTrackMenuPlayerTrack,
  sharePath,
  type TrackMenuData,
} from "@/components/actions/shared";
import { useLikedTracks } from "@/contexts/LikedTracksContext";
import { useOffline } from "@/contexts/OfflineContext";
import { usePlayerActions } from "@/contexts/PlayerContext";
import {
  albumPagePath,
  artistPagePath,
  downloadApiUrl,
  trackDownloadApiPath,
  trackSharePath,
} from "@/lib/library-routes";
import { isOfflineBusy } from "@/lib/offline";
import {
  hasPlayableTrackReference,
  isUuidLikeTrackId,
} from "@/lib/playable-track";
import { fetchTrackRadio } from "@/lib/radio";

interface UseTrackActionEntriesInput {
  track: TrackMenuData;
  albumCover?: string;
  playlistOptions?: Array<{ id: number; name: string }>;
  onAddToPlaylist?: (
    playlistId: number,
    track: TrackMenuData,
  ) => void | Promise<void>;
  onCreatePlaylist?: (track: TrackMenuData) => void | Promise<void>;
  /**
   * Override for the "Play now" entry. In queue contexts this should call
   * `jumpTo(index)` instead of the default `play(playerTrack)`, otherwise
   * selecting "Play now" from a queue row would reset the queue to a single track.
   */
  onPlayNowOverride?: () => void | Promise<void>;
}

export function useTrackActionEntries(
  input: UseTrackActionEntriesInput,
): ItemActionMenuEntry[] {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { play, playAll, addToQueue, playNext } = usePlayerActions();
  const { isLiked, toggleTrackLike } = useLikedTracks();
  const {
    supported: offlineSupported,
    getTrackState,
    toggleTrackOffline,
  } = useOffline();
  const globalTrackUid = input.track.global_track_uid ?? null;

  const libraryTrackId =
    input.track.library_track_id ??
    (typeof input.track.id === "number" ? input.track.id : null);
  const trackEntityUid =
    input.track.entity_uid ??
    (!globalTrackUid &&
    typeof input.track.id === "string" &&
    isUuidLikeTrackId(input.track.id)
      ? input.track.id
      : null);
  const hasTrackRef = hasPlayableTrackReference(input.track);
  const hasLocalTrackRef = Boolean(
    libraryTrackId != null || trackEntityUid || input.track.path,
  );
  const liked = isLiked(libraryTrackId, trackEntityUid, input.track.path);
  const offlineRef = {
    entityUid: trackEntityUid,
    libraryTrackId,
    path: input.track.path ?? null,
  };
  const offlineState = getTrackState(offlineRef);

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
    const playerTrack = buildTrackMenuPlayerTrack(
      input.track,
      input.albumCover,
    );
    const globalArtistUid = input.track.global_artist_uid;
    const globalAlbumUid = input.track.global_album_uid;
    const trackShare = trackSharePath({
      id: input.track.id,
      globalTrackUid,
      entityUid: trackEntityUid,
      libraryTrackId,
      trackSlug: input.track.slug,
      title: input.track.title,
      artistName: input.track.artist,
    });
    const entries: ItemActionMenuEntry[] = [
      action({
        key: "play",
        label: t("actions.track.playNow"),
        icon: Play,
        onSelect: () =>
          input.onPlayNowOverride
            ? input.onPlayNowOverride()
            : play(playerTrack),
      }),
      action({
        key: "play-next",
        label: t("actions.track.playNext"),
        icon: ListPlus,
        onSelect: () => playNext(playerTrack),
      }),
      action({
        key: "queue",
        label: t("actions.track.addToQueue"),
        icon: Plus,
        onSelect: () => addToQueue(playerTrack),
      }),
      { type: "divider", key: "divider-playback" },
      action({
        key: "like",
        label: liked ? t("actions.track.unlike") : t("actions.track.like"),
        icon: liked ? HeartBold : Heart,
        active: liked,
        disabled: !hasLocalTrackRef,
        onSelect: async () => {
          await toggleTrackLike(
            libraryTrackId,
            trackEntityUid,
            input.track.path,
          );
          toast.success(
            liked
              ? t("actions.track.toasts.unliked")
              : t("actions.track.toasts.liked"),
          );
        },
      }),
      action({
        key: "radio",
        label: t("actions.track.radio"),
        icon: Radio,
        disabled: !hasTrackRef,
        onSelect: async () => {
          try {
            const radio = await fetchTrackRadio({
              libraryTrackId,
              globalTrackUid,
              entityUid: trackEntityUid,
              path: input.track.path,
              title: input.track.title,
            });
            if (!radio.tracks.length) {
              toast.info(t("actions.track.toasts.radioUnavailable"));
              return;
            }
            playAll(radio.tracks, 0, radio.source);
          } catch {
            toast.error(t("actions.track.toasts.radioFailed"));
          }
        },
      }),
      action({
        key: "share",
        label: t("actions.track.share"),
        icon: Share2,
        disabled: trackShare === "/share",
        onSelect: sharePath(trackShare, input.track.title, {
          kind: "track",
          subtitle: input.track.artist,
          imageUrl: input.albumCover,
          copiedToast: t("share.toasts.linkCopied"),
        }),
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
          !offlineSupported || !hasLocalTrackRef || isOfflineBusy(offlineState),
        onSelect: async () => {
          try {
            const result = await toggleTrackOffline({
              entityUid: trackEntityUid,
              libraryTrackId,
              path: input.track.path ?? null,
              title: input.track.title,
            });
            toast.success(
              result === "removed"
                ? t("actions.offline.toasts.removed")
                : t("actions.track.toasts.offlineReady"),
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
        label: t("actions.track.download"),
        icon: Download,
        disabled: !hasLocalTrackRef,
        onSelect: async () => {
          const path = trackDownloadApiPath({
            entityUid: trackEntityUid,
            id: libraryTrackId,
            path: input.track.path,
          });
          const url = downloadApiUrl(path);
          if (url) window.location.assign(url);
        },
      }),
    ];

    if (input.onCreatePlaylist || (input.playlistOptions?.length ?? 0) > 0) {
      entries.push({ type: "divider", key: "divider-playlists" });
      entries.push({
        type: "label",
        key: "playlists-label",
        label: t("actions.track.playlists"),
      });
      if (input.onCreatePlaylist) {
        entries.push(
          action({
            key: "playlist-create",
            label: t("actions.track.addToNewPlaylist"),
            icon: ListMusic,
            onSelect: async () => {
              await input.onCreatePlaylist?.(input.track);
            },
          }),
        );
      }
      for (const playlist of input.playlistOptions || []) {
        entries.push(
          action({
            key: `playlist-${playlist.id}`,
            label: t("actions.track.addToPlaylist", { name: playlist.name }),
            icon: ListMusic,
            onSelect: async () => {
              await input.onAddToPlaylist?.(playlist.id, input.track);
              toast.success(t("actions.track.toasts.addedToPlaylist"));
            },
          }),
        );
      }
    }

    if (
      input.track.artist_id != null ||
      globalArtistUid ||
      input.track.album_id != null ||
      globalAlbumUid
    ) {
      entries.push({ type: "divider", key: "divider-links" });
    }

    if (input.track.artist_id != null || globalArtistUid) {
      entries.push(
        action({
          key: "artist",
          label: t("actions.track.goToArtist"),
          icon: UserRound,
          onSelect: () =>
            navigate(
              artistPagePath({
                artistId: input.track.artist_id,
                artistEntityUid: input.track.artist_entity_uid,
                globalArtistUid,
                artistSlug: input.track.artist_slug,
                artistName: input.track.artist,
              }),
            ),
        }),
      );
    }

    if (input.track.album_id != null || globalAlbumUid) {
      entries.push(
        action({
          key: "album",
          label: t("actions.track.goToAlbum"),
          icon: Disc3,
          onSelect: () =>
            navigate(
              albumPagePath({
                albumId: input.track.album_id,
                albumEntityUid: input.track.album_entity_uid,
                globalAlbumUid,
                artistEntityUid: input.track.artist_entity_uid,
                albumSlug: input.track.album_slug,
                artistName: input.track.artist,
                albumName: input.track.album,
              }),
            ),
        }),
      );
    }

    return entries;
  }, [
    addToQueue,
    input.albumCover,
    input.onAddToPlaylist,
    input.onCreatePlaylist,
    input.onPlayNowOverride,
    input.playlistOptions,
    input.track,
    liked,
    libraryTrackId,
    hasTrackRef,
    hasLocalTrackRef,
    globalTrackUid,
    offlineActionLabel,
    offlineState,
    offlineSupported,
    trackEntityUid,
    navigate,
    play,
    playAll,
    playNext,
    t,
    toggleTrackOffline,
    toggleTrackLike,
  ]);
}
