import { useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  CRATE_ICON_SIZE,
  Heart,
  HeartBold,
  ListMusic,
  MoreHorizontal,
  Play,
  Radio,
  Share2,
  Shuffle,
  Users,
} from "@crate/ui/icons";

import {
  type ArtistData,
  type ArtistInfo,
} from "@/components/artist/artist-model";
import { BandcampSupportButton } from "@/components/bandcamp/BandcampSupportButton";
import { ContextMenu, type ContextMenuEntry } from "@crate/ui/domain/actions";
import { useDismissibleLayer } from "@crate/ui/lib/use-dismissible-layer";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { formatCompact } from "@/lib/utils";

interface ArtistHeroSectionProps {
  artist: ArtistData;
  artistInfo?: ArtistInfo;
  photoUrl: string;
  backgroundUrl?: string;
  tags: string[];
  following: boolean;
  onPlay: () => void;
  onShuffle: () => void;
  onArtistRadio: () => void;
  onPlaySetlist?: () => void;
  hasSetlist?: boolean;
  onToggleFollow: () => void;
  onShare: () => void;
  onOpenBio: () => void;
}

const SECONDARY_ACTION_CLASS =
  "flex min-h-14 min-w-[56px] shrink-0 touch-manipulation flex-col items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-medium text-white/62 transition-[color,filter,transform] hover:-translate-y-px hover:text-primary hover:drop-shadow-[0_0_10px_rgba(34,211,238,0.32)] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:translate-y-0 disabled:hover:drop-shadow-none";

export function ArtistHeroSection({
  artist,
  artistInfo,
  photoUrl,
  backgroundUrl,
  following,
  onPlay,
  onShuffle,
  onArtistRadio,
  onPlaySetlist,
  hasSetlist,
  onToggleFollow,
  onShare,
  onOpenBio,
}: ArtistHeroSectionProps) {
  const isDesktop = useIsDesktop();
  const [menuOpen, setMenuOpen] = useState(false);
  const [desktopMenuPosition, setDesktopMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const desktopMenuRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const bio = artistInfo?.bio ?? "";
  const heroBackgroundSrc = backgroundUrl
    ? `${backgroundUrl}${
        backgroundUrl.includes("?") ? "&" : "?"
      }v=artist-hero-bg-v1`
    : undefined;
  const closeMenu = () => {
    setMenuOpen(false);
    setDesktopMenuPosition(null);
  };

  useDismissibleLayer({
    active: menuOpen && isDesktop,
    refs: [menuRef, desktopMenuRef],
    onDismiss: closeMenu,
  });

  function handleToggleMenu(event: MouseEvent<HTMLButtonElement>) {
    if (menuOpen) {
      closeMenu();
      return;
    }

    if (isDesktop) {
      const rect = event.currentTarget.getBoundingClientRect();
      const width = 288;
      const padding = 12;
      const maxX = Math.max(padding, window.innerWidth - width - padding);
      setDesktopMenuPosition({
        x: Math.min(Math.max(padding, rect.right - width), maxX),
        y: rect.bottom + 8,
      });
    }

    setMenuOpen(true);
  }

  const menuItems: ContextMenuEntry[] = [
    {
      key: "play",
      label: "Play top tracks",
      icon: Play,
      onSelect: onPlay,
    },
    {
      key: "shuffle",
      label: "Shuffle",
      icon: Shuffle,
      onSelect: onShuffle,
    },
    {
      key: "radio",
      label: "Artist radio",
      icon: Radio,
      onSelect: onArtistRadio,
    },
    ...(onPlaySetlist
      ? [
          {
            key: "setlist",
            label: "Play setlist",
            icon: ListMusic,
            disabled: !hasSetlist,
            onSelect: onPlaySetlist,
          },
        ]
      : []),
    {
      key: "follow",
      label: following ? "Unfollow" : "Follow",
      icon: following ? HeartBold : Heart,
      active: following,
      onSelect: onToggleFollow,
    },
    {
      key: "share",
      label: "Share",
      icon: Share2,
      onSelect: onShare,
    },
  ];
  const mobileMenuTrigger =
    !isDesktop && typeof document !== "undefined" ? (
      <div
        className="fixed z-app-header"
        style={{
          top: "calc(var(--listen-safe-top) + 0.625rem)",
          right: "max(1rem, var(--listen-safe-right))",
        }}
        ref={menuRef}
      >
        <button
          data-testid="artist-mobile-hero-menu"
          className="flex h-11 w-11 touch-manipulation items-center justify-center text-white/72 transition-[color,filter,transform] hover:-translate-y-px hover:text-primary hover:drop-shadow-[0_0_10px_rgba(34,211,238,0.32)]"
          onClick={handleToggleMenu}
          aria-label="More"
        >
          <MoreHorizontal
            data-testid="artist-mobile-hero-menu-icon"
            size={CRATE_ICON_SIZE.navMobile}
            className="rotate-90"
          />
        </button>
        <ContextMenu
          header={{
            type: "media",
            title: artist.name,
            subtitle: `${artist.total_tracks} tracks · ${artist.albums.length} albums`,
            imageUrl: photoUrl,
            imageAlt: artist.name,
            imageShape: "circle",
            fallbackIcon: Users,
          }}
          items={menuItems}
          menuRef={mobileMenuRef}
          onClose={closeMenu}
          open={menuOpen}
          position={desktopMenuPosition}
        />
      </div>
    ) : null;

  return (
    <>
      {mobileMenuTrigger
        ? createPortal(mobileMenuTrigger, document.body)
        : null}
      <div className="relative h-[420px] overflow-hidden sm:h-[400px]">
        {heroBackgroundSrc ? (
          <img
            src={heroBackgroundSrc}
            alt=""
            className="absolute inset-0 h-full w-full scale-[1.02] object-cover object-[right_20%] grayscale brightness-[0.5] contrast-110 opacity-[0.45]"
          />
        ) : null}
        <div className="absolute inset-0 bg-black/28" />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to bottom, transparent 0%, rgba(8, 10, 14, 0.14) 34%, rgba(8, 10, 14, 0.46) 60%, var(--surface-app) 100%)",
          }}
        />
        <div className="relative mx-auto flex h-full w-full max-w-[1480px] items-end px-4 pb-6 sm:px-6">
          <div className="flex w-full flex-col gap-5 sm:flex-row sm:items-end">
            {/* Avatar — small inline on mobile, large circle on desktop */}
            <div className="hidden sm:block h-40 w-40 flex-shrink-0 overflow-hidden rounded-full bg-white/5 shadow-2xl ring-2 ring-white/10">
              <img
                src={photoUrl}
                alt={artist.name}
                className="h-full w-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            </div>

            <div className="max-w-3xl pb-1">
              <div className="flex items-center gap-3 sm:block">
                <div className="sm:hidden h-14 w-14 flex-shrink-0 overflow-hidden rounded-full bg-white/5 shadow-xl ring-2 ring-white/10">
                  <img
                    src={photoUrl}
                    alt={artist.name}
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                </div>
                <div>
                  <h1 className="mb-1 text-2xl font-bold text-foreground sm:mb-2 sm:text-4xl">
                    {artist.name}
                  </h1>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground sm:hidden">
                    {artistInfo?.listeners ? (
                      <span className="flex items-center gap-1">
                        <Users size={12} />
                        {formatCompact(artistInfo.listeners)}
                      </span>
                    ) : null}
                    {artist.total_tracks > 0 ? (
                      <span>{artist.total_tracks} tracks</span>
                    ) : null}
                    {artist.albums.length > 0 ? (
                      <span>{artist.albums.length} albums</span>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="hidden sm:flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                {artistInfo?.listeners ? (
                  <span className="flex items-center gap-1">
                    <Users size={14} />
                    {formatCompact(artistInfo.listeners)} listeners
                  </span>
                ) : null}
                {artist.total_tracks > 0 ? (
                  <span>{artist.total_tracks} tracks</span>
                ) : null}
                {artist.albums.length > 0 ? (
                  <span>{artist.albums.length} albums</span>
                ) : null}
              </div>

              {bio ? (
                <div className="mt-3 max-w-2xl">
                  <p className="line-clamp-2 whitespace-pre-line text-sm leading-relaxed text-white/70 sm:line-clamp-3">
                    {bio}
                  </p>
                  {bio.length > 200 ? (
                    <button
                      className="mt-2 flex items-center gap-1 text-xs text-primary hover:underline"
                      onClick={onOpenBio}
                    >
                      Show more <ChevronDown size={12} />
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 py-4 sm:px-6">
        <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-5 md:flex-row md:items-center md:justify-between md:gap-6">
          <div
            role="group"
            aria-label="Primary artist actions"
            className="grid grid-cols-2 gap-3 md:flex md:shrink-0 md:items-center md:gap-3"
          >
            <button
              className="flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-[0_0_18px_rgba(34,211,238,0.24)] transition-[background-color,box-shadow,transform] hover:-translate-y-px hover:bg-primary/90 hover:shadow-[0_0_24px_rgba(34,211,238,0.34)] md:px-7 md:text-[15px]"
              onClick={onPlay}
              aria-label="Play"
            >
              <Play size={17} fill="currentColor" />
              <span>Play</span>
            </button>
            <button
              className="flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-white/[0.08] px-5 text-sm font-semibold text-foreground shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] transition-[background-color,color,filter,transform] hover:-translate-y-px hover:bg-white/[0.12] hover:text-primary hover:drop-shadow-[0_0_8px_rgba(34,211,238,0.24)] md:w-auto md:px-7"
              onClick={onShuffle}
              aria-label="Shuffle"
            >
              <Shuffle size={17} />
              <span>Shuffle</span>
            </button>
          </div>

          <div
            role="group"
            aria-label="Secondary artist actions"
            className="grid grid-cols-5 items-start gap-2 md:ml-auto md:flex md:shrink-0 md:items-center md:gap-4"
          >
            <button
              className={SECONDARY_ACTION_CLASS}
              onClick={onArtistRadio}
              aria-label="Artist Radio"
            >
              <Radio size={CRATE_ICON_SIZE.lg} />
              <span>Radio</span>
            </button>
            <button
              className={SECONDARY_ACTION_CLASS}
              onClick={onPlaySetlist}
              disabled={!hasSetlist}
              aria-label="Setlist"
            >
              <ListMusic size={CRATE_ICON_SIZE.lg} />
              <span>Setlist</span>
            </button>
            <button
              className={`${SECONDARY_ACTION_CLASS} ${
                following
                  ? "text-primary drop-shadow-[0_0_8px_rgba(34,211,238,0.28)]"
                  : "text-white/62"
              }`}
              onClick={onToggleFollow}
              aria-label={following ? "Unfollow" : "Follow"}
            >
              {following ? (
                <HeartBold
                  size={CRATE_ICON_SIZE.lg}
                  className="animate-crate-icon-active-pulse"
                />
              ) : (
                <Heart size={CRATE_ICON_SIZE.lg} />
              )}
              <span>{following ? "Following" : "Follow"}</span>
            </button>
            <button
              className={SECONDARY_ACTION_CLASS}
              onClick={onShare}
              aria-label="Share"
            >
              <Share2 size={CRATE_ICON_SIZE.lg} />
              <span>Share</span>
            </button>
            <BandcampSupportButton
              entityType="artist"
              entityUid={artist.entity_uid}
              presentation="secondary-action"
            />
            {isDesktop ? (
              <div className="relative shrink-0" ref={menuRef}>
                <button
                  className={SECONDARY_ACTION_CLASS}
                  onClick={handleToggleMenu}
                  aria-label="More"
                >
                  <MoreHorizontal size={CRATE_ICON_SIZE.lg} />
                  <span>More</span>
                </button>
                <ContextMenu
                  header={{
                    type: "media",
                    title: artist.name,
                    subtitle: `${artist.total_tracks} tracks · ${artist.albums.length} albums`,
                    imageUrl: photoUrl,
                    imageAlt: artist.name,
                    imageShape: "circle",
                    fallbackIcon: Users,
                  }}
                  items={menuItems}
                  menuRef={isDesktop ? desktopMenuRef : mobileMenuRef}
                  onClose={closeMenu}
                  open={menuOpen}
                  position={desktopMenuPosition}
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
