import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import {
  CRATE_ICON_SIZE,
  Heart,
  HeartBold,
  Loader2,
  Play,
  UserRound,
} from "@crate/ui/icons";
import { toast } from "sonner";

import { ItemActionMenu, useItemActionMenu } from "@crate/ui/domain/actions";
import { fetchArtistTopTracks } from "@/components/actions/shared";
import { useArtistActionEntries } from "@/components/actions/artist-actions";
import { useArtistFollows } from "@/contexts/ArtistFollowsContext";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { resolveMaybeApiAssetUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import { artistPagePath, artistPhotoApiUrl } from "@/lib/library-routes";

interface ArtistCardProps {
  name: string;
  artistId?: number;
  artistEntityUid?: string;
  artistSlug?: string;
  photo?: string;
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
  artistSlug,
  photo,
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
  const [playingTopTracks, setPlayingTopTracks] = useState(false);
  const [togglingFollow, setTogglingFollow] = useState(false);
  const resolvedPhotoUrl = resolveMaybeApiAssetUrl(photo);
  const photoUrl =
    resolvedPhotoUrl ||
    artistPhotoApiUrl(
      { artistId, artistEntityUid, artistSlug, artistName: name },
      { size: layout === "grid" ? 320 : compact ? 160 : large ? 320 : 256 },
    ) ||
    undefined;
  const targetHref =
    href || artistPagePath({ artistId, artistSlug, artistName: name });
  const following = isFollowing(artistId);
  const actions = useArtistActionEntries({
    artistId,
    artistEntityUid,
    artistSlug,
    imageUrl: photoUrl,
    name,
  });
  const actionMenu = useItemActionMenu(actions, {
    disabled: external,
  });
  const imageSize = compact ? 100 : large ? 156 : 140;
  const wrapperClassName = cn(
    "group snap-start cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:rounded-xl",
    layout === "grid"
      ? "w-full min-w-0"
      : `flex-shrink-0 ${
          compact ? "w-[100px]" : large ? "w-[156px]" : "w-[140px]"
        }`,
  );
  const content = (
    <>
      <div
        className="relative mx-auto mb-2 aspect-square overflow-hidden rounded-full bg-white/5"
        style={{
          width: layout === "grid" ? "100%" : imageSize,
          maxWidth: layout === "grid" && fillGrid ? "none" : imageSize,
          height: layout === "grid" ? "auto" : imageSize,
        }}
      >
        {photoUrl ? (
          <img
            src={photoUrl}
            alt={name}
            loading="lazy"
            className={cn(
              "h-full w-full object-cover",
              imageTone === "muted" &&
                "grayscale saturate-0 brightness-[0.52] contrast-125 transition duration-300 group-hover:brightness-[0.72]",
            )}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : null}
        {!external && artistId != null ? (
          <>
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-full bg-black/0 transition-colors group-hover:bg-black/42">
              <div className="pointer-events-none flex translate-y-2 items-center justify-center gap-2 opacity-0 transition-all group-hover:translate-y-0 group-hover:opacity-100">
                <button
                  type="button"
                  className="pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg"
                  onClick={async (event) => {
                    event.stopPropagation();
                    if (artistId == null) return;
                    setPlayingTopTracks(true);
                    try {
                      const tracks = await fetchArtistTopTracks({
                        artistId,
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
                <button
                  type="button"
                  className={cn(
                    "pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-full border shadow-lg backdrop-blur-sm",
                    following
                      ? "border-primary/30 bg-primary/15 text-primary"
                      : "border-white/16 bg-black/35 text-white",
                  )}
                  onClick={async (event) => {
                    event.stopPropagation();
                    setTogglingFollow(true);
                    try {
                      await toggleArtistFollow(artistId);
                      toast.success(
                        following
                          ? t("actions.artist.toasts.unfollowed", { name })
                          : t("actions.artist.toasts.following", { name }),
                      );
                    } catch {
                      toast.error(t("home.toasts.updateFollowFailed"));
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
                >
                  {togglingFollow ? (
                    <Loader2
                      size={CRATE_ICON_SIZE.md}
                      className="animate-spin"
                    />
                  ) : following ? (
                    <HeartBold
                      size={CRATE_ICON_SIZE.md}
                      className="animate-crate-icon-active-pulse"
                    />
                  ) : (
                    <Heart size={CRATE_ICON_SIZE.md} />
                  )}
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>
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
          imageUrl: photoUrl,
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
