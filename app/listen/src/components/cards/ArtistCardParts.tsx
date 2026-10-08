import { useCallback, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { UserRound } from "@crate/ui/icons";
import { useHoverCapability } from "@crate/ui/lib/use-hover-capability";
import { notify } from "@crate/ui/lib/notify";

import {
  ItemActionMenu,
  type UseItemActionMenuReturn,
} from "@/components/actions/ItemActionMenu";
import { fetchArtistTopTracks } from "@/components/actions/shared";
import { useArtistActionEntries } from "@/components/actions/artist-actions";
import { ArtworkSurface } from "@/components/artwork/ArtworkSurface";
import { useArtistFollows } from "@/contexts/ArtistFollowsContext";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { resolveMaybeApiAssetUrl } from "@/lib/api";
import {
  artistPhotoArtwork,
  artworkFromUrl,
  type ArtworkSource,
} from "@/lib/artwork-source";
import { cn } from "@/lib/utils";
import { artistPagePath } from "@/lib/library-routes";

function artistMonogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const firstWord = words[0] ?? "";
  if (words.length === 1) return Array.from(firstWord).slice(0, 2).join("");
  const lastWord = words[words.length - 1] ?? "";
  return `${firstWord[0] ?? ""}${lastWord[0] ?? ""}`;
}

export type ArtistCardVariant = "tile" | "row" | "editorial";

export interface ArtistCardProps {
  name: string;
  artistId?: number;
  artistEntityUid?: string;
  globalArtistUid?: string;
  artistSlug?: string;
  photo?: string;
  hasPhoto?: boolean | null;
  subtitle?: string;
  compact?: boolean;
  href?: string;
  external?: boolean;
  imageTone?: "normal" | "muted";
  large?: boolean;
  layout?: "rail" | "grid";
  fillGrid?: boolean;
  variant?: ArtistCardVariant;
  rank?: number;
  meta?: ReactNode;
}

const ROW_IMAGE_SIZE = 48;

function artistImageSize(variant: ArtistCardVariant, compact: boolean) {
  if (variant === "row") return ROW_IMAGE_SIZE;
  if (variant === "editorial") return 156;
  return compact ? 100 : 140;
}

export function resolveArtistCardVisuals({
  name,
  artistId,
  artistEntityUid,
  globalArtistUid,
  artistSlug,
  photo,
  hasPhoto,
  compact,
  href,
  external,
  layout,
  variant,
}: Pick<
  ArtistCardProps,
  | "name"
  | "artistId"
  | "artistEntityUid"
  | "globalArtistUid"
  | "artistSlug"
  | "photo"
  | "hasPhoto"
  | "href"
> & {
  compact: boolean;
  external: boolean;
  layout: "rail" | "grid";
  variant: ArtistCardVariant;
}) {
  const imageSize = artistImageSize(variant, compact);
  const gridArtwork = layout === "grid" && variant !== "row";
  const artistRouteInput = {
    artistId,
    artistEntityUid,
    globalArtistUid,
    artistSlug,
    artistName: name,
  };
  const generatedArtwork = artistPhotoArtwork(artistRouteInput, {
    preset: "artist-card",
    size:
      variant === "row"
        ? 128
        : gridArtwork
          ? 320
          : compact
            ? 160
            : variant === "editorial"
              ? 320
              : 256,
    ...(gridArtwork ? {} : { sizes: `${imageSize}px` }),
  });
  const isPendingExternalArtwork =
    external && Boolean(photo?.includes("/api/network/external-artist/photo"));
  const photoArtwork: ArtworkSource | null =
    hasPhoto === false
      ? null
      : photo
        ? artworkFromUrl(photo, {
            kind: external ? "external-artist" : "artist-photo",
            logicalKey: generatedArtwork.logicalKey,
            retryPolicy: isPendingExternalArtwork
              ? "eventual"
              : external
                ? "none"
                : "credentials",
          })
        : generatedArtwork;
  const targetHref = href || artistPagePath(artistRouteInput);

  return {
    imageSize,
    monogram: artistMonogram(name).toUpperCase(),
    photoArtwork,
    photoUrl: photoArtwork?.src ?? undefined,
    targetHref,
  };
}

export function useArtistCardModel(
  props: ArtistCardProps & {
    compact: boolean;
    external: boolean;
    layout: "rail" | "grid";
    variant: ArtistCardVariant;
  },
) {
  const { t } = useTranslation();
  const { isFollowing, toggleArtistFollow } = useArtistFollows();
  const canUseInlineHoverActions = useHoverCapability();
  const visuals = resolveArtistCardVisuals(props);
  const following = isFollowing(props.artistId, props.globalArtistUid);
  const hasPlayableArtist =
    props.artistId != null || Boolean(props.globalArtistUid);
  return {
    ...visuals,
    canUseInlineHoverActions,
    following,
    hasPlayableArtist,
    t,
    toggleArtistFollow,
  };
}

export function useArtistCardPlayback({
  artistId,
  artistEntityUid,
  globalArtistUid,
  artistSlug,
  name,
  playAll,
  t,
}: {
  artistId?: number;
  artistEntityUid?: string;
  globalArtistUid?: string;
  artistSlug?: string;
  name: string;
  playAll: ReturnType<typeof usePlayerActions>["playAll"];
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const [playingTopTracks, setPlayingTopTracks] = useState(false);

  const handlePlayTopTracks = useCallback(async () => {
    setPlayingTopTracks(true);
    try {
      const tracks = await fetchArtistTopTracks({
        artistId,
        artistEntityUid,
        globalArtistUid,
        artistSlug,
        name,
      });
      if (!tracks.length) {
        notify.info(t("actions.artist.toasts.noTopTracks"));
        return;
      }
      playAll(tracks, 0, {
        type: "queue",
        name: t("actions.artist.topTracksSource", { name }),
      });
    } catch {
      notify.error(t("actions.artist.toasts.loadTopTracksFailed"));
    } finally {
      setPlayingTopTracks(false);
    }
  }, [
    artistId,
    artistEntityUid,
    globalArtistUid,
    artistSlug,
    name,
    playAll,
    t,
  ]);

  return { handlePlayTopTracks, playingTopTracks };
}

export function useArtistCardFollow({
  artistId,
  globalArtistUid,
  name,
  toggleArtistFollow,
}: {
  artistId?: number;
  globalArtistUid?: string;
  name: string;
  toggleArtistFollow: ReturnType<typeof useArtistFollows>["toggleArtistFollow"];
}) {
  const [togglingFollow, setTogglingFollow] = useState(false);

  const handleToggleFollow = useCallback(() => {
    setTogglingFollow(true);
    toggleArtistFollow(artistId, globalArtistUid, name)
      .catch(() => undefined)
      .finally(() => setTogglingFollow(false));
  }, [artistId, globalArtistUid, name, toggleArtistFollow]);

  return { handleToggleFollow, togglingFollow };
}

export function ArtistCardArtwork({
  photoArtwork,
  name,
  imageTone,
  monogram,
  className,
}: {
  photoArtwork: ArtworkSource | null;
  name: string;
  imageTone: "normal" | "muted";
  monogram: string;
  className: string;
}) {
  return (
    <ArtworkSurface
      source={photoArtwork}
      alt={name}
      className={cn("rounded-full bg-text-primary/5", className)}
      fallback={
        <div
          aria-hidden="true"
          data-testid="artist-artwork-placeholder"
          data-placeholder-style="flat-disc"
          className="grid size-full place-items-center rounded-full bg-surface-elevated"
        >
          <span className="text-sm font-semibold text-text-primary/75">
            {monogram}
          </span>
        </div>
      }
      imageProps={{ loading: "lazy", decoding: "async" }}
      imageClassName={cn(
        "object-cover",
        imageTone === "muted" &&
          "grayscale saturate-0 brightness-[0.52] contrast-125 transition duration-300 group-hover/card:brightness-[0.72]",
      )}
    />
  );
}

export function ArtistCardMenu({
  actionMenu,
  name,
  subtitle,
  artistId,
  artistEntityUid,
  globalArtistUid,
  artistSlug,
  photoUrl,
}: {
  actionMenu: UseItemActionMenuReturn;
  name: string;
  subtitle?: string;
  artistId?: number;
  artistEntityUid?: string;
  globalArtistUid?: string;
  artistSlug?: string;
  photoUrl?: string;
}) {
  const actions = useArtistActionEntries({
    artistId,
    artistEntityUid,
    globalArtistUid,
    artistSlug,
    imageUrl: photoUrl,
    name,
  });

  return (
    <ItemActionMenu
      actions={actions}
      header={{
        type: "media",
        title: name,
        subtitle,
        imageUrl: resolveMaybeApiAssetUrl(photoUrl),
        imageAlt: name,
        imageShape: "circle",
        fallbackIcon: UserRound,
      }}
      open={actionMenu.open}
      position={actionMenu.position}
      menuRef={actionMenu.menuRef}
      onClose={actionMenu.close}
    />
  );
}
