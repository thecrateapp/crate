import { useEffect, useMemo, useRef, useState } from "react";
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
import { useHoverCapability } from "@crate/ui/lib/use-hover-capability";
import { fetchArtistTopTracks } from "@/components/actions/shared";
import { useArtistActionEntries } from "@/components/actions/artist-actions";
import { AuthenticatedMediaImage } from "@/components/player/AuthenticatedMediaImage";
import { useArtistFollows } from "@/contexts/ArtistFollowsContext";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { cn } from "@/lib/utils";
import {
  artistPagePath,
  artistPhotoApiUrl,
  responsiveImageSrcSet,
} from "@/lib/library-routes";

const ARTIST_CARD_IMAGE_WIDTHS = [160, 256, 320] as const;

const EXTERNAL_ARTWORK_RETRY_DELAYS_MS = [
  2_000, 4_000, 8_000, 15_000, 30_000, 30_000, 30_000, 60_000, 60_000, 60_000,
];

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
  const [externalArtworkRetry, setExternalArtworkRetry] = useState(0);
  const [loadedPhotoUrl, setLoadedPhotoUrl] = useState<string | null>(null);
  const externalArtworkRetryTimer = useRef<number | null>(null);
  const shouldResolvePhoto = hasPhoto !== false;
  const photoUrl =
    photo ||
    (shouldResolvePhoto
      ? artistPhotoApiUrl(
          {
            artistId,
            artistEntityUid,
            globalArtistUid,
            artistSlug,
            artistName: name,
          },
          { size: layout === "grid" ? 320 : compact ? 160 : large ? 320 : 256 },
        )
      : "") ||
    undefined;
  const photoSrcSet = photo
    ? undefined
    : responsiveImageSrcSet(ARTIST_CARD_IMAGE_WIDTHS, (size) =>
        artistPhotoApiUrl(
          {
            artistId,
            artistEntityUid,
            globalArtistUid,
            artistSlug,
            artistName: name,
          },
          { size },
        ),
      );
  const isPendingExternalArtwork =
    external &&
    Boolean(photoUrl?.includes("/api/network/external-artist/photo"));
  const renderedPhotoUrl = useMemo(() => {
    if (!photoUrl || !externalArtworkRetry) return photoUrl;
    const separator = photoUrl.includes("?") ? "&" : "?";
    return `${photoUrl}${separator}retry=${externalArtworkRetry}`;
  }, [externalArtworkRetry, photoUrl]);
  const photoReady = Boolean(
    renderedPhotoUrl && loadedPhotoUrl === renderedPhotoUrl,
  );

  useEffect(() => {
    if (externalArtworkRetryTimer.current !== null) {
      window.clearTimeout(externalArtworkRetryTimer.current);
      externalArtworkRetryTimer.current = null;
    }
    setExternalArtworkRetry(0);
    return () => {
      if (externalArtworkRetryTimer.current !== null) {
        window.clearTimeout(externalArtworkRetryTimer.current);
        externalArtworkRetryTimer.current = null;
      }
    };
  }, [photoUrl]);
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
  const imageSize = compact ? 100 : large ? 156 : 140;
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
      <div
        className="relative mx-auto mb-2 aspect-square overflow-hidden rounded-full bg-white/5"
        style={{
          width: layout === "grid" ? "100%" : imageSize,
          maxWidth: layout === "grid" && fillGrid ? "none" : imageSize,
          height: layout === "grid" ? "auto" : imageSize,
        }}
      >
        <div
          aria-hidden="true"
          data-testid="artist-artwork-placeholder"
          data-placeholder-style="flat-disc"
          className="absolute inset-0 grid place-items-center rounded-full bg-[#171922]"
        >
          <span className="text-sm font-semibold text-white/75">
            {monogram}
          </span>
        </div>
        {renderedPhotoUrl ? (
          <AuthenticatedMediaImage
            src={renderedPhotoUrl}
            srcSet={photoSrcSet}
            sizes={photoSrcSet ? `${imageSize}px` : undefined}
            alt={name}
            loading="lazy"
            decoding="async"
            className={cn(
              "relative z-10 h-full w-full object-cover",
              photoReady ? "visible" : "invisible",
              imageTone === "muted" &&
                "grayscale saturate-0 brightness-[0.52] contrast-125 transition duration-300 group-hover:brightness-[0.72]",
            )}
            onLoad={() => setLoadedPhotoUrl(renderedPhotoUrl ?? null)}
            onError={() => {
              setLoadedPhotoUrl(null);
              if (
                isPendingExternalArtwork &&
                externalArtworkRetry < EXTERNAL_ARTWORK_RETRY_DELAYS_MS.length
              ) {
                if (externalArtworkRetryTimer.current === null) {
                  externalArtworkRetryTimer.current = window.setTimeout(() => {
                    externalArtworkRetryTimer.current = null;
                    setExternalArtworkRetry((retry) => retry + 1);
                  }, EXTERNAL_ARTWORK_RETRY_DELAYS_MS[externalArtworkRetry] ?? 60_000);
                }
                return;
              }
            }}
          />
        ) : null}
        {!external && hasPlayableArtist && canUseInlineHoverActions ? (
          <>
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-full bg-black/0 transition-colors group-hover:bg-black/42">
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
                      await toggleArtistFollow(artistId, globalArtistUid, name);
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
