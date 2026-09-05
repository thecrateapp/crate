import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { CRATE_ICON_SIZE, Loader2, Play, UserRound } from "@crate/ui/icons";
import { FollowHeartButton } from "@crate/ui/primitives/FollowHeartButton";
import { toast } from "sonner";

import {
  ItemActionMenu,
  useItemActionMenu,
} from "@/components/actions/ItemActionMenu";
import { useHoverCapability } from "@crate/ui/lib/use-hover-capability";
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

interface ArtistCardProps {
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
}

type ArtistCardResolvedProps = ArtistCardProps & {
  compact: boolean;
  external: boolean;
  imageTone: "normal" | "muted";
  large: boolean;
  layout: "rail" | "grid";
  fillGrid: boolean;
};

function resolveArtistCardVisuals({
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
  large,
  fillGrid,
}: ArtistCardResolvedProps) {
  const imageSize = compact ? 100 : large ? 156 : 140;
  const artistRouteInput = {
    artistId,
    artistEntityUid,
    globalArtistUid,
    artistSlug,
    artistName: name,
  };
  const generatedArtwork = artistPhotoArtwork(artistRouteInput, {
    preset: "artist-card",
    size: layout === "grid" ? 320 : compact ? 160 : large ? 320 : 256,
    ...(layout === "grid" ? {} : { sizes: `${imageSize}px` }),
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
  const targetHref =
    href ||
    artistPagePath({
      artistId,
      artistEntityUid,
      globalArtistUid,
      artistSlug,
      artistName: name,
    });
  const wrapperClassName = cn(
    "group/card snap-start text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:rounded-xl",
    layout === "grid"
      ? "listen-deferred-grid-item w-full min-w-0"
      : `flex-shrink-0 ${
          compact ? "w-[100px]" : large ? "w-[156px]" : "w-[140px]"
        }`,
  );

  return {
    artworkWidth: layout === "grid" ? "100%" : `${imageSize}px`,
    imageSize,
    monogram: artistMonogram(name).toUpperCase(),
    photoArtwork,
    photoUrl: photoArtwork?.src ?? undefined,
    targetHref,
    wrapperClassName,
    fillGrid,
  };
}

function useArtistCardModel({
  name,
  artistId,
  artistEntityUid,
  globalArtistUid,
  artistSlug,
  photo,
  hasPhoto,
  subtitle,
  compact,
  href,
  external,
  imageTone,
  large,
  layout,
  fillGrid,
}: ArtistCardResolvedProps) {
  const { t } = useTranslation();
  const { isFollowing, toggleArtistFollow } = useArtistFollows();
  const canUseInlineHoverActions = useHoverCapability();
  const visuals = resolveArtistCardVisuals({
    name,
    artistId,
    artistEntityUid,
    globalArtistUid,
    artistSlug,
    photo,
    hasPhoto,
    subtitle,
    compact,
    href,
    external,
    imageTone,
    large,
    layout,
    fillGrid,
  });
  const following = isFollowing(artistId, globalArtistUid);
  const hasPlayableArtist = artistId != null || Boolean(globalArtistUid);
  const actions = useArtistActionEntries({
    artistId,
    artistEntityUid,
    globalArtistUid,
    artistSlug,
    imageUrl: visuals.photoUrl,
    name,
  });
  const actionMenu = useItemActionMenu(actions, { disabled: external });
  const menuPhotoUrl = actionMenu.open
    ? resolveMaybeApiAssetUrl(visuals.photoUrl)
    : null;
  return {
    ...visuals,
    actionMenu,
    actions,
    canUseInlineHoverActions,
    following,
    hasPlayableArtist,
    menuPhotoUrl,
    t,
    toggleArtistFollow,
    imageTone,
    name,
    subtitle,
  };
}

function useArtistCardPlayback({
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

  async function handlePlayTopTracks(
    event: React.MouseEvent<HTMLButtonElement>,
  ) {
    event.stopPropagation();
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
        toast.info(t("actions.artist.toasts.noTopTracks"));
        return;
      }
      playAll(tracks, 0, {
        type: "queue",
        name: t("actions.artist.topTracksSource", { name }),
      });
    } catch {
      toast.error(t("actions.artist.toasts.loadTopTracksFailed"));
    } finally {
      setPlayingTopTracks(false);
    }
  }

  return { handlePlayTopTracks, playingTopTracks };
}

function useArtistCardFollow({
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

  async function handleToggleFollow(
    event: React.MouseEvent<HTMLButtonElement>,
  ) {
    event.stopPropagation();
    setTogglingFollow(true);
    try {
      await toggleArtistFollow(artistId, globalArtistUid, name);
    } catch {
      // Follow state rolls back in ArtistFollowsContext.
    } finally {
      setTogglingFollow(false);
    }
  }

  return { handleToggleFollow, togglingFollow };
}

function ArtistCardArtwork({
  photoArtwork,
  name,
  imageSize,
  artworkWidth,
  fillGrid,
  imageTone,
  monogram,
}: {
  photoArtwork: ArtworkSource | null;
  name: string;
  imageSize: number;
  artworkWidth: string;
  fillGrid: boolean;
  imageTone: "normal" | "muted";
  monogram: string;
}) {
  return (
    <ArtworkSurface
      source={photoArtwork}
      alt={name}
      className="relative mx-auto mb-2 aspect-square overflow-hidden rounded-full bg-text-primary/5"
      style={{
        width: artworkWidth,
        maxWidth: artworkWidth === "100%" && fillGrid ? "none" : imageSize,
        height: artworkWidth === "100%" ? "auto" : imageSize,
      }}
      fallback={
        <div
          aria-hidden="true"
          data-testid="artist-artwork-placeholder"
          data-placeholder-style="flat-disc"
          className="grid h-full w-full place-items-center rounded-full bg-surface-elevated"
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

function ArtistCardDetails({
  name,
  subtitle,
}: {
  name: string;
  subtitle?: string;
}) {
  return (
    <>
      <div className="truncate text-center text-sm font-medium text-text-primary">
        {name}
      </div>
      {subtitle ? (
        <div className="truncate text-center text-xs text-text-muted">
          {subtitle}
        </div>
      ) : null}
    </>
  );
}

function ArtistCardInlineActions({
  artistName,
  artworkWidth,
  following,
  hasPlayableArtist,
  canUseInlineHoverActions,
  playingTopTracks,
  togglingFollow,
  handlePlayTopTracks,
  handleToggleFollow,
  t,
}: {
  artistName: string;
  artworkWidth: string;
  following: boolean;
  hasPlayableArtist: boolean;
  canUseInlineHoverActions: boolean;
  playingTopTracks: boolean;
  togglingFollow: boolean;
  handlePlayTopTracks: (event: React.MouseEvent<HTMLButtonElement>) => void;
  handleToggleFollow: (event: React.MouseEvent<HTMLButtonElement>) => void;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  if (!hasPlayableArtist || !canUseInlineHoverActions) return null;

  return (
    <div
      className="pointer-events-none absolute left-1/2 top-0 z-10 flex aspect-square -translate-x-1/2 items-center justify-center rounded-full bg-surface-canvas/0 transition-colors group-hover/card:bg-surface-canvas/42"
      style={{ width: artworkWidth }}
    >
      <div className="pointer-events-none flex translate-y-2 items-center justify-center gap-2 opacity-0 transition-[transform,opacity] group-hover/card:translate-y-0 group-hover/card:opacity-100">
        <button
          type="button"
          className="pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-accent-action text-accent-action-foreground shadow-lg"
          onClick={handlePlayTopTracks}
          aria-label={t("actions.artist.playTopTracksFrom", {
            name: artistName,
          })}
          title={t("actions.artist.playTopTracks")}
        >
          {playingTopTracks ? (
            <Loader2 size={CRATE_ICON_SIZE.md} className="animate-spin" />
          ) : (
            <Play size={CRATE_ICON_SIZE.md} fill="currentColor" />
          )}
        </button>
        <FollowHeartButton
          className={cn(
            "pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-full border shadow-lg backdrop-blur-sm",
            following
              ? "border-accent-action/30 bg-accent-action/15 text-accent-action"
              : "border-text-primary/16 bg-surface-canvas/35 text-text-primary",
          )}
          onClick={handleToggleFollow}
          aria-label={
            following
              ? t("actions.artist.unfollowNamed", { name: artistName })
              : t("actions.artist.followNamed", { name: artistName })
          }
          title={following ? t("common.following") : t("common.follow")}
          following={following}
          disabled={togglingFollow}
          iconSize={CRATE_ICON_SIZE.md}
        />
      </div>
    </div>
  );
}

export function ArtistCard({
  name,
  artistId,
  artistEntityUid,
  globalArtistUid,
  artistSlug,
  photo,
  hasPhoto,
  subtitle,
  compact,
  href,
  external = false,
  imageTone = "normal",
  large = false,
  layout = "rail",
  fillGrid = false,
}: ArtistCardProps) {
  const navigate = useNavigate();
  const { playAll } = usePlayerActions();
  const model = useArtistCardModel({
    name,
    artistId,
    artistEntityUid,
    globalArtistUid,
    artistSlug,
    photo,
    hasPhoto,
    subtitle,
    compact: Boolean(compact),
    href,
    external,
    imageTone,
    large,
    layout,
    fillGrid,
  });
  const playback = useArtistCardPlayback({
    artistId,
    artistEntityUid,
    globalArtistUid,
    artistSlug,
    name,
    playAll,
    t: model.t,
  });
  const follow = useArtistCardFollow({
    artistId,
    globalArtistUid,
    name,
    toggleArtistFollow: model.toggleArtistFollow,
  });
  const content = (
    <>
      <ArtistCardArtwork
        photoArtwork={model.photoArtwork}
        name={name}
        imageSize={model.imageSize}
        artworkWidth={model.artworkWidth}
        fillGrid={model.fillGrid}
        imageTone={model.imageTone}
        monogram={model.monogram}
      />
      <ArtistCardDetails name={name} subtitle={subtitle} />
    </>
  );

  if (external) {
    return (
      <a
        href={model.targetHref}
        target="_blank"
        rel="noopener noreferrer"
        className={model.wrapperClassName}
      >
        {content}
      </a>
    );
  }

  return (
    <article
      className={model.wrapperClassName}
      onContextMenu={model.actionMenu.handleContextMenu}
      {...model.actionMenu.longPressHandlers}
    >
      <button
        type="button"
        className="group block w-full rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        onClick={() => navigate(model.targetHref)}
        onKeyDown={(event) => {
          model.actionMenu.handleKeyboardTrigger(event);
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            navigate(model.targetHref);
          }
        }}
      >
        {content}
      </button>
      <ArtistCardInlineActions
        artistName={name}
        artworkWidth={model.artworkWidth}
        following={model.following}
        hasPlayableArtist={model.hasPlayableArtist}
        canUseInlineHoverActions={model.canUseInlineHoverActions}
        playingTopTracks={playback.playingTopTracks}
        togglingFollow={follow.togglingFollow}
        handlePlayTopTracks={playback.handlePlayTopTracks}
        handleToggleFollow={follow.handleToggleFollow}
        t={model.t}
      />
      <ItemActionMenu
        actions={model.actions}
        header={{
          type: "media",
          title: name,
          subtitle,
          imageUrl: model.menuPhotoUrl,
          imageAlt: name,
          imageShape: "circle",
          fallbackIcon: UserRound,
        }}
        open={model.actionMenu.open}
        position={model.actionMenu.position}
        menuRef={model.actionMenu.menuRef}
        onClose={model.actionMenu.close}
      />
    </article>
  );
}
