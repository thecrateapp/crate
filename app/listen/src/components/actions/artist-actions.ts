import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Heart,
  HeartBold,
  ListMusic,
  Play,
  Radio,
  Share2,
  Shuffle,
} from "@crate/ui/icons";
import { notify } from "@crate/ui/lib/notify";

import type { ItemActionMenuEntry } from "@crate/ui/domain/actions";
import {
  action,
  fetchArtistTopTracks,
  sharePath,
  type ArtistMenuData,
} from "@/components/actions/shared";
import { useArtistFollows } from "@/contexts/ArtistFollowsContext";
import { usePlayerActions } from "@/contexts/PlayerContext";
import {
  artistPagePath,
  artistPhotoApiUrl,
  artistSharePath,
} from "@/lib/library-routes";
import { fetchArtistRadio } from "@/lib/radio";
import { shuffleArray } from "@/lib/utils";

export interface ArtistMenuItemsInput {
  following: boolean;
  playDisabled?: boolean;
  radioDisabled?: boolean;
  followDisabled?: boolean;
  hasSetlist?: boolean;
  onPlay: () => void | Promise<void>;
  onShuffle: () => void | Promise<void>;
  onRadio: () => void | Promise<void>;
  onPlaySetlist?: () => void | Promise<void>;
  onToggleFollow: () => void | Promise<void>;
  onShare: () => void | Promise<void>;
  t: ReturnType<typeof useTranslation>["t"];
}

export function buildArtistMenuItems({
  following,
  playDisabled = false,
  radioDisabled = false,
  followDisabled = false,
  hasSetlist = false,
  onPlay,
  onShuffle,
  onRadio,
  onPlaySetlist,
  onToggleFollow,
  onShare,
  t,
}: ArtistMenuItemsInput): ItemActionMenuEntry[] {
  return [
    action({
      key: "play",
      label: t("actions.artist.playTopTracks"),
      icon: Play,
      disabled: playDisabled,
      onSelect: onPlay,
    }),
    action({
      key: "shuffle",
      label: t("actions.artist.shuffleTopTracks"),
      icon: Shuffle,
      disabled: playDisabled,
      onSelect: onShuffle,
    }),
    ...(onPlaySetlist
      ? [
          action({
            key: "setlist",
            label: t("artist.actions.playSetlist"),
            icon: ListMusic,
            disabled: !hasSetlist,
            onSelect: onPlaySetlist,
          }),
        ]
      : []),
    { type: "divider", key: "divider-artist-main" },
    action({
      key: "follow",
      label: following
        ? t("actions.artist.unfollow")
        : t("actions.artist.follow"),
      icon: following ? HeartBold : Heart,
      active: following,
      disabled: followDisabled,
      onSelect: onToggleFollow,
    }),
    action({
      key: "radio",
      label: t("actions.artist.radio"),
      icon: Radio,
      disabled: radioDisabled,
      onSelect: onRadio,
    }),
    action({
      key: "share",
      label: t("actions.artist.share"),
      icon: Share2,
      onSelect: onShare,
    }),
  ];
}

export function useArtistActionEntries(
  input: ArtistMenuData,
): ItemActionMenuEntry[] {
  const { t } = useTranslation();
  const { playAll } = usePlayerActions();
  const { isFollowing, toggleArtistFollow } = useArtistFollows();
  const following = isFollowing(input.artistId, input.globalArtistUid);
  const hasPlayableArtist =
    input.artistId != null || Boolean(input.globalArtistUid);
  const radioSeed = input.artistId ?? input.globalArtistUid ?? null;

  return useMemo<ItemActionMenuEntry[]>(() => {
    const artistPath = artistPagePath({
      artistId: input.artistId,
      artistEntityUid: input.artistEntityUid,
      globalArtistUid: input.globalArtistUid,
      artistSlug: input.artistSlug,
      artistName: input.name,
    });
    const artistShare = artistSharePath({
      artistId: input.artistId,
      artistEntityUid: input.artistEntityUid,
      globalArtistUid: input.globalArtistUid,
      artistSlug: input.artistSlug,
      artistName: input.name,
    });
    const artistImage =
      input.imageUrl ||
      artistPhotoApiUrl(
        {
          artistId: input.artistId,
          artistEntityUid: input.artistEntityUid,
          globalArtistUid: input.globalArtistUid,
          artistSlug: input.artistSlug,
          artistName: input.name,
        },
        { size: 1024 },
      );

    const playTopTracks = async (shuffle: boolean) => {
      if (!hasPlayableArtist) return;
      try {
        const tracks = await fetchArtistTopTracks(input);
        if (!tracks.length) {
          notify.info(t("actions.artist.toasts.noTopTracks"));
          return;
        }
        playAll(shuffle ? shuffleArray(tracks) : tracks, 0, {
          type: "queue",
          name: t("actions.artist.topTracksSource", {
            name: input.name,
          }),
        });
      } catch {
        notify.error(t("actions.artist.toasts.loadTopTracksFailed"));
      }
    };

    return buildArtistMenuItems({
      following,
      playDisabled: !hasPlayableArtist,
      followDisabled: !hasPlayableArtist,
      radioDisabled: radioSeed == null,
      onPlay: () => playTopTracks(false),
      onShuffle: () => playTopTracks(true),
      onToggleFollow: async () => {
        await toggleArtistFollow(
          input.artistId ?? null,
          input.globalArtistUid ?? null,
          input.name,
        );
      },
      onRadio: async () => {
        if (radioSeed == null) return;
        try {
          const radio = await fetchArtistRadio(radioSeed, input.name);
          if (!radio.tracks.length) {
            notify.info(t("actions.artist.toasts.radioUnavailable"));
            return;
          }
          playAll(radio.tracks, 0, radio.source);
        } catch {
          notify.error(t("actions.artist.toasts.radioFailed"));
        }
      },
      onShare: sharePath(artistShare || artistPath, input.name, {
        kind: "artist",
        imageUrl: artistImage,
        copiedToast: t("share.toasts.linkCopied"),
      }),
      t,
    });
  }, [
    following,
    hasPlayableArtist,
    input,
    playAll,
    radioSeed,
    t,
    toggleArtistFollow,
  ]);
}
