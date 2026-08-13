import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Heart,
  HeartBold,
  Play,
  Radio,
  Share2,
  Shuffle,
} from "@crate/ui/icons";
import { toast } from "sonner";

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

    return [
      action({
        key: "play",
        label: t("actions.artist.playTopTracks"),
        icon: Play,
        disabled: !hasPlayableArtist,
        onSelect: async () => {
          if (!hasPlayableArtist) return;
          try {
            const tracks = await fetchArtistTopTracks(input);
            if (!tracks.length) {
              toast.info(t("actions.artist.toasts.noTopTracks"));
              return;
            }
            playAll(tracks, 0, {
              type: "queue",
              name: t("actions.artist.topTracksSource", {
                name: input.name,
              }),
            });
          } catch {
            toast.error(t("actions.artist.toasts.loadTopTracksFailed"));
          }
        },
      }),
      action({
        key: "shuffle",
        label: t("actions.artist.shuffleTopTracks"),
        icon: Shuffle,
        disabled: !hasPlayableArtist,
        onSelect: async () => {
          if (!hasPlayableArtist) return;
          try {
            const tracks = await fetchArtistTopTracks(input);
            if (!tracks.length) {
              toast.info(t("actions.artist.toasts.noTopTracks"));
              return;
            }
            playAll(shuffleArray(tracks), 0, {
              type: "queue",
              name: t("actions.artist.topTracksSource", {
                name: input.name,
              }),
            });
          } catch {
            toast.error(t("actions.artist.toasts.loadTopTracksFailed"));
          }
        },
      }),
      { type: "divider", key: "divider-artist-main" },
      action({
        key: "follow",
        label: following
          ? t("actions.artist.unfollow")
          : t("actions.artist.follow"),
        icon: following ? HeartBold : Heart,
        active: following,
        disabled: !hasPlayableArtist,
        onSelect: async () => {
          await toggleArtistFollow(
            input.artistId ?? null,
            input.globalArtistUid ?? null,
            input.name,
          );
        },
      }),
      action({
        key: "radio",
        label: t("actions.artist.radio"),
        icon: Radio,
        disabled: radioSeed == null,
        onSelect: async () => {
          if (radioSeed == null) return;
          try {
            const radio = await fetchArtistRadio(radioSeed, input.name);
            if (!radio.tracks.length) {
              toast.info(t("actions.artist.toasts.radioUnavailable"));
              return;
            }
            playAll(radio.tracks, 0, radio.source);
          } catch {
            toast.error(t("actions.artist.toasts.radioFailed"));
          }
        },
      }),
      action({
        key: "share",
        label: t("actions.artist.share"),
        icon: Share2,
        onSelect: sharePath(artistShare || artistPath, input.name, {
          kind: "artist",
          imageUrl: artistImage,
          copiedToast: t("share.toasts.linkCopied"),
        }),
      }),
    ];
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
