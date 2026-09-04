import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { ArrowRight, Clock3, Loader2, Play, Sparkles } from "@crate/ui/icons";

import {
  ItemActionMenu,
  useItemActionMenu,
} from "@/components/actions/ItemActionMenu";
import { usePlaylistActionEntries } from "@/components/actions/playlist-actions";
import type { PlaylistArtworkTrack } from "@/components/playlists/PlaylistArtwork";
import {
  EditorialPlaylistArtwork,
  editorialPlaylistLabel,
} from "@/components/playlists/EditorialPlaylistArtwork";
import { TrackCoverThumb } from "@/components/artwork/TrackCoverThumb";
import { CrateImage } from "@/components/artwork/CrateImage";
import type { Track } from "@/contexts/PlayerContext";
import { resolveMaybeApiAssetUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

import type { HomeUpcomingItem } from "./home-model";

export function getHomeGreeting(t: TFunction): string {
  const hour = new Date().getHours();
  if (hour < 12) return t("home.greeting.morning");
  if (hour < 18) return t("home.greeting.afternoon");
  return t("home.greeting.evening");
}

export function getHomeDateString(locale: string): string {
  return new Date().toLocaleDateString(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function SectionHeader({
  title,
  subtitle,
  actionLabel,
  onAction,
}: {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  railControls?: {
    canScrollLeft: boolean;
    canScrollRight: boolean;
    onScrollLeft: () => void;
    onScrollRight: () => void;
  };
}) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-lg font-bold text-text-primary">{title}</h2>
        {subtitle ? (
          <p className="mt-1 line-clamp-2 text-sm text-text-muted">
            {subtitle}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {actionLabel && onAction ? (
          <button
            onClick={onAction}
            className="inline-flex items-center gap-1 text-sm text-text-muted transition-colors hover:text-text-primary"
          >
            {actionLabel}
            <ArrowRight size={15} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function useSectionRail(itemCount: number) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateButtons = useCallback(() => {
    const node = railRef.current;
    if (!node) return;
    const maxScrollLeft = node.scrollWidth - node.clientWidth;
    setCanScrollLeft(node.scrollLeft > 8);
    setCanScrollRight(maxScrollLeft - node.scrollLeft > 8);
  }, []);

  useEffect(() => {
    const node = railRef.current;
    if (!node) return;
    updateButtons();
    const handleScroll = () => updateButtons();
    node.addEventListener("scroll", handleScroll, { passive: true });
    const resizeObserver = new ResizeObserver(() => updateButtons());
    resizeObserver.observe(node);
    Array.from(node.children).forEach((child) => resizeObserver.observe(child));
    return () => {
      node.removeEventListener("scroll", handleScroll);
      resizeObserver.disconnect();
    };
  }, [itemCount, updateButtons]);

  const scrollByDirection = useCallback((direction: -1 | 1) => {
    const node = railRef.current;
    if (!node) return;
    const delta = Math.max(node.clientWidth - 120, 260);
    node.scrollBy({ left: delta * direction, behavior: "smooth" });
  }, []);

  return {
    railRef,
    canScrollLeft,
    canScrollRight,
    onScrollLeft: () => scrollByDirection(-1),
    onScrollRight: () => scrollByDirection(1),
  };
}

export function SectionRail({
  children,
  railRef,
  className,
  fit = "content",
}: {
  children: ReactNode;
  railRef?: RefObject<HTMLDivElement | null>;
  className?: string;
  fit?: "content" | "square-card";
}) {
  const squareFitClassName =
    "grid grid-flow-col auto-cols-[calc((100%_-_1rem)/2)] sm:auto-cols-[calc((100%_-_2rem)/3)] md:auto-cols-[calc((100%_-_3rem)/4)] lg:auto-cols-[calc((100%_-_4rem)/5)] xl:auto-cols-[calc((100%_-_5rem)/6)] 2xl:auto-cols-[calc((100%_-_6rem)/7)]";

  return (
    <div
      ref={railRef}
      data-rail-fit={fit}
      className={cn(
        "hide-rail-scrollbar snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto overflow-y-hidden pb-2 transform-gpu will-change-scroll",
        fit === "square-card" ? squareFitClassName : "flex",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SectionLoading() {
  return (
    <div className="flex items-center justify-center py-10">
      <Loader2 size={20} className="animate-spin text-accent-action" />
    </div>
  );
}

export function UpcomingPreviewRow({
  item,
  onClick,
}: {
  item: HomeUpcomingItem;
  onClick: () => void;
}) {
  const { t, i18n } = useTranslation();
  const dateLabel = item.date
    ? new Date(`${item.date}T12:00:00`).toLocaleDateString(i18n.language, {
        month: "short",
        day: "numeric",
      })
    : t("home.radar.soon");
  const artworkUrl = resolveMaybeApiAssetUrl(item.cover_url);

  return (
    <button
      onClick={onClick}
      className="group relative flex w-full items-center gap-3 overflow-hidden rounded-lg border border-transparent px-3 py-2 text-left transition-colors hover:border-border-quiet hover:bg-text-primary/5"
    >
      {artworkUrl ? (
        <CrateImage
          src={artworkUrl}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover opacity-20 grayscale transition-opacity group-hover:opacity-30"
          onError={(event) => {
            (event.target as HTMLImageElement).style.display = "none";
          }}
        />
      ) : null}
      <div className="home-upcoming-row-scrim absolute inset-0" />
      <div className="relative flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl border border-border-quiet bg-text-primary/[0.03]">
        <span className="text-[10px] uppercase tracking-wide text-text-primary/40">
          {dateLabel.split(" ")[0]}
        </span>
        <span className="text-sm font-semibold text-text-primary">
          {dateLabel.split(" ")[1] || ""}
        </span>
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-text-primary">
            {item.type === "show" ? item.artist : item.title}
          </span>
          {item.user_attending && item.type === "show" ? (
            <span className="rounded-full border border-accent-action/20 bg-accent-action/10 px-2 py-0.5 text-[10px] font-medium text-accent-action">
              {t("radar.show.going")}
            </span>
          ) : null}
        </div>
        <div className="truncate text-xs text-text-muted">
          {item.type === "show"
            ? `${item.title} · ${item.subtitle}`
            : `${item.artist} · ${item.title}`}
        </div>
      </div>
      <div className="relative shrink-0 rounded-full border border-accent-action/15 bg-accent-action/10 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-accent-action">
        {item.type === "show"
          ? t("home.radar.itemType.show")
          : t("home.radar.itemType.release")}
      </div>
    </button>
  );
}

export function FeaturedPlaylistCard({
  playlistId,
  name,
  isSmart = false,
  description,
  tracks,
  coverDataUrl,
  meta,
  href,
  isFollowed,
  onClick,
  onPlay,
  onToggleFollow,
}: {
  playlistId?: number;
  name: string;
  isSmart?: boolean;
  description?: string;
  tracks?: PlaylistArtworkTrack[];
  coverDataUrl?: string | null;
  meta: string;
  href?: string;
  isFollowed?: boolean;
  onClick: () => void;
  onPlay?: () => Promise<void> | void;
  onToggleFollow?: () => Promise<void> | void;
}) {
  const actions = usePlaylistActionEntries({
    playlistId,
    name,
    isSmart,
    href,
    canFollow: Boolean(onToggleFollow),
    isFollowed,
    onToggleFollow,
    onPlay,
  });
  const actionMenu = useItemActionMenu(actions);
  const editorialLabel = editorialPlaylistLabel(
    name,
    isSmart ? "Core Tracks" : "Crate Selects",
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        actionMenu.handleKeyboardTrigger(event);
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      onContextMenu={actionMenu.handleContextMenu}
      {...actionMenu.longPressHandlers}
      className="group w-[180px] flex-shrink-0 cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:rounded-xl"
    >
      <div className="relative">
        <EditorialPlaylistArtwork
          title={editorialLabel.title}
          kicker={editorialLabel.kicker}
          coverDataUrl={coverDataUrl}
          tracks={tracks}
          className="aspect-square rounded-xl shadow-xl transition-transform group-hover:scale-[1.02]"
        />
      </div>
      <div className="px-1 pt-3">
        <div className="truncate text-sm font-bold text-text-primary">
          {name}
        </div>
        <div className="mt-1 line-clamp-2 min-h-[2.5rem] text-xs leading-5 text-text-muted">
          {description || meta}
        </div>
        <div className="mt-2 text-[11px] uppercase tracking-wider text-text-primary/40">
          {meta}
        </div>
      </div>
      <ItemActionMenu
        actions={actions}
        header={{
          type: "media",
          title: name,
          subtitle: description || meta,
          detail: meta,
          imageShape: "square",
          fallbackIcon: Sparkles,
        }}
        open={actionMenu.open}
        position={actionMenu.position}
        menuRef={actionMenu.menuRef}
        onClose={actionMenu.close}
      />
    </div>
  );
}

export function ContinueListeningCard({
  track,
  onPlay,
}: {
  track: Track;
  onPlay: () => void;
}) {
  return (
    <div className="group relative overflow-hidden rounded-[12px] border border-border-quiet bg-text-primary/[0.04] p-3 sm:p-4">
      <div className="home-continue-listening-atmosphere absolute inset-0" />
      <div className="relative flex items-center gap-3 sm:gap-4">
        <TrackCoverThumb
          src={track.albumCover}
          iconSize={24}
          className="h-16 w-16 shrink-0 rounded-xl sm:h-20 sm:w-20"
        />
        <div className="min-w-0 flex-1">
          <div className="mb-2 inline-flex max-w-full items-center gap-2 truncate rounded-full border border-border-quiet bg-text-primary/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-wider text-text-muted">
            <Clock3 size={11} />
            Continue listening
          </div>
          <h2 className="truncate text-xl font-bold text-text-primary">
            {track.title}
          </h2>
          <p className="mt-1 truncate text-sm text-text-muted">
            {track.artist}
          </p>
          {track.album ? (
            <p className="mt-1 truncate text-xs text-text-primary/40">
              {track.album}
            </p>
          ) : null}
        </div>
        <button
          onClick={onPlay}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-action text-accent-action-foreground shadow-lg transition-transform group-hover:scale-105 sm:h-11 sm:w-11"
        >
          <Play size={18} fill="currentColor" className="ml-0.5" />
        </button>
      </div>
    </div>
  );
}
