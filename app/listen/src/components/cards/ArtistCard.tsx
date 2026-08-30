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
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { playAll } = usePlayerActions();
  const { isFollowing, toggleArtistFollow } = useArtistFollows();
  const canUseInlineHoverActions = useHoverCapability();
  const [playingTopTracks, setPlayingTopTracks] = useState(false);
  const [togglingFollow, setTogglingFollow] = useState(false);
  const imageSize = compact ? 100 : large ? 156 : 140;
  const shouldResolvePhoto = hasPhoto !== false;
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
  const photoArtwork: ArtworkSource | null = !shouldResolvePhoto
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
  const photoUrl = photoArtwork?.src ?? undefined;
  const targetHref =
    href ||
    artistPagePath({
      artistId,
      artistEntityUid,
      globalArtistUid,
      artistSlug,
      artistName: name,
    });
  const following = isFollowing(artistId, globalArtistUid);
  const hasPlayableArtist = artistId != null || Boolean(globalArtistUid);
  const actions = useArtistActionEntries({
    artistId,
    artistEntityUid,
    globalArtistUid,
    artistSlug,
    imageUrl: photoUrl,
    name,
  });
  const actionMenu = useItemActionMenu(actions, {
    disabled: external,
  });
  const menuPhotoUrl = actionMenu.open
    ? resolveMaybeApiAssetUrl(photoUrl)
    : null;
  const monogram = artistMonogram(name).toUpperCase();
  const wrapperClassName = cn(
    "group snap-start cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:rounded-xl",
    layout === "grid"
      ? "listen-deferred-grid-item w-full min-w-0"
      : `flex-shrink-0 ${
          compact ? "w-[100px]" : large ? "w-[156px]" : "w-[140px]"
        }`,
  );
  const content = (
    <>
      <ArtworkSurface
        source={photoArtwork}
        alt={name}
        className="relative mx-auto mb-2 aspect-square overflow-hidden rounded-full bg-text-primary/5"
        style={{
          width: layout === "grid" ? "100%" : imageSize,
          maxWidth: layout === "grid" && fillGrid ? "none" : imageSize,
          height: layout === "grid" ? "auto" : imageSize,
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
        imageProps={{
          loading: "lazy",
          decoding: "async",
        }}
        imageClassName={cn(
          "object-cover",
          imageTone === "muted" &&
            "grayscale saturate-0 brightness-[0.52] contrast-125 transition duration-300 group-hover:brightness-[0.72]",
        )}
      >
        {!external && hasPlayableArtist && canUseInlineHoverActions ? (
          <>
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-full bg-surface-canvas/0 transition-colors group-hover:bg-surface-canvas/42">
              <div className="pointer-events-none flex translate-y-2 items-center justify-center gap-2 opacity-0 transition-all group-hover:translate-y-0 group-hover:opacity-100">
                <button
                  type="button"
                  className="pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg"
                  onClick={async (event) => {
                    event.stopPropagation();
                    if (!hasPlayableArtist) return;
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
                      toast.error(
                        t("actions.artist.toasts.loadTopTracksFailed"),
                      );
                    } finally {
                      setPlayingTopTracks(false);
                    }
                  }}
                  aria-label={t("actions.artist.playTopTracksFrom", { name })}
                  title={t("actions.artist.playTopTracks")}
                >
                  {playingTopTracks ? (
                    <Loader2
                      size={CRATE_ICON_SIZE.md}
                      className="animate-spin"
                    />
                  ) : (
                    <Play size={CRATE_ICON_SIZE.md} fill="currentColor" />
                  )}
                </button>
                <FollowHeartButton
                  className={cn(
                    "pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-full border shadow-lg backdrop-blur-sm",
                    following
                      ? "border-primary/30 bg-primary/15 text-primary"
                      : "border-text-primary/16 bg-surface-canvas/35 text-text-primary",
                  )}
                  onClick={async (event) => {
                    event.stopPropagation();
                    setTogglingFollow(true);
                    try {
                      await toggleArtistFollow(artistId, globalArtistUid, name);
                    } catch {
                      // Follow state rolls back in ArtistFollowsContext.
                    } finally {
                      setTogglingFollow(false);
                    }
                  }}
                  aria-label={
                    following
                      ? t("actions.artist.unfollowNamed", { name })
                      : t("actions.artist.followNamed", { name })
                  }
                  title={following ? t("common.following") : t("common.follow")}
                  following={following}
                  disabled={togglingFollow}
                  iconSize={CRATE_ICON_SIZE.md}
                />
              </div>
            </div>
          </>
        ) : null}
      </ArtworkSurface>
      <div className="truncate text-sm font-medium text-foreground text-center">
        {name}
      </div>
      {subtitle && (
        <div className="truncate text-xs text-muted-foreground text-center">
          {subtitle}
        </div>
      )}
    </>
  );

  if (external) {
    return (
      <a
        href={targetHref}
        target="_blank"
        rel="noopener noreferrer"
        className={wrapperClassName}
      >
        {content}
      </a>
    );
  }

  return (
    <div
      className={wrapperClassName}
      role="button"
      tabIndex={0}
      onContextMenu={actionMenu.handleContextMenu}
      {...actionMenu.longPressHandlers}
      onClick={() => navigate(targetHref)}
      onKeyDown={(event) => {
        actionMenu.handleKeyboardTrigger(event);
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          navigate(targetHref);
        }
      }}
    >
      {content}
      <ItemActionMenu
        actions={actions}
        header={{
          type: "media",
          title: name,
          subtitle,
          imageUrl: menuPhotoUrl,
          imageAlt: name,
          imageShape: "circle",
          fallbackIcon: UserRound,
        }}
        open={actionMenu.open}
        position={actionMenu.position}
        menuRef={actionMenu.menuRef}
        onClose={actionMenu.close}
      />
    </div>
  );
}
